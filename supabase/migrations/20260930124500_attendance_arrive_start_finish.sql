alter table public.attendance
  alter column clock_in drop not null,
  alter column clock_in drop default;

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
  v_today date := (now() at time zone 'Asia/Ulaanbaatar')::date;
begin
  if current_user = 'postgres' or (select public.is_admin()) then return new; end if;
  if not (select public.is_cryo_employee()) then
    raise exception 'Only Cryo Mongolia employees may record attendance';
  end if;

  if tg_op = 'INSERT' then
    select s.id, s.name into v_staff_id, v_staff_name
    from public.staff s
    where s.id = new.staff_id and s.active;

    if v_staff_id is null then
      raise exception 'Select an active employee before registering attendance';
    end if;

    select coalesce(max(x.workday_number), 0) + 1 into v_workday_number
    from (
      select a.workday_number from public.attendance a where a.staff_id = v_staff_id
      union all
      select w.workday_number from public.staff_workdays w where w.staff_id = v_staff_id
    ) x;

    new.user_id := (select auth.uid());
    new.staff_id := v_staff_id;
    new.staff_name := v_staff_name;
    new.work_date := v_today;
    new.workday_number := v_workday_number;
    new.clock_in := null;
    new.clock_out := null;
    new.note := null;
    return new;
  end if;

  if old.work_date is distinct from v_today then
    raise exception 'Only today attendance may be updated by employees';
  end if;
  if old.clock_out is not null then
    raise exception 'Attendance has already been closed';
  end if;

  new := old;
  if old.clock_in is null then
    new.clock_in := v_now;
  else
    new.clock_out := v_now;
  end if;
  return new;
end;
$$;

drop policy if exists "employees read attendance" on public.attendance;
create policy "employees read attendance"
on public.attendance for select
to authenticated
using (
  (select public.is_admin())
  or (
    (select public.is_cryo_employee())
    and work_date = (now() at time zone 'Asia/Ulaanbaatar')::date
  )
);

drop policy if exists "employees clock in" on public.attendance;
create policy "employees register attendance"
on public.attendance for insert
to authenticated
with check (
  (select public.is_cryo_employee())
  and user_id = (select auth.uid())
  and work_date = (now() at time zone 'Asia/Ulaanbaatar')::date
  and exists (
    select 1 from public.staff s
    where s.id = attendance.staff_id and s.active
  )
);

drop policy if exists "employees clock out" on public.attendance;
create policy "employees start and finish work"
on public.attendance for update
to authenticated
using (
  (select public.is_cryo_employee())
  and work_date = (now() at time zone 'Asia/Ulaanbaatar')::date
)
with check (
  (select public.is_cryo_employee())
  and work_date = (now() at time zone 'Asia/Ulaanbaatar')::date
);

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'cryo-close-open-attendance-midnight';
  if v_job_id is not null then
    perform cron.alter_job(
      job_id := v_job_id,
      command := $job$
        update public.attendance
        set clock_out = ((work_date + 1)::timestamp at time zone 'Asia/Ulaanbaatar')
        where clock_in is not null
          and clock_out is null
          and work_date < (now() at time zone 'Asia/Ulaanbaatar')::date;
      $job$
    );
  end if;
end;
$$;
