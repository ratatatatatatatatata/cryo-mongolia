-- Integration assertions. All test records roll back; no real sale is committed.
begin;
do $$ <<qa>>
declare employee_id bigint; user_id uuid; customer_id bigint; service public.services%rowtype;
  request jsonb; result jsonb; again jsonb; booking_id bigint; contract_id bigint; denied boolean;
begin
  select id into user_id from public.profiles where role='staff' and lower(email)='cryomongolia@gmail.com';
  select id into employee_id from public.staff where active order by id limit 1;
  select id into customer_id from public.customers order by id limit 1;
  select * into service from public.services where active and price>0 and category<>'legacy-import' order by id limit 1;
  if user_id is null or employee_id is null or customer_id is null or service.id is null then raise exception 'Missing QA fixtures'; end if;
  perform set_config('request.jwt.claim.sub',user_id::text,true);
  request:=jsonb_build_object('request_id',gen_random_uuid(),'staff_id',employee_id,'customer_id',customer_id,
    'package_name','QA rollback package','items',jsonb_build_array(jsonb_build_object('service_id',service.id,'units',2)),
    'base_price',1000000,'discount_percent',15,'amount',850000,'sale_date',(now() at time zone 'Asia/Ulaanbaatar')::date,'payment_method','khan');
  execute 'set local role authenticated';
  result:=public.sell_customer_package(request);
  if (result#>>'{sale,total}')::bigint<>850000 or (result#>>'{contract,total_units}')::integer<>2 then raise exception 'Discount or units failed'; end if;
  again:=public.sell_customer_package(request);
  if again#>>'{sale,id}'<>result#>>'{sale,id}' then raise exception 'Duplicate package sale'; end if;
  contract_id:=(result#>>'{contract,id}')::bigint;
  insert into public.package_redemptions(contract_id,used_on,units,service_id,service_label,staff_id)
    values(contract_id,current_date,2,service.id,service.name,employee_id);
  denied:=false;
  begin
    insert into public.package_redemptions(contract_id,used_on,units,service_id,service_label,staff_id)
      values(contract_id,current_date,1,service.id,service.name,employee_id);
  exception when raise_exception then denied:=true;
  end;
  if not denied then raise exception 'Entitlement overspend was accepted'; end if;
  insert into public.bookings(ref,customer_name,service_id,starts_at,status,staff_id)
    values('QA-'||gen_random_uuid(),'QA rollback booking',service.id,'2099-12-01 10:00+08','pending',employee_id) returning id into booking_id;
  result:=public.set_booking_status(booking_id,'confirmed',employee_id);
  if (result#>>'{sale,invoice}')::bigint<>service.price then raise exception 'Booking price failed'; end if;
  if (result#>>'{sale,sale_date}')::date<>(now() at time zone 'Asia/Ulaanbaatar')::date then raise exception 'Confirmation date failed'; end if;
  again:=public.set_booking_status(booking_id,'confirmed',employee_id);
  if again#>>'{sale,id}'<>result#>>'{sale,id}' then raise exception 'Duplicate booking sale'; end if;
  again:=public.set_booking_status(booking_id,'cancelled',employee_id);
  if (again#>>'{sale,total}')::bigint<>0 then raise exception 'Cancelled unpaid invoice was not cleared'; end if;
  again:=public.set_booking_status(booking_id,'confirmed',employee_id);
  if (again#>>'{sale,total}')::bigint<>service.price then raise exception 'Reconfirmation failed'; end if;
  perform public.set_booking_status(booking_id,'done',employee_id);
  insert into public.bookings(ref,customer_name,service_id,starts_at,status,staff_id,booking_kind)
    values('QA-'||gen_random_uuid(),'QA package booking',service.id,'2099-12-02 10:00+08','confirmed',employee_id,'package') returning id into booking_id;
  if exists(select 1 from public.sales where sales.booking_id=qa.booking_id) then raise exception 'Package charged twice'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  denied:=false;
  begin perform public.set_booking_status(booking_id,'cancelled',employee_id);
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Nonemployee could update bookings'; end if;
end $$;
rollback;
select 'Transaction, entitlement, price, idempotency and role assertions passed; test records rolled back' as result;
