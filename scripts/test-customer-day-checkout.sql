-- Run against a database with all migrations applied. Rolls back.
begin;
do $$
declare admin_uid uuid; staff_uid uuid; employee bigint; b1 bigint; b2 bigint; b3 bigint; other bigint; r jsonb; denied boolean; pkg bigint; cust bigint;
begin
 select id into admin_uid from public.profiles where role in ('owner','admin') limit 1;
 if admin_uid is null then
  insert into auth.users(email) values('qa-admin@example.com') returning id into admin_uid;
  insert into public.profiles(id,email,role) values(admin_uid,'qa-admin@example.com','admin') on conflict(id) do update set role='admin';
 end if;
 insert into auth.users(email) values('qa-staff@example.com') returning id into staff_uid;
 insert into public.profiles(id,email,role) values(staff_uid,'qa-staff@example.com','staff') on conflict(id) do update set role='staff';
 select id into employee from public.staff where active order by id limit 1;
 update public.staff set email='qa-staff@example.com',user_id=staff_uid where id=employee;
 perform set_config('request.jwt.claim.sub',staff_uid::text,true);
 execute 'set local role authenticated';

 -- Three slots for the same phone made in separate actions (different booking_group, one name variant).
 insert into public.bookings(ref,booking_group,customer_name,phone,service_id,starts_at,status) values('QA-'||gen_random_uuid(),gen_random_uuid()::text,'QA Day','99001122',(select id from public.services where slug='cryocabin'),'2099-11-05 10:00+08','confirmed') returning id into b1;
 insert into public.bookings(ref,booking_group,customer_name,phone,service_id,starts_at,status) values('QA-'||gen_random_uuid(),gen_random_uuid()::text,'QA Day uvuu','9900 1122',(select id from public.services where slug='xcryo'),'2099-11-05 11:00+08','confirmed') returning id into b2;
 insert into public.bookings(ref,customer_name,phone,service_id,starts_at,status) values('QA-'||gen_random_uuid(),'Someone else','88001122',(select id from public.services where slug='ledpro'),'2099-11-05 12:00+08','confirmed') returning id into other;

 -- New name + phone was registered as a customer automatically (first spelling wins, phone unique).
 if (select count(*) from public.customers where phone='99001122')<>1 then raise exception 'customer not auto-registered'; end if;
 if not exists(select 1 from public.customers where phone='88001122' and full_name='Someone else') then raise exception 'second customer missing'; end if;

 -- Mixing customers is refused.
 denied:=false; begin perform public.pay_bookings(array[b1,other],jsonb_build_object('staff_id',employee,'cash',1)); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'mixed customers accepted'; end if;
 -- Underpayment is refused atomically.
 denied:=false; begin perform public.pay_bookings(array[b1,b2],jsonb_build_object('staff_id',employee,'cash',1)); exception when raise_exception then denied:=true; end;
 if not denied or exists(select 1 from public.sales where booking_id in (b1,b2)) then raise exception 'underpayment accepted'; end if;
 -- One payment for both slots; device counts come from the booked services; staff cannot backdate.
 r:=public.pay_bookings(array[b1,b2],jsonb_build_object('staff_id',employee,'customer_name','QA Day','cash',149000,'khan',59000,'sale_date','2099-01-01'));
 if jsonb_array_length(r->'sales')<>2 then raise exception 'expected two sale rows'; end if;
 if (select sum(total) from public.sales where booking_id in (b1,b2))<>208000 then raise exception 'total wrong'; end if;
 if (select sum(cryo_cabin) from public.sales where booking_id in (b1,b2))<>1 or (select sum(x_cryo) from public.sales where booking_id in (b1,b2))<>1 then raise exception 'device counts wrong'; end if;
 if exists(select 1 from public.sales where booking_id in (b1,b2) and sale_date='2099-01-01') then raise exception 'staff backdated'; end if;
 if exists(select 1 from public.bookings where id in (b1,b2) and payment_status<>'paid') then raise exception 'not marked paid'; end if;
 -- Retry is idempotent.
 denied:=false; begin perform public.pay_bookings(array[b1,b2],jsonb_build_object('staff_id',employee,'cash',208000)); exception when raise_exception then denied:=true; end;
 if (select count(*) from public.sales where booking_id in (b1,b2))<>2 then raise exception 'duplicate sales on retry'; end if;

 -- Internal staff usage: base price goes to internal_amount, nothing to revenue.
 insert into public.bookings(ref,customer_name,phone,service_id,starts_at,status) values('QA-'||gen_random_uuid(),'QA Staff','99887766',(select id from public.services where slug='oxypro'),'2099-11-06 10:00+08','confirmed') returning id into b3;
 r:=public.pay_bookings(array[b3],jsonb_build_object('staff_id',employee,'customer_name','QA Staff','is_internal',true,'internal_amount',1));
 if (r#>>'{sale,internal_amount}')::bigint<>129000 or (r#>>'{sale,total}')::bigint<>0 or not (r#>>'{sale,is_internal}')::boolean then raise exception 'internal usage wrong'; end if;

 -- Gift card pays a booking without counting as cash revenue.
 insert into public.bookings(ref,customer_name,phone,service_id,starts_at,status) values('QA-'||gen_random_uuid(),'QA Gift','99887755',(select id from public.services where slug='ledpro'),'2099-11-07 10:00+08','confirmed') returning id into b3;
 r:=public.pay_bookings(array[b3],jsonb_build_object('staff_id',employee,'customer_name','QA Gift','gift_card',139000));
 if (r#>>'{sale,gift_card}')::bigint<>139000 or (r#>>'{sale,total}')::bigint<>0 or (r#>>'{sale,led_pro}')::int<>1 then raise exception 'gift card payment wrong: %',r->'sale'; end if;
 -- Staff can see past, not-yet-done appointments.
 execute 'reset role'; alter table public.bookings disable trigger zz_guard_booking_backdate;
 insert into public.bookings(ref,customer_name,phone,service_id,starts_at,status) values('QA-'||gen_random_uuid(),'QA Old','99880000',(select id from public.services where slug='oxygen'),'2020-01-02 10:00+08','confirmed') returning id into b3;
 alter table public.bookings enable trigger zz_guard_booking_backdate;
 execute 'set local role authenticated';
 if not exists(select 1 from public.bookings where id=b3) then raise exception 'staff cannot see past booking'; end if;

 -- Staff back-fill a past slot, correct it, and delete it; a paid booking is admin-only.
 insert into public.bookings(ref,customer_name,phone,service_id,starts_at,status) values('QA-'||gen_random_uuid(),'QA Back','99770001',(select id from public.services where slug='zerobody'),'2020-02-02 10:00+08','confirmed') returning id into b3;
 r:=public.edit_booking(b3,jsonb_build_object('customer_name',' QA  Backfill ','phone','99770002','note','x','starts_at','2020-02-02 11:00+08'));
 if r->>'customer_name'<>'QA Backfill' or r->>'booked_time'<>'11:00' or r->>'phone'<>'99770002' then raise exception 'staff edit failed: %',r; end if;
 perform public.delete_booking(b3);
 if exists(select 1 from public.bookings where id=b3) or exists(select 1 from public.sales where booking_id=b3) then raise exception 'staff delete failed'; end if;
 denied:=false; begin perform public.delete_booking(b1); exception when raise_exception then denied:=true; end;
 if not denied or not exists(select 1 from public.bookings where id=b1) then raise exception 'staff deleted a paid booking'; end if;

 -- Staff cannot toggle VIP on customers.
 select id into cust from public.customers where phone='99001122';
 denied:=false; begin perform public.set_vip('customer',cust,true); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'staff toggled VIP'; end if;

 -- Admin: backfilled past slot keeps the visit day; VIP package marks buyer VIP.
 perform set_config('request.jwt.claim.sub',admin_uid::text,true);
 insert into public.bookings(ref,customer_name,phone,service_id,starts_at,status) values('QA-'||gen_random_uuid(),'QA Past','99112200',(select id from public.services where slug='normatec'),'2020-03-04 10:00+08','done') returning id into b3;
 r:=public.pay_bookings(array[b3],jsonb_build_object('staff_id',employee,'customer_name','QA Past','cash',49000,'sale_date','2020-03-04'));
 if (r#>>'{sale,sale_date}')::date<>'2020-03-04' then raise exception 'admin backfill date lost: %',r#>>'{sale,sale_date}'; end if;
 insert into public.packages(slug,name,price,service_units,active) values('qa-vip-'||gen_random_uuid(),'QA VIP',1,'[]',true) returning id into pkg;
 perform public.set_vip('package',pkg,true);
 insert into public.customer_package_contracts(customer_id,customer_label,package_id,package_label,status) values(cust,'QA Day',pkg,'QA VIP','active');
 if not (select is_vip from public.customers where id=cust) then raise exception 'VIP package did not mark customer'; end if;
 -- Hour-long sessions book back to back; nested treatments share the parent's calendar.
 insert into public.bookings(ref,customer_name,phone,service_id,starts_at,status) values('QA-'||gen_random_uuid(),'QA M1','99660001',(select id from public.services where slug='massage'),'2099-12-05 10:00+08','confirmed');
 insert into public.bookings(ref,customer_name,phone,service_id,starts_at,status) values('QA-'||gen_random_uuid(),'QA M2','99660002',(select id from public.services where slug='massage'),'2099-12-05 11:00+08','confirmed');
 insert into public.bookings(ref,customer_name,phone,service_id,starts_at,status) values('QA-'||gen_random_uuid(),'QA F1','99660003',(select id from public.services where slug='beauty-teatree'),'2099-12-05 10:00+08','confirmed') returning id into b3;
 if (select blocked_until-starts_at from public.bookings where id=b3)<>interval '90 minutes' or (select calendar_id from public.bookings where id=b3)<>(select id from public.services where slug='facial') then raise exception 'child calendar/block wrong'; end if;
 denied:=false; begin insert into public.bookings(ref,customer_name,phone,service_id,starts_at,status) values('QA-'||gen_random_uuid(),'QA F2','99660004',(select id from public.services where slug='beauty-wax-brow'),'2099-12-05 11:00+08','confirmed'); exception when exclusion_violation then denied:=true; end;
 if not denied then raise exception 'overlap inside shared calendar accepted'; end if;
 insert into public.bookings(ref,customer_name,phone,service_id,starts_at,status) values('QA-'||gen_random_uuid(),'QA F2','99660004',(select id from public.services where slug='beauty-wax-brow'),'2099-12-05 11:30+08','confirmed');
 if (select count(*) from public.booking_blocks where service_id=(select id from public.services where slug='facial') and starts_at::date='2099-12-05')<>2 then raise exception 'blocks not published on parent calendar'; end if;
 -- Removing a service: unused → deleted, used → archived.
 if not (public.remove_service((select id from public.services where slug='beauty-vitadx'))->>'deleted')::boolean then raise exception 'unused service not deleted'; end if;
 r:=public.remove_service((select id from public.services where slug='beauty-wax-brow'));
 if (r->>'deleted')::boolean or (select archived_at from public.services where slug='beauty-wax-brow') is null then raise exception 'used service not archived: %',r; end if;

 -- Admin deletes a paid booking: the sale is archived, not lost.
 r:=public.delete_booking(b1);
 if exists(select 1 from public.bookings where id=b1) or not (r->>'sale_archived')::boolean or not exists(select 1 from public.sales where id=(r->>'sale_id')::bigint and archived_at is not null and booking_id is null) then raise exception 'admin paid delete failed: %',r; end if;
 raise notice 'PASS service menu calendar, staff edit/delete, gift card, staff past visibility, same-day multi-slot checkout, auto customer registry, internal usage, admin backfill date, VIP';
end $$;
rollback;
