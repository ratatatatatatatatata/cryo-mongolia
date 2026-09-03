-- Cover workbook attendance foreign key and keep one admin RLS policy per action.
create index if not exists attendance_staff_id_idx on public.attendance(staff_id) where staff_id is not null;
drop policy if exists "admins read staff workdays" on public.staff_workdays;
