begin;
do $$
declare uid uuid; staff_id bigint; svc public.services%rowtype; bid bigint; bid2 bigint; bid3 bigint; group_ref text:=gen_random_uuid()::text; result jsonb; denied boolean;
begin
 select id into uid from public.profiles where role='staff' and lower(email)='cryomongolia@gmail.com';
 select id into staff_id from public.staff where active order by id limit 1;
 select * into svc from public.services where active and price>0 and category<>'legacy-import' order by id limit 1;
 perform set_config('request.jwt.claim.sub',uid::text,true);
 execute 'set local role authenticated';
 insert into public.bookings(ref,booking_group,customer_name,phone,service_id,starts_at,status) values('QA-'||gen_random_uuid(),group_ref,'QA grouped','99000000',svc.id,'2099-11-05 10:00+08','pending') returning id into bid;
 insert into public.bookings(ref,booking_group,customer_name,phone,service_id,starts_at,status) values('QA-'||gen_random_uuid(),group_ref,'QA grouped','99000000',svc.id,'2099-11-06 10:00+08','pending') returning id into bid2;
 denied:=false;
 begin perform public.pay_booking_group(bid,jsonb_build_object('staff_id',staff_id,'cash',1)); exception when raise_exception then denied:=true; end;
 if not denied or exists(select 1 from public.sales where booking_id in(bid,bid2)) then raise exception 'Underpayment / atomicity failed'; end if;
 result:=public.pay_booking_group(bid,jsonb_build_object('staff_id',staff_id,'cash',svc.price,'khan',svc.price));
 if jsonb_array_length(result->'bookings')<>2 or (select sum(total) from public.sales where booking_id in(bid,bid2))<>svc.price*2 then raise exception 'Grouped total failed'; end if;
 perform public.pay_booking_group(bid,jsonb_build_object('staff_id',staff_id,'cash',svc.price*2));
 if (select count(*) from public.sales where booking_id in(bid,bid2))<>2 then raise exception 'Duplicate retry'; end if;
 insert into public.bookings(ref,customer_name,phone,service_id,starts_at,status) values('QA-'||gen_random_uuid(),'QA internal','99000000',svc.id,'2099-11-07 10:00+08','pending') returning id into bid3;
 result:=public.pay_booking(bid3,jsonb_build_object('staff_id',staff_id,'customer_name','QA internal','services',svc.name,'internal_amount',1));
 if (result#>>'{sale,internal_amount}')::bigint<>svc.price or (result#>>'{sale,total}')::bigint<>0 or (result#>>'{sale,sale_date}')::date<>(now() at time zone 'Asia/Ulaanbaatar')::date then raise exception 'Internal base price / cash separation failed'; end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);denied:=false;
 begin perform public.pay_booking_group(bid,jsonb_build_object('staff_id',staff_id,'cash',svc.price*2)); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Unauthorized payment accepted'; end if;
end $$;
do $$
declare staff_uid uuid; admin_uid uuid; employee bigint; svc public.services%rowtype; b1 bigint;b2 bigint;g text:=gen_random_uuid()::text;r jsonb;denied boolean:=false;
begin
 execute 'reset role';
 select id into staff_uid from public.profiles where role='staff' and lower(email)='cryomongolia@gmail.com';
 select id into admin_uid from public.profiles where role in ('owner','admin') order by role limit 1;
 select id into employee from public.staff where active order by id limit 1;
 select * into svc from public.services where slug='cryocabin' and active;
 perform set_config('request.jwt.claim.sub',staff_uid::text,true);execute 'set local role authenticated';
 insert into public.bookings(ref,booking_group,customer_name,phone,service_id,starts_at,status) values('QA-'||gen_random_uuid(),g,'QA internal group','99000000',svc.id,'2099-10-01 10:00+08','pending') returning id into b1;
 insert into public.bookings(ref,booking_group,customer_name,phone,service_id,starts_at,status) values('QA-'||gen_random_uuid(),g,'QA internal group','99000000',svc.id,'2099-10-02 10:00+08','pending') returning id into b2;
 r:=public.pay_booking_group(b1,jsonb_build_object('staff_id',employee,'is_internal',true,'internal_amount',1));
 if jsonb_array_length(r->'sales')<>2 or (select sum(internal_amount) from public.sales where booking_id in(b1,b2))<>svc.price*2 or (select sum(total) from public.sales where booking_id in(b1,b2))<>0 or (select sum(cryo_cabin) from public.sales where booking_id in(b1,b2))<>2 then raise exception 'Internal group price, counts or cash total failed';end if;
 begin insert into public.bookings(ref,customer_name,service_id,starts_at,status) values('QA-'||gen_random_uuid(),'QA past',svc.id,'2000-01-03 10:00+08','confirmed'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Staff backdated a booking';end if;
 if admin_uid is null then raise exception 'Missing admin test identity';end if;
 perform set_config('request.jwt.claim.sub',admin_uid::text,true);
 insert into public.bookings(ref,customer_name,service_id,starts_at,status) values('QA-'||gen_random_uuid(),'QA admin past',svc.id,'2000-01-03 10:00+08','confirmed');
 denied:=false;
 begin insert into public.bookings(ref,customer_name,service_id,starts_at,status) values('QA-'||gen_random_uuid(),'QA conflict',svc.id,'2000-01-03 10:00+08','confirmed'); exception when exclusion_violation then denied:=true;end;
 if not denied then raise exception 'Past appointment overlap allowed';end if;
end $$;
rollback;
