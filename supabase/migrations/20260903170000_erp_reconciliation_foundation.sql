-- Reconciliation foundation for the exact legacy workbook reviewed on 2026-09-03.
-- This migration is additive: it does not rewrite or delete existing business rows.

create table if not exists public.import_batches (
  id bigint generated always as identity primary key,
  workbook_sha256 text not null check (workbook_sha256 ~ '^[0-9a-f]{64}$'),
  file_label text not null,
  source_rows integer not null check (source_rows >= 0),
  status text not null default 'review_required'
    check (status in ('review_required','approved','importing','reconciled','rejected')),
  coverage jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  reconciled_at timestamptz,
  unique (workbook_sha256)
);
create index if not exists import_batches_created_by_idx on public.import_batches(created_by);
alter table public.import_batches enable row level security;
create policy "employees read import batches" on public.import_batches
  for select to authenticated using ((select public.is_cryo_employee()));
create policy "admins create import batches" on public.import_batches
  for insert to authenticated with check ((select public.is_admin()));
create policy "admins update import batches" on public.import_batches
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update on public.import_batches to authenticated;
grant usage, select on sequence public.import_batches_id_seq to authenticated;

insert into public.import_batches (workbook_sha256,file_label,source_rows,status,coverage)
values (
  'ecc3976f61ddb3e3d437bfbc68d641076bd0534db3f0adb74cc86014b77745f1',
  'CRYO Mongolia борлуулалт хөтлөлт.xlsx',7899,'review_required',
  '{"sales_imported":1031,"sales_2025":"missing","expenses_imported":119,"expense_candidates":330,"customers_imported":1,"customer_candidates":115,"service_names_imported":31,"service_name_candidates":35,"sessions_imported":0,"session_candidates":2829,"package_records_imported":0,"package_candidates":245,"attendance_imported":1,"attendance_candidates":320,"inventory_imported":0,"inventory_candidates":69,"payroll_imported":0,"payroll_candidates":254}'::jsonb
) on conflict (workbook_sha256) do nothing;

alter table public.sales add column if not exists customer_id bigint references public.customers(id) on delete set null;
alter table public.sales add column if not exists import_batch_id bigint references public.import_batches(id) on delete set null;
alter table public.sales add column if not exists source_key text;
create index if not exists sales_customer_id_idx on public.sales(customer_id);
create index if not exists sales_import_batch_id_idx on public.sales(import_batch_id);
create unique index if not exists sales_source_key_unique on public.sales(source_key) where source_key is not null;

alter table public.expenses add column if not exists import_batch_id bigint references public.import_batches(id) on delete set null;
alter table public.expenses add column if not exists source_key text;
create index if not exists expenses_import_batch_id_idx on public.expenses(import_batch_id);
create unique index if not exists expenses_source_key_unique on public.expenses(source_key) where source_key is not null;

create table if not exists public.service_sessions (
  id bigint generated always as identity primary key,
  session_date date not null,
  customer_id bigint references public.customers(id) on delete restrict,
  customer_label text,
  service_id bigint references public.services(id) on delete restrict,
  service_label text,
  staff_id bigint references public.staff(id) on delete set null,
  sale_id bigint references public.sales(id) on delete set null,
  import_batch_id bigint references public.import_batches(id) on delete set null,
  source_key text,
  status text not null default 'completed' check (status in ('planned','completed','cancelled','needs_review')),
  notes text check (char_length(notes) <= 1000),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint session_identity_present check (customer_id is not null or nullif(btrim(customer_label),'') is not null),
  constraint session_service_present check (service_id is not null or nullif(btrim(service_label),'') is not null)
);
create index if not exists service_sessions_date_idx on public.service_sessions(session_date desc);
create index if not exists service_sessions_customer_idx on public.service_sessions(customer_id,session_date desc);
create index if not exists service_sessions_staff_idx on public.service_sessions(staff_id,session_date desc);
create index if not exists service_sessions_batch_idx on public.service_sessions(import_batch_id);
create unique index if not exists service_sessions_source_key_unique on public.service_sessions(source_key) where source_key is not null;
alter table public.service_sessions enable row level security;
create policy "employees read sessions" on public.service_sessions for select to authenticated using ((select public.is_cryo_employee()));
create policy "employees create sessions" on public.service_sessions for insert to authenticated with check ((select public.is_cryo_employee()));
create policy "admins update sessions" on public.service_sessions for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update on public.service_sessions to authenticated;
grant usage, select on sequence public.service_sessions_id_seq to authenticated;

create table if not exists public.customer_package_contracts (
  id bigint generated always as identity primary key,
  customer_id bigint references public.customers(id) on delete restrict,
  customer_label text,
  package_id bigint references public.packages(id) on delete restrict,
  package_label text,
  purchased_on date,
  expires_on date,
  total_units integer check (total_units is null or total_units >= 0),
  status text not null default 'needs_review' check (status in ('active','completed','expired','cancelled','needs_review')),
  import_batch_id bigint references public.import_batches(id) on delete set null,
  source_key text,
  notes text check (char_length(notes) <= 1000),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint package_customer_present check (customer_id is not null or nullif(btrim(customer_label),'') is not null),
  constraint package_definition_present check (package_id is not null or nullif(btrim(package_label),'') is not null),
  constraint package_date_order check (expires_on is null or purchased_on is null or expires_on >= purchased_on)
);
create index if not exists customer_package_customer_idx on public.customer_package_contracts(customer_id);
create index if not exists customer_package_batch_idx on public.customer_package_contracts(import_batch_id);
create unique index if not exists customer_package_source_key_unique on public.customer_package_contracts(source_key) where source_key is not null;
alter table public.customer_package_contracts enable row level security;
create policy "employees read customer packages" on public.customer_package_contracts for select to authenticated using ((select public.is_cryo_employee()));
create policy "admins manage customer packages" on public.customer_package_contracts for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
grant select,insert,update on public.customer_package_contracts to authenticated;
grant usage,select on sequence public.customer_package_contracts_id_seq to authenticated;

create table if not exists public.package_redemptions (
  id bigint generated always as identity primary key,
  contract_id bigint not null references public.customer_package_contracts(id) on delete restrict,
  session_id bigint references public.service_sessions(id) on delete set null,
  used_on date not null,
  units integer not null default 1 check (units > 0),
  import_batch_id bigint references public.import_batches(id) on delete set null,
  source_key text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists package_redemptions_contract_idx on public.package_redemptions(contract_id,used_on desc);
create index if not exists package_redemptions_batch_idx on public.package_redemptions(import_batch_id);
create unique index if not exists package_redemptions_source_key_unique on public.package_redemptions(source_key) where source_key is not null;
alter table public.package_redemptions enable row level security;
create policy "employees read redemptions" on public.package_redemptions for select to authenticated using ((select public.is_cryo_employee()));
create policy "admins manage redemptions" on public.package_redemptions for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
grant select,insert,update on public.package_redemptions to authenticated;
grant usage,select on sequence public.package_redemptions_id_seq to authenticated;
