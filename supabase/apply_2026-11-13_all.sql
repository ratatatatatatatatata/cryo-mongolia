-- °CRYO Mongolia · 2026-11-13-ны БҮХ шинэчлэл нэг файлд. Supabase → SQL Editor-т бүтнээр нь хуулж Run дарна.
-- Өмнөх apply_2026-11-13 / 13b / 13c файлуудыг орлоно. Аль нэгийг нь өмнө ажиллуулсан ч, дахин ажиллуулсан ч аюулгүй.
-- Алдаа гарвал юу ч хадгалагдахгүй (нэг transaction).
begin;

-- ════════ 20261113090000_customer_day_checkout_vip.sql ════════
-- 1) One checkout for every unpaid slot a customer has on the same day,
--    regardless of how many separate booking actions created them.
-- 2) Every name + phone typed into a booking or sale becomes a customer record.
-- 3) VIP packages and VIP customers.

-- ── VIP flags ─────────────────────────────────────────────────────────
alter table public.packages add column if not exists is_vip boolean not null default false;
alter table public.customers add column if not exists is_vip boolean not null default false;

create or replace function private.mark_vip_customer() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.customer_id is not null and exists(select 1 from public.packages p where p.id=new.package_id and p.is_vip) then
  update public.customers set is_vip=true where id=new.customer_id and not is_vip;
 end if;
 return new;
end $$;
revoke all on function private.mark_vip_customer() from public,anon,authenticated;
drop trigger if exists trg_mark_vip_customer on public.customer_package_contracts;
create trigger trg_mark_vip_customer after insert or update of package_id,customer_id on public.customer_package_contracts
 for each row execute function private.mark_vip_customer();

-- Any employee may flag a package template they just created as VIP;
-- only administrators may change it afterwards or toggle customers.
create or replace function private.set_vip(p_kind text,p_id bigint,p_vip boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.is_cryo_employee() then raise exception 'Эрх хүрэхгүй' using errcode='42501'; end if;
 if p_kind='package' then
  if not public.is_admin() and not exists(select 1 from public.packages where id=p_id and slug like 'custom-%' and updated_at>now()-interval '10 minutes') then
   raise exception 'Зөвхөн админ VIP төлөв өөрчилнө' using errcode='42501';
  end if;
  update public.packages pk set is_vip=coalesce(p_vip,false) where pk.id=p_id returning to_jsonb(pk) into result;
 elsif p_kind='customer' then
  if not public.is_admin() then raise exception 'Зөвхөн админ VIP төлөв өөрчилнө' using errcode='42501'; end if;
  update public.customers cu set is_vip=coalesce(p_vip,false) where cu.id=p_id returning to_jsonb(cu) into result;
 else raise exception 'Буруу төрөл';
 end if;
 if result is null then raise exception 'Бүртгэл олдсонгүй'; end if;
 return result;
end $$;
revoke all on function private.set_vip(text,bigint,boolean) from public,anon;
grant execute on function private.set_vip(text,bigint,boolean) to authenticated;
create or replace function public.set_vip(p_kind text,p_id bigint,p_vip boolean) returns jsonb
language sql security invoker set search_path='' as $$select private.set_vip(p_kind,p_id,p_vip)$$;
revoke all on function public.set_vip(text,bigint,boolean) from public,anon;
grant execute on function public.set_vip(text,bigint,boolean) to authenticated;

-- ── Automatic customer registry ──────────────────────────────────────
create or replace function private.normalize_mn_phone(p text) returns text
language sql immutable set search_path='' as $$
 select case
  when length(d)=8 then d
  when length(d)=11 and left(d,3)='976' then right(d,8)
  else null end
 from (select regexp_replace(coalesce(p,''),'\D','','g') d) x
$$;

create or replace function private.register_customer_from_row() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_phone text:=private.normalize_mn_phone(new.phone); v_name text:=btrim(regexp_replace(coalesce(new.customer_name,''),'\s+',' ','g'));
begin
 if to_jsonb(new)->>'team_id' is not null then return new; end if; -- sports-team bookings are not people
 if v_phone is null or v_name='' or char_length(v_name)>160 then return new; end if;
 insert into public.customers(full_name,phone,source,notes)
  values(v_name,v_phone,'manual','Захиалга/борлуулалтаас автоматаар бүртгэсэн')
  on conflict (phone) do nothing;
 return new;
end $$;
revoke all on function private.register_customer_from_row() from public,anon,authenticated;

drop trigger if exists trg_register_booking_customer on public.bookings;
create trigger trg_register_booking_customer after insert or update of customer_name,phone on public.bookings
 for each row execute function private.register_customer_from_row();
drop trigger if exists trg_register_sale_customer on public.sales;
create trigger trg_register_sale_customer after insert or update of customer_name,phone on public.sales
 for each row execute function private.register_customer_from_row();

-- Backfill: customers who already booked or bought but were never registered.
insert into public.customers(full_name,phone,source,notes)
select distinct on (p) n,p,'manual','Захиалга/борлуулалтаас автоматаар бүртгэсэн'
from (
 select btrim(regexp_replace(customer_name,'\s+',' ','g')) n,private.normalize_mn_phone(phone) p,created_at from public.bookings where team_id is null
 union all
 select btrim(regexp_replace(customer_name,'\s+',' ','g')),private.normalize_mn_phone(phone),created_at from public.sales
) x
where p is not null and n<>'' and char_length(n)<=160
order by p,created_at desc
on conflict (phone) do nothing;

-- ── Same-day multi-slot checkout ─────────────────────────────────────
create or replace function private.pay_bookings(p_booking_ids bigint[],p_sale jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare anchor public.bookings%rowtype; b public.bookings%rowtype;
 result jsonb; results jsonb:='[]'; sale_rows jsonb:='[]'; part jsonb; remaining jsonb:=p_sale;
 total bigint:=0; price bigint; due bigint; allocation bigint; channel text; supplied bigint:=0; n int:=0;
 internal_mode boolean:=coalesce((p_sale->>'is_internal')::boolean,false) or coalesce((p_sale->>'internal_amount')::bigint,0)>0;
 sale_day date:=nullif(p_sale->>'sale_date','')::date; sale_json jsonb;
begin
 perform private.require_cryo_staff(nullif(p_sale->>'staff_id','')::bigint);
 if p_booking_ids is null or cardinality(p_booking_ids)=0 then raise exception 'Захиалга сонгоно уу'; end if;
 -- Lock in id order so concurrent checkouts of overlapping sets cannot deadlock.
 perform 1 from public.bookings where id=any(p_booking_ids) order by id for update;
 select * into anchor from public.bookings where id=p_booking_ids[1];
 if not found then raise exception 'Захиалга олдсонгүй'; end if;
 for b in select * from public.bookings where id=any(p_booking_ids) order by id loop
  -- Same customer = same team, else same phone, else (no phone) same name.
  if b.team_id is distinct from anchor.team_id
   or (anchor.team_id is null and private.normalize_mn_phone(anchor.phone) is not null and private.normalize_mn_phone(b.phone) is distinct from private.normalize_mn_phone(anchor.phone))
   or (anchor.team_id is null and private.normalize_mn_phone(anchor.phone) is null and lower(btrim(b.customer_name)) is distinct from lower(btrim(anchor.customer_name))) then
   raise exception 'Нэг үйлчлүүлэгчийн захиалгуудыг л нэгтгэж төлнө';
  end if;
 end loop;
 foreach channel in array array['cash','golomt','khan','barter','internal_amount'] loop
  allocation:=coalesce((p_sale->>channel)::bigint,0);
  if allocation<0 then raise exception 'Төлөлтийн дүн буруу'; end if;
  supplied:=supplied+allocation;
 end loop;
 if internal_mode and supplied<>coalesce((p_sale->>'internal_amount')::bigint,0) then raise exception 'Дотоод бүртгэлийг мөнгөн төлбөртэй холихгүй'; end if;
 for b in select * from public.bookings where id=any(p_booking_ids) and status<>'cancelled' and payment_status<>'paid' and booking_kind<>'package' order by id loop
  select s.price into price from public.services s where s.id=b.service_id and s.active;
  if price is null or price<=0 then raise exception 'Үндсэн үнэ олдсонгүй'; end if;
  total:=total+price; n:=n+1;
 end loop;
 if n=0 then raise exception 'Төлөх захиалга үлдээгүй байна. Хуудсаа шинэчилнэ үү.'; end if;
 if internal_mode then supplied:=total;remaining:=remaining||jsonb_build_object('internal_amount',total);end if;
 if total<>supplied then raise exception 'Нийт төлбөр %₮ байх ёстой. Захиалгаа шинэчилнэ үү.',total; end if;
 for b in select * from public.bookings where id=any(p_booking_ids) and status<>'cancelled' and payment_status<>'paid' and booking_kind<>'package' order by id loop
  select s.price into due from public.services s where s.id=b.service_id;
  part:=p_sale||jsonb_build_object('customer_name',b.customer_name,'services',b.service,'internal_amount',0,'gift_card',0,'therapist_amount',0);
  foreach channel in array array['cash','golomt','khan','barter','internal_amount'] loop
   allocation:=least(due,coalesce((remaining->>channel)::bigint,0));
   part:=part||jsonb_build_object(channel,allocation);
   remaining:=remaining||jsonb_build_object(channel,coalesce((remaining->>channel)::bigint,0)-allocation);
   due:=due-allocation;
  end loop;
  result:=private.pay_booking(b.id,part);
  -- Administrators back-filling a past appointment record the sale on the visit day.
  if sale_day is not null and public.is_admin() then
   update public.sales sl set sale_date=sale_day where sl.id=(result->'sale'->>'id')::bigint returning to_jsonb(sl) into sale_json;
   result:=result||jsonb_build_object('sale',sale_json);
  end if;
  results:=results||jsonb_build_array(result->'booking');sale_rows:=sale_rows||jsonb_build_array(result->'sale');
 end loop;
 return jsonb_build_object('bookings',results,'sales',sale_rows,'booking',results->0,'sale',sale_rows->0);
end $$;
revoke all on function private.pay_bookings(bigint[],jsonb) from public,anon;
grant execute on function private.pay_bookings(bigint[],jsonb) to authenticated;
create or replace function public.pay_bookings(p_booking_ids bigint[],p_sale jsonb)
returns jsonb language sql security invoker set search_path='' as $$select private.pay_bookings(p_booking_ids,p_sale)$$;
revoke all on function public.pay_bookings(bigint[],jsonb) from public,anon;
grant execute on function public.pay_bookings(bigint[],jsonb) to authenticated;

-- ════════ 20261113100000_staff_past_bookings_gift_card.sql ════════
-- 1) Staff see every appointment, past and present, so they can record status,
--    provider and payment for earlier visits. (Creating a new booking in the past
--    remains an administrator action — see guard_booking_backdate.)
-- 2) Gift card is a payment method for bookings. Like internal usage it is kept
--    in its own column (sales.gift_card) and is not added to cash revenue, because
--    the card's value was taken when the card was sold.

drop policy if exists "staff read bookings" on public.bookings;
create policy "staff read bookings" on public.bookings for select to authenticated
using (exists(select 1 from public.profiles where id=(select auth.uid()) and role='staff'));

create or replace function private.pay_booking(p_booking_id bigint,p_sale jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.bookings%rowtype; s public.sales%rowtype; employee public.staff%rowtype;
 staff_key bigint:=nullif(p_sale->>'staff_id','')::bigint; k text; n numeric;
 g bigint:=coalesce((p_sale->>'golomt')::bigint,0); h bigint:=coalesce((p_sale->>'khan')::bigint,0);
 c bigint:=coalesce((p_sale->>'cash')::bigint,0); internal_value bigint:=coalesce((p_sale->>'internal_amount')::bigint,0); barter_value bigint:=coalesce((p_sale->>'barter')::bigint,0); gift bigint:=coalesce((p_sale->>'gift_card')::bigint,0);
begin
 perform private.require_cryo_staff(staff_key);
 select * into b from public.bookings where id=p_booking_id for update;
 if not found then raise exception 'Захиалга олдсонгүй'; end if;
 select * into s from public.sales where booking_id=b.id;
 if b.payment_status='paid' then
  if s.id is null then raise exception 'Төлбөрийн бүртгэлийг админаар шалгуулна уу'; end if;
  return jsonb_build_object('booking',to_jsonb(b),'sale',to_jsonb(s));
 end if;
 if b.status='cancelled' then raise exception 'Цуцалсан захиалгад төлбөр бүртгэх боломжгүй'; end if;
 if b.booking_kind='package' then raise exception 'Багцын ашиглалтад давхар төлбөр бүртгэхгүй'; end if;
 -- The booked service is authoritative; never ask staff to re-enter device counts.
 select p_sale || jsonb_build_object('services',svc.name||' ×1',
 'cryo_cabin',case when svc.slug='cryocabin' then 1 else 0 end,
 'oxy_pro',case when svc.slug='oxypro' then 1 else 0 end,
 'led_pro',case when svc.slug='ledpro' then 1 else 0 end,
 'x_cryo',case when svc.slug='xcryo' then 1 else 0 end,
 'zerobody',case when svc.slug='zerobody' then 1 else 0 end,
 'normatec',case when svc.slug='normatec' then 1 else 0 end,
 'oxygen',case when svc.slug='oxygen' then 1 else 0 end) into p_sale
 from public.services svc where svc.id=b.service_id;
 if p_sale is null then raise exception 'Захиалгын төхөөрөмж олдсонгүй'; end if;
 foreach k in array array['internal_amount','golomt','khan','cash','barter','invoice','refund','therapist_amount','gift_card','cryo_cabin','oxy_pro','led_pro','x_cryo','zerobody','normatec','oxygen'] loop
  n:=coalesce((p_sale->>k)::numeric,0);
  if n<0 or n<>trunc(n) or n>2147483647 then raise exception 'Тоо, дүн эерэг бүхэл тоо байна'; end if;
 end loop;
 if internal_value>0 or coalesce((p_sale->>'is_internal')::boolean,false) then
  select price into internal_value from public.services where id=b.service_id and active;
  if internal_value is null or internal_value<=0 then raise exception 'Төхөөрөмжийн үндсэн үнэ олдсонгүй'; end if;
  if g+h+c+barter_value+gift<>0 then raise exception 'Дотоод бүртгэлийг мөнгөн төлбөртэй холихгүй'; end if;
 end if;
 if g+h+c+barter_value+internal_value+gift<=0 or coalesce((p_sale->>'invoice')::bigint,0)<>0 or coalesce((p_sale->>'refund')::bigint,0)<>0 then raise exception 'Төлсөн дүнгээ банк, бэлэн, бартер эсвэл gift card-д оруулна уу'; end if;
 if nullif(trim(p_sale->>'customer_name'),'') is null or nullif(trim(p_sale->>'services'),'') is null then raise exception 'Үйлчлүүлэгч, үйлчилгээг бөглөнө үү'; end if;
 select * into employee from public.staff where id=staff_key;
 insert into public.sales(sale_date,customer_name,phone,services,note,staff_id,therapist,therapist_amount,is_internal,internal_amount,gift_card,
 golomt,khan,cash,barter,invoice,refund,cryo_cabin,oxy_pro,led_pro,x_cryo,zerobody,normatec,oxygen,source,source_key,booking_id,created_by)
 values((now() at time zone 'Asia/Ulaanbaatar')::date,trim(p_sale->>'customer_name'),b.phone,trim(p_sale->>'services'),p_sale->>'note',staff_key,employee.name,
 coalesce((p_sale->>'therapist_amount')::bigint,0),(internal_value>0 or coalesce((p_sale->>'is_internal')::boolean,false)),internal_value,gift,
 g,h,c,barter_value,0,0,coalesce((p_sale->>'cryo_cabin')::int,0),coalesce((p_sale->>'oxy_pro')::int,0),coalesce((p_sale->>'led_pro')::int,0),coalesce((p_sale->>'x_cryo')::int,0),coalesce((p_sale->>'zerobody')::int,0),coalesce((p_sale->>'normatec')::int,0),coalesce((p_sale->>'oxygen')::int,0),'booking','booking-paid:'||b.id,b.id,auth.uid())
 on conflict(booking_id) do update set sale_date=excluded.sale_date,customer_name=excluded.customer_name,services=excluded.services,note=excluded.note,
 staff_id=excluded.staff_id,therapist=excluded.therapist,therapist_amount=excluded.therapist_amount,is_internal=excluded.is_internal,internal_amount=excluded.internal_amount,gift_card=excluded.gift_card,
 golomt=excluded.golomt,khan=excluded.khan,cash=excluded.cash,barter=excluded.barter,invoice=0,refund=0,cryo_cabin=excluded.cryo_cabin,oxy_pro=excluded.oxy_pro,led_pro=excluded.led_pro,x_cryo=excluded.x_cryo,zerobody=excluded.zerobody,normatec=excluded.normatec,oxygen=excluded.oxygen,archived_at=null,needs_review=false
 returning * into s;
 update public.bookings set payment_status='paid',paid_at=now(),staff_id=staff_key where id=b.id returning * into b;
 return jsonb_build_object('booking',to_jsonb(b),'sale',to_jsonb(s));
end $$;


-- pay_bookings: allocate gift card like the other payment channels.
create or replace function private.pay_bookings(p_booking_ids bigint[],p_sale jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare anchor public.bookings%rowtype; b public.bookings%rowtype;
 result jsonb; results jsonb:='[]'; sale_rows jsonb:='[]'; part jsonb; remaining jsonb:=p_sale;
 total bigint:=0; price bigint; due bigint; allocation bigint; channel text; supplied bigint:=0; n int:=0;
 internal_mode boolean:=coalesce((p_sale->>'is_internal')::boolean,false) or coalesce((p_sale->>'internal_amount')::bigint,0)>0;
 sale_day date:=nullif(p_sale->>'sale_date','')::date; sale_json jsonb;
begin
 perform private.require_cryo_staff(nullif(p_sale->>'staff_id','')::bigint);
 if p_booking_ids is null or cardinality(p_booking_ids)=0 then raise exception 'Захиалга сонгоно уу'; end if;
 -- Lock in id order so concurrent checkouts of overlapping sets cannot deadlock.
 perform 1 from public.bookings where id=any(p_booking_ids) order by id for update;
 select * into anchor from public.bookings where id=p_booking_ids[1];
 if not found then raise exception 'Захиалга олдсонгүй'; end if;
 for b in select * from public.bookings where id=any(p_booking_ids) order by id loop
  -- Same customer = same team, else same phone, else (no phone) same name.
  if b.team_id is distinct from anchor.team_id
   or (anchor.team_id is null and private.normalize_mn_phone(anchor.phone) is not null and private.normalize_mn_phone(b.phone) is distinct from private.normalize_mn_phone(anchor.phone))
   or (anchor.team_id is null and private.normalize_mn_phone(anchor.phone) is null and lower(btrim(b.customer_name)) is distinct from lower(btrim(anchor.customer_name))) then
   raise exception 'Нэг үйлчлүүлэгчийн захиалгуудыг л нэгтгэж төлнө';
  end if;
 end loop;
 foreach channel in array array['cash','golomt','khan','barter','gift_card','internal_amount'] loop
  allocation:=coalesce((p_sale->>channel)::bigint,0);
  if allocation<0 then raise exception 'Төлөлтийн дүн буруу'; end if;
  supplied:=supplied+allocation;
 end loop;
 if internal_mode and supplied<>coalesce((p_sale->>'internal_amount')::bigint,0) then raise exception 'Дотоод бүртгэлийг мөнгөн төлбөртэй холихгүй'; end if;
 for b in select * from public.bookings where id=any(p_booking_ids) and status<>'cancelled' and payment_status<>'paid' and booking_kind<>'package' order by id loop
  select s.price into price from public.services s where s.id=b.service_id and s.active;
  if price is null or price<=0 then raise exception 'Үндсэн үнэ олдсонгүй'; end if;
  total:=total+price; n:=n+1;
 end loop;
 if n=0 then raise exception 'Төлөх захиалга үлдээгүй байна. Хуудсаа шинэчилнэ үү.'; end if;
 if internal_mode then supplied:=total;remaining:=remaining||jsonb_build_object('internal_amount',total);end if;
 if total<>supplied then raise exception 'Нийт төлбөр %₮ байх ёстой. Захиалгаа шинэчилнэ үү.',total; end if;
 for b in select * from public.bookings where id=any(p_booking_ids) and status<>'cancelled' and payment_status<>'paid' and booking_kind<>'package' order by id loop
  select s.price into due from public.services s where s.id=b.service_id;
  part:=p_sale||jsonb_build_object('customer_name',b.customer_name,'services',b.service,'internal_amount',0,'gift_card',0,'therapist_amount',0);
  foreach channel in array array['cash','golomt','khan','barter','gift_card','internal_amount'] loop
   allocation:=least(due,coalesce((remaining->>channel)::bigint,0));
   part:=part||jsonb_build_object(channel,allocation);
   remaining:=remaining||jsonb_build_object(channel,coalesce((remaining->>channel)::bigint,0)-allocation);
   due:=due-allocation;
  end loop;
  result:=private.pay_booking(b.id,part);
  -- Administrators back-filling a past appointment record the sale on the visit day.
  if sale_day is not null and public.is_admin() then
   update public.sales sl set sale_date=sale_day where sl.id=(result->'sale'->>'id')::bigint returning to_jsonb(sl) into sale_json;
   result:=result||jsonb_build_object('sale',sale_json);
  end if;
  results:=results||jsonb_build_array(result->'booking');sale_rows:=sale_rows||jsonb_build_array(result->'sale');
 end loop;
 return jsonb_build_object('bookings',results,'sales',sale_rows,'booking',results->0,'sale',sale_rows->0);
end $$;
revoke all on function private.pay_bookings(bigint[],jsonb) from public,anon;
grant execute on function private.pay_bookings(bigint[],jsonb) to authenticated;
create or replace function public.pay_bookings(p_booking_ids bigint[],p_sale jsonb)
returns jsonb language sql security invoker set search_path='' as $$select private.pay_bookings(p_booking_ids,p_sale)$$;
revoke all on function public.pay_bookings(bigint[],jsonb) from public,anon;
grant execute on function public.pay_bookings(bigint[],jsonb) to authenticated;

-- ════════ 20261113110000_staff_edit_delete_bookings.sql ════════
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

-- ════════ 20261113120000_service_menu_calendar_blocks.sql ════════
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
select 'Амжилттай' as result, (select count(*) from public.customers) as customers, (select count(*) from public.services where parent_id is not null) as beauty_services;
