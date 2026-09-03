-- Admin-managed shifts and attendance.
-- Staff can still clock themselves in/out; admins can add, correct and delete any row.

alter table public.attendance
  alter column user_id drop not null;

alter table public.attendance
  drop constraint if exists attendance_one_shift;

alter table public.attendance
  drop constraint if exists attendance_has_identity;

alter table public.attendance
  add constraint attendance_has_identity
  check (user_id is not null or staff_id is not null);

create unique index if not exists attendance_user_day_unique
  on public.attendance (work_date, user_id)
  where user_id is not null;

create unique index if not exists attendance_staff_day_unique
  on public.attendance (work_date, staff_id)
  where staff_id is not null;

drop policy if exists "admins manage attendance" on public.attendance;
drop policy if exists "admins create attendance" on public.attendance;
drop policy if exists "admins update attendance" on public.attendance;
drop policy if exists "admins delete attendance" on public.attendance;

create policy "admins create attendance" on public.attendance
  for insert to authenticated
  with check ((select public.is_admin()));

create policy "admins update attendance" on public.attendance
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "admins delete attendance" on public.attendance
  for delete to authenticated
  using ((select public.is_admin()));

grant select, insert, update, delete on public.attendance to authenticated;

