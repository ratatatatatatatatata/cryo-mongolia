-- Shared employee login: each active employee may register one attendance row
-- per Ulaanbaatar work date. The old user/day index incorrectly limited the
-- shared account to a single employee attendance row per day.
drop index if exists public.attendance_user_day_unique;

-- This existing index is the intended identity rule and makes repeated clicks
-- idempotent at the database boundary, including concurrent requests.
create unique index if not exists attendance_staff_day_unique
  on public.attendance (work_date, staff_id)
  where staff_id is not null;
