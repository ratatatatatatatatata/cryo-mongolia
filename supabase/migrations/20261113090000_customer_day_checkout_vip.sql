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
