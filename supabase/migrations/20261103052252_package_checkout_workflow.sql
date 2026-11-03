-- Keep cash revenue separate from complimentary internal usage.
alter table public.sales add column internal_amount bigint not null default 0 check(internal_amount>=0);
alter table public.sales add column package_contract_id bigint references public.customer_package_contracts(id);
create index sales_package_contract_idx on public.sales(package_contract_id);
create function private.protect_package_sale() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user not in ('postgres','supabase_admin') then
  if new.package_contract_id is not null then raise exception 'Багцын төлөлтийг багцын дэлгэрэнгүйгээс бүртгэнэ үү' using errcode='42501'; end if;
  if TG_OP='UPDATE' and old.package_contract_id is not null then raise exception 'Багцын төлөлтийн холбоосыг өөрчилж болохгүй' using errcode='42501'; end if;
 end if;
 return new;
end $$;
revoke all on function private.protect_package_sale() from public,anon,authenticated;
create trigger protect_package_sale before insert or update of package_contract_id,golomt,khan,cash,invoice,barter,refund,internal_amount on public.sales for each row execute function private.protect_package_sale();
alter table public.customer_package_contracts add column agreed_price bigint check(agreed_price>=0);
alter table public.customer_package_contracts add column opening_paid bigint not null default 0 check(opening_paid>=0);
alter table public.bookings add column package_contract_id bigint references public.customer_package_contracts(id);
create index bookings_package_contract_idx on public.bookings(package_contract_id);
create table public.package_account_events (
 id bigint generated always as identity primary key,
 request_id uuid not null unique,
 contract_id bigint references public.customer_package_contracts(id),
 action text not null,
 detail jsonb not null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
alter table public.package_account_events enable row level security;
grant select on public.package_account_events to authenticated;
create policy "employees read package account events" on public.package_account_events for select to authenticated using((select public.is_cryo_employee()));
create index package_events_contract_idx on public.package_account_events(contract_id);

create function private.package_payment_history() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_cryo_employee() then raise exception 'Эрх хүрэхгүй' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'package_contract_id',package_contract_id,'sale_date',sale_date,'total',total,'internal_amount',internal_amount,'golomt',golomt,'khan',khan,'cash',cash,'invoice',invoice,'barter',barter,'note',note) order by id) from public.sales where package_contract_id is not null and archived_at is null),'[]'::jsonb);
end $$;
revoke all on function private.package_payment_history() from public,anon;
grant execute on function private.package_payment_history() to authenticated;
create function public.package_payment_history() returns jsonb language sql security invoker set search_path='' as $$select private.package_payment_history()$$;
revoke all on function public.package_payment_history() from public,anon;
grant execute on function public.package_payment_history() to authenticated;

-- New packages and their payments are atomic and retry-safe. Historical imports
-- retain NULL agreed_price until an administrator verifies their opening balance.
create function private.package_checkout(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 a text:=p->>'action'; req uuid:=(p->>'request_id')::uuid; employee bigint:=nullif(p->>'staff_id','')::bigint;
 result jsonb; prior_event public.package_account_events%rowtype;
 pkg public.packages%rowtype; c public.customer_package_contracts%rowtype;
 cust public.customers%rowtype; s public.sales%rowtype; b public.bookings%rowtype;
 items jsonb:='[]'; item jsonb; svc public.services%rowtype; units integer:=0;
 amount bigint; paid bigint; base bigint; discount numeric; method text:=p->>'payment_method';
 day date:=coalesce(nullif(p->>'sale_date','')::date,(now() at time zone 'Asia/Ulaanbaatar')::date);
 old_state jsonb;
begin
 perform private.require_cryo_staff(employee);
 if req is null then raise exception 'Бүртгэлийн дугаар шаардлагатай'; end if;
 perform pg_advisory_xact_lock(hashtextextended(req::text,0));
 select * into prior_event from public.package_account_events where request_id=req;
 if found then
  if prior_event.created_by<>auth.uid() then raise exception 'Эрх хүрэхгүй' using errcode='42501'; end if;
  return prior_event.detail;
 end if;
 if a='template' then
  if nullif(trim(p->>'package_name'),'') is null or length(trim(p->>'package_name'))>120 then raise exception 'Багцын нэр оруулна уу'; end if;
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items')=0 then raise exception 'Үйлчилгээ болон тоогоо оруулна уу'; end if;
  for item in select value from jsonb_array_elements(p->'items') loop
   if coalesce((item->>'units')::numeric,0) not between 1 and 1000 or (item->>'units')::numeric<>trunc((item->>'units')::numeric) then raise exception 'Орох тоо 1–1000 бүхэл тоо байна'; end if;
   select * into svc from public.services where id=(item->>'service_id')::bigint and active and category<>'legacy-import';
   if not found or exists(select 1 from jsonb_array_elements(items) x where (x->>'service_id')::bigint=svc.id) then raise exception 'Үйлчилгээ буруу эсвэл давхардсан'; end if;
   items:=items||jsonb_build_array(jsonb_build_object('service_id',svc.id,'service_name',svc.name,'units',(item->>'units')::int));
  end loop;
  base:=(p->>'base_price')::bigint; discount:=(p->>'discount_percent')::numeric;
  if base is null or base<=0 or base>2147483647 or discount is null or discount not between 0 and 100 then raise exception 'Үнэ / хөнгөлөлт буруу'; end if;
  insert into public.packages(slug,name,old_price,price,discount_percent,service_units,active)
   values('custom-'||req,trim(p->>'package_name'),base,round(base*(100-round(discount,2))/100),round(discount,2),items,true) returning * into pkg;
  result:=jsonb_build_object('package',to_jsonb(pkg));
 elsif a in ('sell','pay','change','transfer','link','opening') then
  if a='sell' then
   select * into cust from public.customers where id=(p->>'customer_id')::bigint;
   if not found then raise exception 'Үйлчлүүлэгчээ сонгоно уу'; end if;
   select * into pkg from public.packages where id=(p->>'package_id')::bigint and active and archived_at is null;
   if not found then raise exception 'Багц олдсонгүй'; end if;
   select coalesce(sum((x->>'units')::int),0) into units from jsonb_array_elements(pkg.service_units) x;
   insert into public.customer_package_contracts(customer_id,customer_label,package_id,package_label,purchased_on,total_units,status,source_key,service_units,created_by,agreed_price,notes)
    values(cust.id,cust.full_name,pkg.id,pkg.name,day,nullif(units,0),case when units>0 then 'active' else 'needs_review' end,'package-sale:'||req,pkg.service_units,auth.uid(),pkg.price,nullif(p->>'note','')) returning * into c;
  else
   select * into c from public.customer_package_contracts where id=(p->>'contract_id')::bigint for update;
   if not found then raise exception 'Багцын бүртгэл олдсонгүй'; end if;
   if c.status in ('cancelled','expired') then raise exception 'Багц идэвхгүй'; end if;
  end if;
  select coalesce(sum(total+internal_amount),0) into paid from public.sales where package_contract_id=c.id and archived_at is null;
  paid:=paid+c.opening_paid;
  if a in ('sell','pay') then
   if c.agreed_price is null then raise exception 'Хуучин багцын тохирсон үнэ, өмнөх төлөлтийг админаар баталгаажуулна уу'; end if;
   if method is null or method not in ('golomt','khan','cash','invoice','barter','internal') then raise exception 'Төлбөрийн хэлбэр сонгоно уу'; end if;
   if (p->>'amount')::numeric<>trunc((p->>'amount')::numeric) then raise exception 'Бүхэл дүн оруулна уу'; end if;
   amount:=(p->>'amount')::bigint;
   if amount is null or amount<0 or amount>c.agreed_price-paid or (a='pay' and amount=0) then raise exception 'Төлөлт үлдэгдлээс их эсвэл буруу байна'; end if;
   insert into public.sales(sale_date,customer_id,customer_name,services,staff_id,therapist,golomt,khan,cash,invoice,barter,internal_amount,is_internal,source,source_key,created_by,note,package_contract_id,quoted_price)
    values(day,c.customer_id,c.customer_label,'Багц: '||c.package_label,employee,(select name from public.staff where id=employee),
     case when method='golomt' then amount else 0 end,case when method='khan' then amount else 0 end,
     case when method='cash' then amount else 0 end,case when method='invoice' then amount else 0 end,
     case when method='barter' then amount else 0 end,case when method='internal' then amount else 0 end,method='internal',
     'manual','package-payment:'||req,auth.uid(),nullif(p->>'note',''),c.id,c.agreed_price) returning * into s;
   result:=jsonb_build_object('sale',to_jsonb(s),'contract',to_jsonb(c));
   if a='sell' and nullif(p->>'booking_id','') is not null then
    select * into b from public.bookings where id=(p->>'booking_id')::bigint for update;
    if not found or b.status='cancelled' or b.payment_status='paid' or b.customer_name<>c.customer_label then raise exception 'Захиалга / үйлчлүүлэгч зөрж байна'; end if;
    if not exists(select 1 from jsonb_array_elements(c.service_units) x where (x->>'service_id')::bigint=b.service_id) then raise exception 'Энэ үйлчилгээ сонгосон багцад байхгүй'; end if;
    update public.bookings set booking_kind='package',package=c.package_label,package_contract_id=c.id where id=b.id returning * into b;
    result:=result||jsonb_build_object('booking',to_jsonb(b));
   end if;
  elsif a='opening' then
   if not public.is_admin() or c.agreed_price is not null then raise exception 'Зөвхөн админ хуучин багцын эхний үлдэгдлийг баталгаажуулна'; end if;
   base:=(p->>'agreed_price')::bigint; amount:=(p->>'opening_paid')::bigint;
   if base is null or amount is null or base<0 or amount<0 or amount>base or nullif(trim(p->>'note'),'') is null then raise exception 'Тохирсон үнэ, төлсөн дүн, нотлох тэмдэглэл оруулна уу'; end if;
   old_state:=to_jsonb(c);
   update public.customer_package_contracts set agreed_price=base,opening_paid=amount where id=c.id returning * into c;
   result:=jsonb_build_object('contract',to_jsonb(c),'before',old_state,'note',p->>'note');
  elsif a='change' then
   if c.agreed_price is null then raise exception 'Хуучин багцын төлөлт баталгаажаагүй'; end if;
   select * into pkg from public.packages where id=(p->>'package_id')::bigint and active and archived_at is null;
   if not found or jsonb_array_length(pkg.service_units)=0 then raise exception 'Оролтын тоо тохируулсан багц сонгоно уу'; end if;
   if pkg.id=c.package_id then raise exception 'Өөр багц сонгоно уу'; end if;
   if pkg.price<paid then raise exception 'Шинэ үнэ өмнөх төлөлтөөс бага байна. Буцаалт/тооцоог админаар шийдвэрлэнэ үү'; end if;
   if exists(select 1 from public.package_redemptions r where r.contract_id=c.id group by r.service_id having sum(r.units)>coalesce((select (x->>'units')::int from jsonb_array_elements(pkg.service_units) x where (x->>'service_id')::bigint=r.service_id),0)) then raise exception 'Шинэ багц ашигласан оролтыг бүрэн багтаах ёстой'; end if;
   old_state:=to_jsonb(c);
   select sum((x->>'units')::int) into units from jsonb_array_elements(pkg.service_units) x;
   update public.customer_package_contracts set package_id=pkg.id,package_label=pkg.name,service_units=pkg.service_units,total_units=units,agreed_price=pkg.price,status='active' where id=c.id returning * into c;
   result:=jsonb_build_object('contract',to_jsonb(c),'before',old_state,'paid',paid,'balance',c.agreed_price-paid);
  elsif a='transfer' then
   select * into cust from public.customers where id=(p->>'customer_id')::bigint;
   if not found or cust.id=c.customer_id then raise exception 'Шилжүүлэн авах өөр үйлчлүүлэгч сонгоно уу'; end if;
   if nullif(trim(p->>'note'),'') is null then raise exception 'Шилжүүлэх шалтгаан оруулна уу'; end if;
   old_state:=to_jsonb(c);
   update public.customer_package_contracts set customer_id=cust.id,customer_label=cust.full_name where id=c.id returning * into c;
   result:=jsonb_build_object('contract',to_jsonb(c),'before',old_state,'note',p->>'note');
  elsif a='link' then
   select * into b from public.bookings where id=(p->>'booking_id')::bigint for update;
   if not found or b.status='cancelled' or b.payment_status='paid' then raise exception 'Төлөгдөөгүй идэвхтэй захиалга сонгоно уу'; end if;
   if b.customer_name<>c.customer_label then raise exception 'Захиалга болон багцын үйлчлүүлэгч зөрж байна'; end if;
   if c.status<>'active' or (c.expires_on is not null and coalesce(b.booked_date,day)>c.expires_on) then raise exception 'Багц идэвхгүй эсвэл хугацаа дууссан'; end if;
   if not exists(select 1 from jsonb_array_elements(c.service_units) x where (x->>'service_id')::bigint=b.service_id) then raise exception 'Захиалсан үйлчилгээ энэ багцад байхгүй'; end if;
   update public.bookings set booking_kind='package',package=c.package_label,package_contract_id=c.id where id=b.id returning * into b;
   result:=jsonb_build_object('booking',to_jsonb(b),'contract',to_jsonb(c));
  end if;
 else raise exception 'Үйлдэл буруу';
 end if;
 insert into public.package_account_events(request_id,contract_id,action,detail,created_by) values(req,c.id,a,result,auth.uid());
 return result;
end $$;
revoke all on function private.package_checkout(jsonb) from public,anon;
grant execute on function private.package_checkout(jsonb) to authenticated;
create function public.package_checkout(p jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.package_checkout(p)$$;
revoke all on function public.package_checkout(jsonb) from public,anon;
grant execute on function public.package_checkout(jsonb) to authenticated;

-- Retry-safe member addition on an existing active team.
create function private.add_sports_member(p_team bigint,p_name text) returns public.sports_team_members language plpgsql security definer set search_path='' as $$
declare m public.sports_team_members%rowtype;
begin
 if auth.uid() is null or not public.is_cryo_employee() then raise exception 'Эрх хүрэхгүй' using errcode='42501'; end if;
 perform 1 from public.sports_teams where id=p_team and archived_at is null for update;
 if not found then raise exception 'Идэвхтэй баг сонгоно уу'; end if;
 if nullif(trim(p_name),'') is null or length(trim(p_name))>200 then raise exception 'Нэрээ зөв оруулна уу'; end if;
 select * into m from public.sports_team_members where team_id=p_team and lower(trim(full_name))=lower(trim(p_name)) and archived_at is null order by id limit 1;
 if not found then insert into public.sports_team_members(team_id,full_name,created_by) values(p_team,trim(p_name),auth.uid()) returning * into m; end if;
 return m;
end $$;
revoke all on function private.add_sports_member(bigint,text) from public,anon;
grant execute on function private.add_sports_member(bigint,text) to authenticated;
create function public.add_sports_member(p_team bigint,p_name text) returns public.sports_team_members language sql security invoker set search_path='' as $$select private.add_sports_member(p_team,p_name)$$;
revoke all on function public.add_sports_member(bigint,text) from public,anon;
grant execute on function public.add_sports_member(bigint,text) to authenticated;

create or replace function private.pay_booking(p_booking_id bigint,p_sale jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.bookings%rowtype; s public.sales%rowtype; employee public.staff%rowtype;
 staff_key bigint:=nullif(p_sale->>'staff_id','')::bigint; k text; n numeric;
 g bigint:=coalesce((p_sale->>'golomt')::bigint,0); h bigint:=coalesce((p_sale->>'khan')::bigint,0);
 c bigint:=coalesce((p_sale->>'cash')::bigint,0); internal_value bigint:=coalesce((p_sale->>'internal_amount')::bigint,0); barter_value bigint:=coalesce((p_sale->>'barter')::bigint,0);
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
 foreach k in array array['internal_amount','golomt','khan','cash','barter','invoice','refund','therapist_amount','gift_card','cryo_cabin','oxy_pro','led_pro','x_cryo','zerobody','normatec','oxygen'] loop
  n:=coalesce((p_sale->>k)::numeric,0);
  if n<0 or n<>trunc(n) or n>2147483647 then raise exception 'Тоо, дүн эерэг бүхэл тоо байна'; end if;
 end loop;
 if g+h+c+barter_value+internal_value<=0 or coalesce((p_sale->>'invoice')::bigint,0)<>0 or coalesce((p_sale->>'refund')::bigint,0)<>0 then raise exception 'Төлсөн дүнгээ банк, бэлэн эсвэл бартерт оруулна уу'; end if;
 if nullif(trim(p_sale->>'customer_name'),'') is null or nullif(trim(p_sale->>'services'),'') is null then raise exception 'Үйлчлүүлэгч, үйлчилгээг бөглөнө үү'; end if;
 select * into employee from public.staff where id=staff_key;
 insert into public.sales(sale_date,customer_name,phone,services,note,staff_id,therapist,therapist_amount,is_internal,internal_amount,gift_card,
 golomt,khan,cash,barter,invoice,refund,cryo_cabin,oxy_pro,led_pro,x_cryo,zerobody,normatec,oxygen,source,source_key,booking_id,created_by)
 values((now() at time zone 'Asia/Ulaanbaatar')::date,trim(p_sale->>'customer_name'),b.phone,trim(p_sale->>'services'),p_sale->>'note',staff_key,employee.name,
 coalesce((p_sale->>'therapist_amount')::bigint,0),(internal_value>0 or coalesce((p_sale->>'is_internal')::boolean,false)),internal_value,coalesce((p_sale->>'gift_card')::bigint,0),
 g,h,c,barter_value,0,0,coalesce((p_sale->>'cryo_cabin')::int,0),coalesce((p_sale->>'oxy_pro')::int,0),coalesce((p_sale->>'led_pro')::int,0),coalesce((p_sale->>'x_cryo')::int,0),coalesce((p_sale->>'zerobody')::int,0),coalesce((p_sale->>'normatec')::int,0),coalesce((p_sale->>'oxygen')::int,0),'booking','booking-paid:'||b.id,b.id,auth.uid())
 on conflict(booking_id) do update set sale_date=excluded.sale_date,customer_name=excluded.customer_name,services=excluded.services,note=excluded.note,
 staff_id=excluded.staff_id,therapist=excluded.therapist,therapist_amount=excluded.therapist_amount,is_internal=excluded.is_internal,internal_amount=excluded.internal_amount,gift_card=excluded.gift_card,
 golomt=excluded.golomt,khan=excluded.khan,cash=excluded.cash,barter=excluded.barter,invoice=0,refund=0,cryo_cabin=excluded.cryo_cabin,oxy_pro=excluded.oxy_pro,led_pro=excluded.led_pro,x_cryo=excluded.x_cryo,zerobody=excluded.zerobody,normatec=excluded.normatec,oxygen=excluded.oxygen,archived_at=null,needs_review=false
 returning * into s;
 update public.bookings set payment_status='paid',paid_at=now(),staff_id=staff_key where id=b.id returning * into b;
 return jsonb_build_object('booking',to_jsonb(b),'sale',to_jsonb(s));
end $$;

-- Entitlements from index.html published package descriptions; only empty templates.
with definitions as (select key as slug,value from jsonb_each('{"discover": {"cryocabin": 1, "xcryo": 1, "ledpro": 1, "zerobody": 1, "normatec": 1, "oxypro": 1, "oxygen": 1}, "athlete": {"cryocabin": 6, "normatec": 8, "xcryo": 4, "oxypro": 4, "zerobody": 2, "massage": 2, "oxygen": 8}, "reset": {"oxypro": 8, "oxygen": 8, "cryocabin": 4, "zerobody": 4, "ledpro": 4, "normatec": 4, "massage": 2}, "glow": {"ledpro": 8, "xcryo": 8, "facial": 4, "oxypro": 2, "zerobody": 2, "oxygen": 8}, "sleep": {"oxypro": 8, "oxygen": 8, "zerobody": 4, "ledpro": 4, "cryocabin": 2, "massage": 2}, "agereset": {"cryocabin": 8, "ledpro": 8, "xcryo": 8, "oxygen": 8, "oxypro": 4, "normatec": 4, "zerobody": 4, "massage": 4, "facial": 4}, "under21": {"ledpro": 6, "xcryo": 6, "oxygen": 6, "facial": 5, "zerobody": 3}}'::jsonb)), mapped as (select d.slug,jsonb_agg(jsonb_build_object('service_id',s.id,'service_name',s.name,'units',v.value::int) order by s.id) items from definitions d cross join lateral jsonb_each_text(d.value) v join public.services s on s.slug=v.key group by d.slug) update public.packages p set service_units=m.items from mapped m where p.slug=m.slug and p.service_units='[]'::jsonb;
