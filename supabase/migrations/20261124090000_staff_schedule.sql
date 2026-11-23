-- Ээлжийн хуваарь: who is due on shift each day.
--
-- The "Work Schedule" sheet plans the month ahead — names per day, with
-- hours only where a shift is split. That is a plan, not a record of who
-- clocked in, so it gets its own table instead of being forced into
-- attendance, where every row needs a clock-in time that the sheet never
-- had. Attendance stays what staff actually clocked.

create table if not exists public.staff_schedule (
  id bigint generated always as identity primary key,
  staff_id bigint references public.staff(id) on delete cascade,
  staff_name text not null check (char_length(btrim(staff_name)) between 1 and 160),
  work_date date not null,
  shift_start time,
  shift_end time,
  note text check (char_length(note) <= 300),
  source text not null default 'manual' check (source in ('manual', 'workbook')),
  source_key text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint staff_schedule_one_per_day unique (staff_name, work_date),
  constraint staff_schedule_hours_order check (shift_end is null or shift_start is null or shift_end > shift_start)
);

create index if not exists staff_schedule_date_idx on public.staff_schedule(work_date);
create unique index if not exists staff_schedule_source_key_unique
  on public.staff_schedule(source_key) where source_key is not null;

alter table public.staff_schedule enable row level security;

drop policy if exists "employees read schedule" on public.staff_schedule;
drop policy if exists "admins manage schedule" on public.staff_schedule;

-- everyone on the team needs to see who is on; only admins change the plan
create policy "employees read schedule" on public.staff_schedule for select to authenticated
  using ((select public.is_cryo_employee()));
create policy "admins manage schedule" on public.staff_schedule for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

grant select, insert, update, delete on public.staff_schedule to authenticated;
grant usage, select on sequence public.staff_schedule_id_seq to authenticated;
