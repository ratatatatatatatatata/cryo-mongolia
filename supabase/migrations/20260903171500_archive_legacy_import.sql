-- Preserve the previous import for rollback while excluding it from active ERP reports.
alter table public.sales add column if not exists archived_at timestamptz;
create index if not exists sales_active_date_idx on public.sales(sale_date desc) where archived_at is null;
