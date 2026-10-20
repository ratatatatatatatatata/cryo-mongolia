begin;
do $$
declare uid uuid; sid bigint; bid bigint; result jsonb; denied boolean:=false;
begin
 select id into uid from public.profiles where role='staff' and lower(email)='cryomongolia@gmail.com';
 select id into sid from public.staff where active order by id limit 1;
 perform set_config('request.jwt.claim.sub',uid::text,true);
 execute 'set local role authenticated';
 insert into public.bookings(ref,customer_name,status,booked_date) values('QA-'||gen_random_uuid(),'QA provider','confirmed',current_date) returning id into bid;
 result:=public.record_booking_provider(bid,sid);
 if result->>'status'<>'done' or (result->>'performed_by')::bigint<>sid or result->>'performed_at' is null then raise exception 'Provider missing'; end if;
 if result->>'payment_status'<>'pending' or exists(select 1 from public.sales where booking_id=bid) then raise exception 'Provider created payment'; end if;
 result:=public.record_booking_provider(bid,sid);
 begin perform public.record_booking_provider(bid,-1); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'Invalid provider accepted'; end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
 denied:=false;
 begin perform public.record_booking_provider(bid,sid); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Nonemployee accepted'; end if;
end $$;
rollback;
