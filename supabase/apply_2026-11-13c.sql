-- °CRYO Mongolia · үйлчилгээний цэс, цагийн хуваарь, захиалга засах/устгах.
-- Supabase → SQL Editor-т бүтнээр нь хуулж Run дарна. apply_2026-11-13.sql-ийн ДАРАА ажиллуулна.
-- apply_2026-11-13b.sql-ийг агуулсан тул түүнийг тусад нь ажиллуулах шаардлагагүй. Дахин ажиллуулсан ч аюулгүй.
begin;
-- Employees (not only administrators) may back-fill past slots, correct an
-- appointment, and delete one. A booking with a recorded payment can only be
-- deleted by an administrator, and its sale is archived rather than lost.

create or replace function public.guard_booking_backdate() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.starts_at < now() and not coalesce(public.is_cryo_employee(),false) then
  if tg_op='INSERT' then raise exception 'Өнгөрсөн цагт зөвхөн ажилтан бүртгэл нэмнэ' using errcode='42501';
  elsif new.starts_at is distinct from old.starts_at then raise exception 'Өнгөрсөн цагт зөвхөн ажилтан өөрчилнө' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_booking_backdate() from public,anon,authenticated;

create or replace function private.edit_booking(p_booking_id bigint,p_patch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.bookings%rowtype; v_name text:=btrim(regexp_replace(coalesce(p_patch->>'customer_name',''),'\s+',' ','g')); v_phone text:=btrim(coalesce(p_patch->>'phone',''));
begin
 if auth.uid() is null or not public.is_cryo_employee() then raise exception 'Ажилтны эрх шаардлагатай' using errcode='42501'; end if;
 select * into b from public.bookings where id=p_booking_id for update;
 if not found then raise exception 'Захиалга олдсонгүй'; end if;
 if v_name='' or char_length(v_name)>200 or v_phone='' or char_length(v_phone)>30 then raise exception 'Үйлчлүүлэгчийн нэр, утсыг оруулна уу'; end if;
 update public.bookings set customer_name=v_name,phone=v_phone,note=nullif(btrim(coalesce(p_patch->>'note','')),'') where id=b.id;
 -- Device and time stay fixed once a payment is recorded against the booking.
 if b.payment_status<>'paid' and (p_patch ? 'service_id' or p_patch ? 'starts_at') then
  update public.bookings set service_id=coalesce((p_patch->>'service_id')::bigint,service_id),
   starts_at=coalesce((p_patch->>'starts_at')::timestamptz,starts_at) where id=b.id;
 end if;
 select * into b from public.bookings where id=p_booking_id;
 return to_jsonb(b);
end $$;
revoke all on function private.edit_booking(bigint,jsonb) from public,anon;
grant execute on function private.edit_booking(bigint,jsonb) to authenticated;
create or replace function public.edit_booking(p_booking_id bigint,p_patch jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.edit_booking(p_booking_id,p_patch)$$;
revoke all on function public.edit_booking(bigint,jsonb) from public,anon;
grant execute on function public.edit_booking(bigint,jsonb) to authenticated;

create or replace function private.delete_booking(p_booking_id bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.bookings%rowtype; s public.sales%rowtype; has_money boolean:=false;
begin
 if auth.uid() is null or not public.is_cryo_employee() then raise exception 'Ажилтны эрх шаардлагатай' using errcode='42501'; end if;
 select * into b from public.bookings where id=p_booking_id for update;
 if not found then return jsonb_build_object('deleted',p_booking_id); end if;
 select * into s from public.sales where booking_id=b.id for update;
 if s.id is not null then
  has_money:=s.golomt+s.khan+s.cash+s.barter+s.gift_card+s.internal_amount+s.refund<>0;
  if has_money or b.payment_status='paid' then
   if not public.is_admin() then raise exception 'Төлбөр бүртгэгдсэн захиалгыг зөвхөн админ устгана'; end if;
   -- Keep the money trail: detach and archive instead of deleting.
   update public.sales set booking_id=null,archived_at=now(),needs_review=true,
    note=concat_ws(' · ',nullif(note,''),'Захиалга '||b.ref||' устгагдсан') where id=s.id;
  else
   delete from public.sales where id=s.id; -- unpaid placeholder invoice
  end if;
 end if;
 delete from public.bookings where id=b.id;
 return jsonb_build_object('deleted',b.id,'sale_id',s.id,'sale_archived',has_money or b.payment_status='paid');
end $$;
revoke all on function private.delete_booking(bigint) from public,anon;
grant execute on function private.delete_booking(bigint) to authenticated;
create or replace function public.delete_booking(p_booking_id bigint) returns jsonb
language sql security invoker set search_path='' as $$select private.delete_booking(p_booking_id)$$;
revoke all on function public.delete_booking(bigint) from public,anon;
grant execute on function public.delete_booking(bigint) to authenticated;

-- 1) Services can be added / removed by administrators and nested under a parent
--    (e.g. treatments inside "Гоо сайхан"). Children share the parent's calendar.
-- 2) Long services reserve whole half-hour blocks (60 → 60, 75 → 90, 90 → 90) with
--    no extra 2-minute reset, so 10:00 and 11:00 can be booked back to back.
-- 3) Seed the beauty menu.

alter table public.services add column if not exists parent_id bigint references public.services(id);
alter table public.services add column if not exists archived_at timestamptz;
create index if not exists services_parent_idx on public.services(parent_id);
alter table public.bookings add column if not exists calendar_id bigint references public.services(id);

create or replace function public.prepare_booking_schedule()
returns trigger language plpgsql security definer set search_path = '' as $$
declare svc public.services%rowtype;
begin
  if new.service_id is null then return new; end if;
  -- A status-only change must not reschedule historical appointments.
  if TG_OP = 'UPDATE' then
    if new.service_id is not distinct from old.service_id
      and new.starts_at is not distinct from old.starts_at
      and new.booked_date is not distinct from old.booked_date
      and new.booked_time is not distinct from old.booked_time
      and new.calendar_id is not null then
      return new;
    end if;
  end if;
  select * into svc from public.services where id = new.service_id;
  if not found then raise exception 'Үйлчилгээ олдсонгүй эсвэл идэвхгүй байна' using errcode='P0001'; end if;
  new.calendar_id := coalesce(svc.parent_id, svc.id);
  if TG_OP = 'UPDATE' then
    if new.service_id is not distinct from old.service_id
      and new.starts_at is not distinct from old.starts_at
      and new.booked_date is not distinct from old.booked_date
      and new.booked_time is not distinct from old.booked_time then
      return new; -- only the calendar was missing
    end if;
  end if;
  if not svc.active then raise exception 'Үйлчилгээ олдсонгүй эсвэл идэвхгүй байна' using errcode='P0001'; end if;
  if new.starts_at is null and new.booked_date is not null and new.booked_time is not null then
    new.starts_at := (new.booked_date + new.booked_time::time) at time zone 'Asia/Ulaanbaatar';
  end if;
  if new.starts_at is null then raise exception 'Захиалгын эхлэх цаг шаардлагатай' using errcode='23502'; end if;
  new.duration_minutes := svc.duration_minutes;
  new.ends_at := new.starts_at + make_interval(mins => svc.duration_minutes);
  new.blocked_until := new.starts_at + make_interval(mins => greatest(30, ceil(svc.duration_minutes / 30.0)::int * 30));
  new.service := svc.name;
  new.booked_date := (new.starts_at at time zone 'Asia/Ulaanbaatar')::date;
  new.booked_time := to_char(new.starts_at at time zone 'Asia/Ulaanbaatar','HH24:MI');
  return new;
end $$;
revoke all on function public.prepare_booking_schedule() from public, anon, authenticated;
drop trigger if exists trg_prepare_booking_schedule on public.bookings;
create trigger trg_prepare_booking_schedule
before insert or update of service_id, starts_at, booked_date, booked_time, status, calendar_id
on public.bookings for each row execute function public.prepare_booking_schedule();

-- Availability is published per calendar, so a child treatment blocks its parent's diary.
create or replace function public.sync_booking_block()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    delete from public.booking_blocks where booking_id = old.id;
    return old;
  end if;
  delete from public.booking_blocks where booking_id = new.id;
  if new.status <> 'cancelled' and new.service_id is not null and new.starts_at is not null and new.ends_at is not null then
    insert into public.booking_blocks (booking_id, service_id, starts_at, ends_at, blocked_until, status)
    values (new.id, coalesce(new.calendar_id, new.service_id), new.starts_at, new.ends_at, new.blocked_until, new.status);
  end if;
  return new;
end $$;

-- Existing rows: same calendar as before; drop the 2-minute tail of long sessions.
alter table public.bookings drop constraint if exists bookings_no_device_overlap;
update public.bookings b
set calendar_id = b.service_id,
    blocked_until = case
      when b.duration_minutes > 30 and b.starts_at is not null
        and b.starts_at + make_interval(mins => ceil(b.duration_minutes / 30.0)::int * 30) < b.blocked_until
      then b.starts_at + make_interval(mins => ceil(b.duration_minutes / 30.0)::int * 30)
      else b.blocked_until end
where b.service_id is not null and b.calendar_id is null;
alter table public.bookings add constraint bookings_no_device_overlap
  exclude using gist (calendar_id with =, tstzrange(starts_at, blocked_until, '[)') with &&)
  where (status <> 'cancelled' and calendar_id is not null and starts_at is not null and blocked_until is not null);

-- Remove a service: delete it when nothing refers to it, otherwise archive it.
create or replace function private.remove_service(p_id bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Зөвхөн админ үйлчилгээ устгана' using errcode='42501'; end if;
 if exists(select 1 from public.services where parent_id=p_id and archived_at is null) then raise exception 'Эхлээд доторх дэд үйлчилгээнүүдийг устгана уу'; end if;
 begin
  delete from public.services where id=p_id;
  return jsonb_build_object('id',p_id,'deleted',true);
 exception when foreign_key_violation then
  update public.services set active=false,archived_at=now(),updated_at=now() where id=p_id;
  return jsonb_build_object('id',p_id,'deleted',false,'archived',true);
 end;
end $$;
revoke all on function private.remove_service(bigint) from public,anon;
grant execute on function private.remove_service(bigint) to authenticated;
create or replace function public.remove_service(p_id bigint) returns jsonb
language sql security invoker set search_path='' as $$select private.remove_service(p_id)$$;
revoke all on function public.remove_service(bigint) from public,anon;
grant execute on function public.remove_service(bigint) to authenticated;

-- Beauty menu, nested under the existing facial service.
insert into public.services(slug,name,category,duration,duration_minutes,price,sort,active,parent_id)
select v.slug,v.name,'beauty',v.mins||' мин',v.mins,v.price,coalesce(p.sort,0)*100+v.ord,true,p.id
from (values
 ('beauty-aroma','Aroma therapy',60,139000,1),
 ('beauty-teatree','Tea tree therapy / Батгатай арьсны эмчилгээ',75,139000,2),
 ('beauty-gold-clean','Luxury gold therapy + батга цэвэрлэгээтэй',90,269000,3),
 ('beauty-gold','Luxury gold therapy + батга цэвэрлэгээгүй',90,249000,4),
 ('beauty-vitadx','Vita DX',90,249000,5),
 ('beauty-choco-clean','Well being sweet choco care + батга цэвэрлэгээтэй',90,209000,6),
 ('beauty-choco','Well being sweet choco care + батга цэвэрлэгээгүй',90,189000,7),
 ('beauty-milk-clean','White milk therapy + батга цэвэрлэгээтэй',90,199000,8),
 ('beauty-milk','White milk therapy + батга цэвэрлэгээгүй',90,179000,9),
 ('beauty-lemon','Lemon white therapy / Цайруулах үйлчилгээ',90,179000,10),
 ('beauty-wax-brow','Хөмсөгний вакс',30,20000,11),
 ('beauty-wax-lip','Сахлын вакс',30,15000,12),
 ('beauty-wax-underarm','Суганы вакс',30,30000,13),
 ('beauty-wax-cheek','Шанааны вакс',30,25000,14),
 ('beauty-wax-forehead','Духны вакс',30,25000,15),
 ('beauty-wax-forearm','Шууны вакс',30,45000,16),
 ('beauty-wax-shin','Шилбэний вакс',30,50000,17),
 ('beauty-wax-arm','Бүтэн гарын вакс',30,50000,18),
 ('beauty-wax-bikini-half','Бикини вакс /хагас/',30,55000,19),
 ('beauty-wax-bikini-full','Бикини вакс /бүтэн/',30,75000,20),
 ('beauty-wax-leg','Бүтэн хөлийн вакс',30,75000,21),
 ('beauty-wax-face','Бүтэн нүүрний вакс',30,70000,22),
 ('beauty-tag-one','Ургацаг авах /1 удаа/',30,15000,23),
 ('beauty-tag-pack','Ургацаг авах багц /10–15 дээш/',30,110000,24),
 ('beauty-tag-full','Ургацаг авах багц /бүтэн, 15 дээш/',30,180000,25)
) as v(slug,name,mins,price,ord)
cross join (select id,sort from public.services where slug='facial') p
where not exists(select 1 from public.services s where s.slug=v.slug or lower(btrim(s.name))=lower(btrim(v.name)));
commit;
select 'Амжилттай' as result, (select count(*) from public.services where parent_id is not null) as beauty_services;
