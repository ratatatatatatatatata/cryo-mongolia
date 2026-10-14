drop index public.attendance_staff_day_unique;
create unique index attendance_staff_open_day_unique on public.attendance(work_date,staff_id) where staff_id is not null and clock_out is null;
create function public.start_employee_attendance(p_staff_id bigint) returns public.attendance
language plpgsql security invoker set search_path='' as $$
declare result public.attendance%rowtype; person public.staff%rowtype; today date:=(now() at time zone 'Asia/Ulaanbaatar')::date;
begin
 if auth.uid() is null or not public.is_cryo_employee() then raise exception 'Ажилтны эрх шаардлагатай' using errcode='42501'; end if;
 select * into person from public.staff where id=p_staff_id and active;
 if not found then raise exception 'Идэвхтэй ажилтнаа сонгоно уу'; end if;
 perform pg_advisory_xact_lock(hashtextextended('attendance:'||p_staff_id::text||':'||today::text,0));
 select * into result from public.attendance where staff_id=p_staff_id and work_date=today and clock_out is null for update;
 if not found then
  insert into public.attendance(work_date,staff_id,staff_name,user_id,workday_number,clock_in)
  values(today,person.id,person.name,auth.uid(),extract(isodow from today)::integer,null) returning * into result;
 end if;
 if result.clock_in is null then
  update public.attendance set clock_in=now() where id=result.id returning * into result;
 end if;
 return result;
end $$;
revoke all on function public.start_employee_attendance(bigint) from public,anon;
grant execute on function public.start_employee_attendance(bigint) to authenticated;
