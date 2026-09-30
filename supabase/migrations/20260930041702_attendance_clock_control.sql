drop policy if exists "employees clock in" on public.attendance;
create policy "employees clock in"
on public.attendance for insert to authenticated
with check (
  (select public.is_cryo_employee())
  and user_id = (select auth.uid())
  and exists (
    select 1 from public.staff s
    where s.id = attendance.staff_id and s.active
      and ((select public.is_shared_staff_account()) or s.user_id = (select auth.uid()))
  )
);

drop policy if exists "employees clock out" on public.attendance;
create policy "employees clock out"
on public.attendance for update to authenticated
using (user_id = (select auth.uid()) and (select public.is_cryo_employee()))
with check (user_id = (select auth.uid()) and (select public.is_cryo_employee()));

drop policy if exists "staff workdays read access" on public.staff_workdays;
create policy "staff workdays read access"
on public.staff_workdays for select to authenticated
using (
  (select public.is_admin())
  or exists (
    select 1 from public.staff s
    where s.id = staff_workdays.staff_id and s.active
      and (s.user_id = (select auth.uid()) or (select public.is_shared_staff_account()))
  )
);

create or replace function public.protect_employee_attendance_clock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_staff_id bigint;
  v_staff_name text;
  v_workday_number integer;
  v_now timestamptz := now();
begin
  if (select public.is_admin()) then return new; end if;
  if not (select public.is_cryo_employee()) then
    raise exception 'Only Cryo Mongolia employees may record attendance';
  end if;

  if tg_op = 'INSERT' then
    if (select public.is_shared_staff_account()) then
      select s.id, s.name into v_staff_id, v_staff_name
      from public.staff s where s.id = new.staff_id and s.active;
    else
      select s.id, s.name into v_staff_id, v_staff_name
      from public.staff s
      where s.user_id = (select auth.uid()) and s.active
      order by s.id limit 1;
    end if;
    if v_staff_id is null then raise exception 'Select an active employee before clocking in'; end if;

    select coalesce(max(x.workday_number), 0) + 1 into v_workday_number
    from (
      select a.workday_number from public.attendance a where a.staff_id = v_staff_id
      union all
      select w.workday_number from public.staff_workdays w where w.staff_id = v_staff_id
    ) x;

    new.user_id := (select auth.uid());
    new.staff_id := v_staff_id;
    new.staff_name := v_staff_name;
    new.work_date := (v_now at time zone 'Asia/Ulaanbaatar')::date;
    new.workday_number := v_workday_number;
    new.clock_in := v_now;
    new.clock_out := null;
    new.note := null;
    return new;
  end if;

  if old.user_id is distinct from (select auth.uid()) then raise exception 'You may only clock out your own attendance'; end if;
  if old.clock_out is not null then raise exception 'Clock-out time has already been recorded'; end if;
  if new.clock_out is null then raise exception 'Clock-out time is required'; end if;
  new := old;
  new.clock_out := v_now;
  return new;
end;
$$;

drop trigger if exists protect_employee_attendance_clock on public.attendance;
create trigger protect_employee_attendance_clock
before insert or update on public.attendance
for each row execute function public.protect_employee_attendance_clock();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attendance'
  ) then
    alter publication supabase_realtime add table public.attendance;
  end if;
end
$$;
