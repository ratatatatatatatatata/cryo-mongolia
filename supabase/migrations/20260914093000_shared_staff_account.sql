-- All employees use one shared staff login, then choose the staff directory
-- entry they are acting as. The selected staff_id remains on each sale and
-- attendance record, while auth.uid() still records the shared login account.

create or replace function public.is_shared_staff_account()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.role = 'staff'
      and lower(profile.email) = 'cryomongolia@gmail.com'
  );
$$;

revoke all on function public.is_shared_staff_account() from public, anon;
grant execute on function public.is_shared_staff_account() to authenticated, service_role;

drop policy if exists "employees create own sales" on public.sales;
drop policy if exists "employees update own sales" on public.sales;

create policy "employees create own sales" on public.sales
  for insert to authenticated
  with check (
    (select public.is_cryo_employee())
    and created_by = (select auth.uid())
    and (
      (select public.is_admin())
      or (
        (select public.is_shared_staff_account())
        and exists (
          select 1 from public.staff employee
          where employee.id = sales.staff_id and employee.active
        )
      )
      or exists (
        select 1 from public.staff employee
        where employee.id = sales.staff_id
          and employee.active
          and employee.user_id = (select auth.uid())
      )
    )
  );

create policy "employees update own sales" on public.sales
  for update to authenticated
  using (
    (select public.is_admin())
    or (
      (select public.is_cryo_employee())
      and created_by = (select auth.uid())
    )
  )
  with check (
    (select public.is_admin())
    or (
      (select public.is_cryo_employee())
      and created_by = (select auth.uid())
      and (
        (
          (select public.is_shared_staff_account())
          and exists (
            select 1 from public.staff employee
            where employee.id = sales.staff_id and employee.active
          )
        )
        or (
          exists (
            select 1 from public.staff employee
            where employee.id = sales.staff_id
              and employee.active
              and employee.user_id = (select auth.uid())
          )
        )
      )
    )
  );

comment on function public.is_shared_staff_account() is
  'True only for the fixed Cryo Mongolia shared staff login.';
