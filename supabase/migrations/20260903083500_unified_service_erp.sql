-- Unified service ERP: employee-entered sales, attendance and inventory.
-- All public tables use RLS and explicit Data API grants.

create or replace function public.is_cryo_employee()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role in ('owner', 'admin', 'staff')
  );
$$;
revoke all on function public.is_cryo_employee() from public, anon;
grant execute on function public.is_cryo_employee() to authenticated;

alter table public.sales alter column created_by set default auth.uid();

drop policy if exists "admins read sales" on public.sales;
drop policy if exists "admins write sales" on public.sales;
drop policy if exists "employees read own sales" on public.sales;
drop policy if exists "employees create own sales" on public.sales;
drop policy if exists "employees update own sales" on public.sales;
drop policy if exists "admins manage sales" on public.sales;
drop policy if exists "admins delete sales" on public.sales;

create policy "employees read own sales" on public.sales
  for select to authenticated
  using ((select public.is_admin()) or created_by = (select auth.uid()));
create policy "employees create own sales" on public.sales
  for insert to authenticated
  with check ((select public.is_cryo_employee()) and created_by = (select auth.uid()));
create policy "employees update own sales" on public.sales
  for update to authenticated
  using ((select public.is_admin()) or created_by = (select auth.uid()))
  with check ((select public.is_admin()) or created_by = (select auth.uid()));
create policy "admins delete sales" on public.sales
  for delete to authenticated
  using ((select public.is_admin()))
;

grant select, insert, update on public.sales to authenticated;
grant usage, select on sequence public.sales_id_seq to authenticated;
create index if not exists sales_created_by_idx on public.sales (created_by);

alter table public.staff add column if not exists phone text;
alter table public.staff add column if not exists employee_code text;
create unique index if not exists staff_employee_code_unique
  on public.staff (employee_code) where employee_code is not null;
grant select on public.staff to authenticated;
grant insert, update on public.staff to authenticated;

create table if not exists public.attendance (
  id bigint generated always as identity primary key,
  work_date date not null default current_date,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  staff_name text not null,
  clock_in timestamptz not null default now(),
  clock_out timestamptz,
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  constraint attendance_clock_order check (clock_out is null or clock_out >= clock_in),
  constraint attendance_one_shift unique (work_date, user_id)
);
create index if not exists attendance_date_idx on public.attendance (work_date desc);
create index if not exists attendance_user_idx on public.attendance (user_id, work_date desc);
alter table public.attendance enable row level security;
drop policy if exists "employees read attendance" on public.attendance;
drop policy if exists "employees clock in" on public.attendance;
drop policy if exists "employees clock out" on public.attendance;
drop policy if exists "admins manage attendance" on public.attendance;
create policy "employees read attendance" on public.attendance
  for select to authenticated
  using ((select public.is_admin()) or user_id = (select auth.uid()));
create policy "employees clock in" on public.attendance
  for insert to authenticated
  with check ((select public.is_cryo_employee()) and user_id = (select auth.uid()));
create policy "employees clock out" on public.attendance
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
grant select, insert, update on public.attendance to authenticated;
grant usage, select on sequence public.attendance_id_seq to authenticated;

create table if not exists public.inventory_items (
  id bigint generated always as identity primary key,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  category text,
  unit text not null default 'ш',
  quantity numeric(12,2) not null default 0 check (quantity >= 0),
  min_quantity numeric(12,2) not null default 0 check (min_quantity >= 0),
  unit_cost bigint not null default 0 check (unit_cost >= 0),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists inventory_name_unique on public.inventory_items (lower(btrim(name)));
create index if not exists inventory_low_stock_idx on public.inventory_items (quantity, min_quantity) where active;
create index if not exists inventory_created_by_idx on public.inventory_items (created_by);
alter table public.inventory_items enable row level security;
drop policy if exists "employees read inventory" on public.inventory_items;
drop policy if exists "admins manage inventory" on public.inventory_items;
drop policy if exists "admins create inventory" on public.inventory_items;
drop policy if exists "admins update inventory" on public.inventory_items;
drop policy if exists "admins delete inventory" on public.inventory_items;
create policy "employees read inventory" on public.inventory_items
  for select to authenticated using ((select public.is_cryo_employee()));
create policy "admins create inventory" on public.inventory_items
  for insert to authenticated with check ((select public.is_admin()));
create policy "admins update inventory" on public.inventory_items
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy "admins delete inventory" on public.inventory_items
  for delete to authenticated using ((select public.is_admin()));
grant select, insert, update, delete on public.inventory_items to authenticated;
grant usage, select on sequence public.inventory_items_id_seq to authenticated;
