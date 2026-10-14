alter table public.packages add column service_units jsonb not null default '[]';
alter table public.packages add column discount_percent numeric(5,2) not null default 0 check(discount_percent between 0 and 100);
alter table public.customer_package_contracts add column service_units jsonb not null default '[]';
alter table public.bookings add column staff_id bigint references public.staff(id);
alter table public.sales add column booking_id bigint unique references public.bookings(id);
alter table public.sales add column quoted_price bigint;

drop policy if exists "staff read bookings" on public.bookings;
create policy "staff read bookings" on public.bookings for select to authenticated
using (exists(select 1 from public.profiles where id=(select auth.uid()) and role='staff')
  and (booked_date >= (now() at time zone 'Asia/Ulaanbaatar')::date or status='done'));

-- Privileged routines are private; exposed wrappers run as the signed-in caller.
grant usage on schema private to authenticated;
create or replace function private.require_cryo_staff(p_staff_id bigint)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_cryo_employee() then raise exception 'Ажилтны эрх шаардлагатай' using errcode='42501'; end if;
  if p_staff_id is null and public.is_admin() then return; end if;
  if not exists(select 1 from public.staff where id=p_staff_id and active and
    (public.is_admin() or public.is_shared_staff_account() or user_id=auth.uid())) then
    raise exception 'Ажилтны нэрээ сонгоно уу' using errcode='42501';
  end if;
end $$;
revoke all on function private.require_cryo_staff(bigint) from public,anon,authenticated;

create or replace function private.sync_confirmed_booking_sale()
returns trigger language plpgsql security definer set search_path='' as $$
declare svc public.services%rowtype; employee public.staff%rowtype;
begin
  -- Public checkout cannot post accounting entries or assign an employee.
  if auth.uid() is null or not public.is_cryo_employee() then return new; end if;
  if TG_OP='UPDATE' then
    if new.status is not distinct from old.status then return new; end if;
  end if;
  if new.booking_kind='package' then return new; end if;
  if new.status='confirmed' then
    perform private.require_cryo_staff(new.staff_id);
    select * into svc from public.services where id=new.service_id;
    if not found or svc.price is null or svc.price<0 then raise exception 'Төхөөрөмжийн үнэ тодорхойгүй'; end if;
    select * into employee from public.staff where id=new.staff_id;
    insert into public.sales(sale_date,customer_name,phone,services,invoice,staff_id,therapist,source,source_key,created_by,booking_id,quoted_price,note)
    values((now() at time zone 'Asia/Ulaanbaatar')::date,new.customer_name,new.phone,svc.name,svc.price,new.staff_id,employee.name,
      'booking','booking-confirmed:'||new.id,auth.uid(),new.id,svc.price,'Захиалга '||new.ref||' · Төлбөрийн банк бүртгэгдээгүй')
    on conflict(booking_id) do update set invoice=case
      when public.sales.golomt+public.sales.khan+public.sales.cash+public.sales.barter+public.sales.refund=0
      then public.sales.quoted_price else public.sales.invoice end;
  elsif new.status in ('pending','cancelled') then
    -- Keep the accounting record. Unpaid invoices become zero; recorded payments require review.
    update public.sales set invoice=0,needs_review=(golomt+khan+cash+barter+refund<>0)
    where booking_id=new.id;
  end if;
  return new;
end $$;
revoke all on function private.sync_confirmed_booking_sale() from public,anon,authenticated;
create trigger sync_confirmed_booking_sale after insert or update of status on public.bookings
for each row execute function private.sync_confirmed_booking_sale();

create or replace function private.set_booking_status(p_booking_id bigint,p_status text,p_staff_id bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare row public.bookings%rowtype; sale public.sales%rowtype;
begin
  perform private.require_cryo_staff(p_staff_id);
  if p_status not in ('pending','confirmed','done','cancelled') or p_status is null then raise exception 'Буруу төлөв'; end if;
  select * into row from public.bookings where id=p_booking_id for update;
  if not found then raise exception 'Захиалга олдсонгүй'; end if;
  update public.bookings set status=p_status,staff_id=p_staff_id where id=p_booking_id returning * into row;
  select * into sale from public.sales where booking_id=p_booking_id;
  return jsonb_build_object('booking',to_jsonb(row),'sale',case when sale.id is null then null else to_jsonb(sale) end);
end $$;
revoke all on function private.set_booking_status(bigint,text,bigint) from public,anon;
grant execute on function private.set_booking_status(bigint,text,bigint) to authenticated;
create or replace function public.set_booking_status(p_booking_id bigint,p_status text,p_staff_id bigint default null)
returns jsonb language sql security invoker set search_path='' as $$select private.set_booking_status(p_booking_id,p_status,p_staff_id)$$;
revoke all on function public.set_booking_status(bigint,text,bigint) from public,anon;
grant execute on function public.set_booking_status(bigint,text,bigint) to authenticated;

create or replace function private.sell_customer_package(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  employee_id bigint := nullif(p_request->>'staff_id','')::bigint;
  customer public.customers%rowtype; pkg public.packages%rowtype; sale public.sales%rowtype;
  contract public.customer_package_contracts%rowtype; item jsonb; svc public.services%rowtype;
  items jsonb := '[]'; units integer := 0; base_price integer; discount numeric; final_price integer;
  request_key text := 'package-sale:'|| (p_request->>'request_id')::uuid;
  method text := p_request->>'payment_method'; amount bigint := (p_request->>'amount')::bigint;
begin
  perform private.require_cryo_staff(employee_id);
  if request_key is null then raise exception 'Бүртгэлийн дугаар шаардлагатай'; end if;
  perform pg_advisory_xact_lock(hashtextextended(request_key,0));
  select * into sale from public.sales where source_key=request_key;
  if found then
    if sale.created_by<>auth.uid() then raise exception 'Эрх хүрэхгүй' using errcode='42501'; end if;
    select * into contract from public.customer_package_contracts where source_key=request_key;
    return jsonb_build_object('sale',to_jsonb(sale),'contract',to_jsonb(contract));
  end if;
  select * into customer from public.customers where id=(p_request->>'customer_id')::bigint;
  if not found then raise exception 'Үйлчлүүлэгчээ сонгоно уу'; end if;
  if method is null or method not in ('golomt','khan','cash','invoice','barter') or amount is null or amount<0 then raise exception 'Төлбөрийн мэдээлэл буруу'; end if;
  if p_request->>'package_id' is null then
    if jsonb_typeof(p_request->'items') is distinct from 'array' or jsonb_array_length(p_request->'items')=0 then raise exception 'Төхөөрөмж болон оролтын тоогоо оруулна уу'; end if;
    for item in select value from jsonb_array_elements(p_request->'items') loop
      if (item->>'units')::integer not between 1 and 1000 or item->>'units' is null then raise exception 'Оролтын тоо 1–1000 байна'; end if;
      select * into svc from public.services where id=(item->>'service_id')::bigint and active and category<>'legacy-import';
      if not found then raise exception 'Төхөөрөмж олдсонгүй'; end if;
      if exists(select 1 from jsonb_array_elements(items) x where (x->>'service_id')::bigint=svc.id) then raise exception 'Төхөөрөмж давхардсан'; end if;
      items := items||jsonb_build_array(jsonb_build_object('service_id',svc.id,'service_name',svc.name,'units',(item->>'units')::integer));
      units := units+(item->>'units')::integer;
    end loop;
    base_price := (p_request->>'base_price')::integer; discount := (p_request->>'discount_percent')::numeric;
    if base_price is null or base_price<=0 or discount is null or discount not between 0 and 100 then raise exception 'Үндсэн үнэ эсвэл хөнгөлөлт буруу'; end if;
    discount := round(discount,2);
    final_price := round(base_price*(100-discount)/100);
    if amount<>final_price then raise exception 'Төлөх дүн хөнгөлөлтийн тооцоотой зөрж байна'; end if;
    insert into public.packages(slug,name,old_price,price,discount_percent,service_units,active)
    values('custom-'||(p_request->>'request_id')::uuid,coalesce(nullif(trim(p_request->>'package_name'),''),'Тусгай багц'),base_price,final_price,discount,items,true)
    returning * into pkg;
  else
    select * into pkg from public.packages where id=(p_request->>'package_id')::bigint and active and archived_at is null;
    if not found then raise exception 'Багц олдсонгүй'; end if;
    items := pkg.service_units;
    select coalesce(sum((x->>'units')::integer),0) into units from jsonb_array_elements(items) x;
  end if;
  insert into public.sales(sale_date,customer_id,customer_name,phone,services,staff_id,therapist,golomt,khan,cash,invoice,barter,source,source_key,created_by,note)
  values((p_request->>'sale_date')::date,customer.id,customer.full_name,customer.phone,'Багц: '||pkg.name,employee_id,
    (select name from public.staff where id=employee_id),case when method='golomt' then amount else 0 end,
    case when method='khan' then amount else 0 end,case when method='cash' then amount else 0 end,
    case when method='invoice' then amount else 0 end,case when method='barter' then amount else 0 end,
    'manual',request_key,auth.uid(),nullif(p_request->>'note','')) returning * into sale;
  insert into public.customer_package_contracts(customer_id,customer_label,package_id,package_label,purchased_on,total_units,status,source_key,service_units,created_by)
  values(customer.id,customer.full_name,pkg.id,pkg.name,sale.sale_date,nullif(units,0),case when units>0 then 'active' else 'needs_review' end,request_key,items,auth.uid()) returning * into contract;
  return jsonb_build_object('sale',to_jsonb(sale),'contract',to_jsonb(contract),'package',to_jsonb(pkg));
end $$;
revoke all on function private.sell_customer_package(jsonb) from public,anon;
grant execute on function private.sell_customer_package(jsonb) to authenticated;
create or replace function public.sell_customer_package(p_request jsonb)
returns jsonb language sql security invoker set search_path='' as $$select private.sell_customer_package(p_request)$$;
revoke all on function public.sell_customer_package(jsonb) from public,anon;
grant execute on function public.sell_customer_package(jsonb) to authenticated;

create or replace function private.check_package_service_units()
returns trigger language plpgsql security definer set search_path='' as $$
declare contract public.customer_package_contracts%rowtype; allowance integer; spent integer;
begin
  select * into contract from public.customer_package_contracts where id=new.contract_id for update;
  if jsonb_array_length(contract.service_units)=0 then return new; end if;
  if contract.status<>'active' or (contract.expires_on is not null and new.used_on>contract.expires_on) then raise exception 'Багц идэвхгүй эсвэл хугацаа дууссан'; end if;
  select (x->>'units')::integer into allowance from jsonb_array_elements(contract.service_units) x where (x->>'service_id')::bigint=new.service_id;
  select coalesce(sum(units),0) into spent from public.package_redemptions where contract_id=new.contract_id and service_id=new.service_id and id<>new.id;
  if allowance is null or spent+new.units>allowance then raise exception 'Энэ төхөөрөмжийн багцын эрх хүрэлцэхгүй'; end if;
  return new;
end $$;
revoke all on function private.check_package_service_units() from public,anon,authenticated;
create trigger check_package_service_units before insert or update on public.package_redemptions for each row execute function private.check_package_service_units();
