-- Close attendance left open at Ulaanbaatar midnight.
create extension if not exists pg_cron;

-- Scheduled jobs run as the database owner. Allow that trusted role to apply
-- the exact clock-out timestamp while keeping browser writes protected by RLS.
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
  if current_user = 'postgres' or (select public.is_admin()) then return new; end if;
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

-- Bring any previously forgotten shifts up to date immediately.
update public.attendance
set clock_out = ((work_date + 1)::timestamp at time zone 'Asia/Ulaanbaatar')
where clock_out is null
  and work_date < (now() at time zone 'Asia/Ulaanbaatar')::date;

select cron.unschedule(jobid)
from cron.job
where jobname = 'cryo-close-open-attendance-midnight';

select cron.schedule(
  'cryo-close-open-attendance-midnight',
  '0 16 * * *',
  $cron$
    update public.attendance
    set clock_out = ((work_date + 1)::timestamp at time zone 'Asia/Ulaanbaatar')
    where clock_out is null
      and work_date < (now() at time zone 'Asia/Ulaanbaatar')::date;
  $cron$
);
