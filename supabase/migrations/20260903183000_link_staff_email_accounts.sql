-- Link staff records to Supabase Auth by email while preserving historical reports.

alter table public.staff add column if not exists email text;
alter table public.staff add column if not exists user_id uuid references auth.users(id) on delete set null;

comment on column public.staff.email is 'Normalized sign-in email used to link this employee to Supabase Auth.';
comment on column public.staff.user_id is 'Resolved Auth user for this employee; populated automatically from email.';

create unique index if not exists staff_active_email_unique
  on public.staff (lower(btrim(email)))
  where active and email is not null;
create unique index if not exists staff_active_user_unique
  on public.staff (user_id)
  where active and user_id is not null;
create index if not exists staff_user_id_idx on public.staff (user_id);

create or replace function public.prepare_staff_auth_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.email := nullif(lower(btrim(new.email)), '');
  if not new.active or new.email is null then
    new.user_id := null;
  else
    select u.id into new.user_id
    from auth.users u
    where lower(u.email) = new.email
    order by u.created_at
    limit 1;
  end if;
  return new;
end;
$$;
revoke all on function public.prepare_staff_auth_link() from public, anon, authenticated;

create or replace function public.sync_staff_profile_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.user_id is not null and old.user_id is distinct from new.user_id then
    update public.profiles p
    set role = 'customer'
    where p.id = old.user_id
      and p.role = 'staff'
      and not exists (
        select 1 from public.staff s
        where s.user_id = old.user_id and s.active
      );
  end if;

  if new.active and new.user_id is not null then
    update public.profiles p
    set role = 'staff',
        full_name = case when nullif(btrim(p.full_name), '') is null then new.name else p.full_name end
    where p.id = new.user_id and p.role = 'customer';
  end if;
  return new;
end;
$$;
revoke all on function public.sync_staff_profile_role() from public, anon, authenticated;

drop trigger if exists prepare_staff_auth_link on public.staff;
create trigger prepare_staff_auth_link
  before insert or update on public.staff
  for each row execute function public.prepare_staff_auth_link();

drop trigger if exists sync_staff_profile_role on public.staff;
create trigger sync_staff_profile_role
  after insert or update on public.staff
  for each row execute function public.sync_staff_profile_role();

-- New sign-ups are immediately promoted when their email was pre-registered by an admin.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  staff_match public.staff%rowtype;
begin
  select s.* into staff_match
  from public.staff s
  where s.active and s.email is not null and lower(btrim(s.email)) = lower(new.email)
  order by s.sort, s.id
  limit 1;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), staff_match.name, ''),
    case when staff_match.id is not null then 'staff' else 'customer' end
  )
  on conflict (id) do update
    set email = excluded.email,
        role = case
          when public.profiles.role = 'customer' and staff_match.id is not null then 'staff'
          else public.profiles.role
        end;

  if staff_match.id is not null then
    update public.staff set user_id = new.id where id = staff_match.id;
  end if;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Link accounts that already exist before an admin adds the employee email.
update public.staff s
set email = lower(btrim(s.email)),
    user_id = u.id
from auth.users u
where s.active and s.email is not null and lower(btrim(s.email)) = lower(u.email);

update public.profiles p
set role = 'staff'
where p.role = 'customer'
  and exists (select 1 from public.staff s where s.active and s.user_id = p.id);

-- Complete the staff mapping for historical workbook rows that have a matching name or alias.
with matched as (
  select distinct on (sale.id) sale.id as sale_id, s.id as staff_id
  from public.sales sale
  join public.staff s
    on lower(btrim(sale.therapist)) = any (
      array(select lower(btrim(label)) from unnest(array_prepend(s.name, s.aliases)) as label)
    )
  where sale.staff_id is null
    and sale.therapist is not null
    and btrim(sale.therapist) <> ''
  order by sale.id, s.active desc, s.sort, s.id
)
update public.sales sale
set staff_id = matched.staff_id
from matched
where sale.id = matched.sale_id;

drop policy if exists "admins read staff" on public.staff;
drop policy if exists "admins write staff" on public.staff;
drop policy if exists "employees read own staff" on public.staff;
drop policy if exists "staff read access" on public.staff;
drop policy if exists "admins insert staff" on public.staff;
drop policy if exists "admins update staff" on public.staff;
create policy "staff read access" on public.staff
  for select to authenticated
  using ((select public.is_admin()) or user_id = (select auth.uid()));
create policy "admins insert staff" on public.staff
  for insert to authenticated
  with check ((select public.is_admin()));
create policy "admins update staff" on public.staff
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
grant select, insert, update on public.staff to authenticated;

drop policy if exists "employees read own sales" on public.sales;
drop policy if exists "employees create own sales" on public.sales;
drop policy if exists "employees update own sales" on public.sales;
create policy "employees read own sales" on public.sales
  for select to authenticated
  using (
    (select public.is_admin())
    or (
      (select public.is_cryo_employee())
      and (
        created_by = (select auth.uid())
        or exists (
          select 1 from public.staff s
          where s.id = sales.staff_id and s.active and s.user_id = (select auth.uid())
        )
      )
    )
  );
create policy "employees create own sales" on public.sales
  for insert to authenticated
  with check (
    (select public.is_cryo_employee())
    and created_by = (select auth.uid())
    and (
      (select public.is_admin())
      or exists (
        select 1 from public.staff s
        where s.id = sales.staff_id and s.active and s.user_id = (select auth.uid())
      )
    )
  );
create policy "employees update own sales" on public.sales
  for update to authenticated
  using (
    (select public.is_admin())
    or ((select public.is_cryo_employee()) and created_by = (select auth.uid()))
  )
  with check (
    (select public.is_admin())
    or (
      (select public.is_cryo_employee())
      and created_by = (select auth.uid())
      and exists (
        select 1 from public.staff s
        where s.id = sales.staff_id and s.active and s.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists "employees read attendance" on public.attendance;
create policy "employees read attendance" on public.attendance
  for select to authenticated
  using (
    (select public.is_admin())
    or user_id = (select auth.uid())
    or exists (
      select 1 from public.staff s
      where s.id = attendance.staff_id and s.active and s.user_id = (select auth.uid())
    )
  );

drop policy if exists "admins manage staff workdays" on public.staff_workdays;
drop policy if exists "employees read own workdays" on public.staff_workdays;
drop policy if exists "staff workdays read access" on public.staff_workdays;
drop policy if exists "admins insert staff workdays" on public.staff_workdays;
drop policy if exists "admins update staff workdays" on public.staff_workdays;
drop policy if exists "admins delete staff workdays" on public.staff_workdays;
create policy "staff workdays read access" on public.staff_workdays
  for select to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.staff s
      where s.id = staff_workdays.staff_id and s.active and s.user_id = (select auth.uid())
    )
  );
create policy "admins insert staff workdays" on public.staff_workdays
  for insert to authenticated with check ((select public.is_admin()));
create policy "admins update staff workdays" on public.staff_workdays
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy "admins delete staff workdays" on public.staff_workdays
  for delete to authenticated using ((select public.is_admin()));
