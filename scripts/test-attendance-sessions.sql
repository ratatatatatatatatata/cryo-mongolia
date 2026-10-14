begin;
do $$
declare actor uuid; employee bigint; first_row public.attendance%rowtype; again public.attendance%rowtype; second_row public.attendance%rowtype; blocked boolean:=false;
begin
 select id into actor from public.profiles where lower(email)='cryomongolia@gmail.com' and role='staff';
 if actor is null then raise exception 'Missing shared staff test actor'; end if;
 insert into public.staff(name,email,active) values('QA rollback attendance',gen_random_uuid()::text||'@example.invalid',true) returning id into employee;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 execute 'set local role authenticated';
 first_row:=public.start_employee_attendance(employee);
 if first_row.clock_in is null or first_row.clock_out is not null then raise exception 'First start failed'; end if;
 again:=public.start_employee_attendance(employee);
 if again.id<>first_row.id or again.clock_out is not null then raise exception 'Repeat start duplicated or closed session'; end if;
 update public.attendance set clock_out=now() where id=first_row.id returning * into first_row;
 if first_row.clock_out is null then raise exception 'Finish failed'; end if;
 second_row:=public.start_employee_attendance(employee);
 if second_row.id=first_row.id or second_row.clock_in is null or second_row.clock_out is not null then raise exception 'Restart failed'; end if;
 if (select count(*) from public.attendance where staff_id=employee)<>2 then raise exception 'History not preserved'; end if;
 begin insert into public.attendance(staff_id,staff_name,user_id,work_date) values(employee,'QA',actor,current_date);
 exception when unique_violation then blocked:=true; end;
 if not blocked then raise exception 'Multiple open sessions allowed'; end if;
 if (select clock_out from public.attendance where id=first_row.id) is distinct from first_row.clock_out then raise exception 'Earlier session changed'; end if;
 update public.attendance set clock_out=now() where id=second_row.id;
 execute 'reset role';
end $$;
rollback;
select 'Start, retry, finish, restart, preserved history and duplicate-open protection passed; rolled back' as result;
