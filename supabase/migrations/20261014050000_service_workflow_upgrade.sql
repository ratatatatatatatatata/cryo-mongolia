-- Service workflow upgrade: individual attendance, package visits and grouped bookings.

alter table public.bookings
  add column if not exists booking_group text,
  add column if not exists booking_kind text not null default 'standard';

alter table public.bookings drop constraint if exists bookings_booking_kind_check;
alter table public.bookings add constraint bookings_booking_kind_check
  check (booking_kind in ('standard', 'package')) not valid;

create index if not exists bookings_group_idx on public.bookings (booking_group);

-- Employees record each package device used on the actual visit date.
drop policy if exists "employees create package redemptions" on public.package_redemptions;
create policy "employees create package redemptions"
on public.package_redemptions for insert to authenticated
with check (
  (select public.is_cryo_employee())
  and created_by = (select auth.uid())
  and units > 0
  and exists (
    select 1 from public.customer_package_contracts contract
    where contract.id = package_redemptions.contract_id
  )
  and exists (
    select 1 from public.staff employee
    where employee.id = package_redemptions.staff_id
      and employee.active
      and (
        (select public.is_admin())
        or (select public.is_shared_staff_account())
        or employee.user_id = (select auth.uid())
      )
  )
);

grant insert on public.package_redemptions to authenticated;
grant usage, select on sequence public.package_redemptions_id_seq to authenticated;

-- Shared staff can register only the selected person's row; individual accounts
-- remain limited to their linked staff row. Admins keep full access.
drop policy if exists "employees start and finish work" on public.attendance;
create policy "employees start and finish own work"
on public.attendance for update to authenticated
using (
  (select public.is_admin())
  or (
    (select public.is_cryo_employee())
    and work_date = ((now() at time zone 'Asia/Ulaanbaatar')::date)
    and (
      (select public.is_shared_staff_account())
      or exists (
        select 1 from public.staff employee
        where employee.id = attendance.staff_id
          and employee.active
          and employee.user_id = (select auth.uid())
      )
    )
  )
)
with check (
  (select public.is_admin())
  or (
    (select public.is_cryo_employee())
    and work_date = ((now() at time zone 'Asia/Ulaanbaatar')::date)
    and (
      (select public.is_shared_staff_account())
      or exists (
        select 1 from public.staff employee
        where employee.id = attendance.staff_id
          and employee.active
          and employee.user_id = (select auth.uid())
      )
    )
  )
);

