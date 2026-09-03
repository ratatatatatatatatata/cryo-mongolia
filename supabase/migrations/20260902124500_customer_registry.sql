create table if not exists public.customers (
  id bigint generated always as identity primary key,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 160),
  phone text not null check (phone ~ '^[0-9]{8}$'),
  email text,
  notes text,
  source text not null default 'manual' check (source in ('manual', 'workbook')),
  source_key text unique,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customers_phone_unique on public.customers (phone);
create index if not exists customers_name_search_idx on public.customers (lower(full_name));
create index if not exists customers_created_by_idx on public.customers (created_by);

alter table public.customers enable row level security;

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

drop policy if exists "employees read customers" on public.customers;
drop policy if exists "employees create customers" on public.customers;
drop policy if exists "admins update customers" on public.customers;

create policy "employees read customers" on public.customers
  for select to authenticated
  using ((select public.is_cryo_employee()));

create policy "employees create customers" on public.customers
  for insert to authenticated
  with check ((select public.is_cryo_employee()) and created_by = (select auth.uid()));

create policy "admins update customers" on public.customers
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

grant select, insert on public.customers to authenticated;
grant usage, select on sequence public.customers_id_seq to authenticated;

create or replace function public.touch_customer_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists customers_touch_updated_at on public.customers;
create trigger customers_touch_updated_at
before update on public.customers
for each row execute function public.touch_customer_updated_at();
