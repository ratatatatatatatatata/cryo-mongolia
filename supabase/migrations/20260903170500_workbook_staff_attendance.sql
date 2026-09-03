-- Safe workbook import support. Existing RLS policies and attendance identity rules stay intact.

alter table public.staff add column if not exists aliases text[] not null default '{}';

alter table public.sales add column if not exists staff_id bigint references public.staff(id) on delete set null;
alter table public.sales add column if not exists source_key text;
alter table public.sales add column if not exists workbook_sheet text;
alter table public.sales add column if not exists workbook_row integer;
create unique index if not exists sales_source_key_unique on public.sales(source_key) where source_key is not null;
create index if not exists sales_staff_date_idx on public.sales(staff_id, sale_date desc);

alter table public.attendance add column if not exists workday_number integer;
alter table public.attendance add column if not exists staff_id bigint references public.staff(id) on delete set null;

create table if not exists public.staff_workdays (
  id bigint generated always as identity primary key,
  staff_id bigint not null references public.staff(id) on delete cascade,
  staff_name text not null,
  work_date date not null,
  workday_number integer not null check (workday_number > 0),
  clock_in timestamptz not null,
  clock_out timestamptz,
  note text check (char_length(note) <= 500),
  source text not null default 'workbook' check (source = 'workbook'),
  source_key text not null unique,
  workbook_sheet text,
  workbook_row integer,
  created_at timestamptz not null default now(),
  constraint staff_workdays_clock_order check (clock_out is null or clock_out >= clock_in),
  constraint staff_workdays_staff_day_unique unique (staff_id, work_date)
);
create index if not exists staff_workdays_date_idx on public.staff_workdays(work_date desc);
create index if not exists staff_workdays_staff_idx on public.staff_workdays(staff_id, workday_number);
alter table public.staff_workdays enable row level security;
drop policy if exists "admins read staff workdays" on public.staff_workdays;
create policy "admins read staff workdays" on public.staff_workdays
  for select to authenticated using ((select public.is_admin()));
drop policy if exists "admins manage staff workdays" on public.staff_workdays;
create policy "admins manage staff workdays" on public.staff_workdays
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
grant select, insert, update, delete on public.staff_workdays to authenticated;
grant usage, select on sequence public.staff_workdays_id_seq to authenticated;
