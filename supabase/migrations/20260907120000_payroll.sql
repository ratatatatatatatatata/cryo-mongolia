-- Цалин: what each therapist earned, line by line.
--
-- The workbook keeps this as a commission ledger — one block per pay
-- period, one row per session, and a payout at the foot of the block. The
-- table follows that shape: a line is a session's commission, and the
-- period it belongs to travels with it so a payout can be added up again.
--
-- staff_id may be null so history survives a staff record being removed;
-- staff_name always says who it was.

create table if not exists public.payroll (
  id bigint generated always as identity primary key,
  staff_id bigint references public.staff(id) on delete set null,
  staff_name text not null check (char_length(btrim(staff_name)) between 1 and 160),
  period_label text check (char_length(period_label) <= 120),
  period_start date,
  period_end date,
  work_date date,
  customer_label text check (char_length(customer_label) <= 160),
  amount bigint not null default 0,
  note text check (char_length(note) <= 500),
  source text not null default 'manual' check (source in ('manual', 'workbook')),
  source_key text,
  workbook_sheet text,
  workbook_row integer,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint payroll_period_order check (
    period_end is null or period_start is null or period_end >= period_start
  )
);

create unique index if not exists payroll_source_key_unique
  on public.payroll(source_key) where source_key is not null;
create index if not exists payroll_staff_date_idx on public.payroll(staff_id, work_date desc);
create index if not exists payroll_period_idx on public.payroll(period_start desc);

alter table public.payroll enable row level security;

drop policy if exists "employees read payroll" on public.payroll;
drop policy if exists "admins manage payroll" on public.payroll;

-- earnings are not for the whole team to browse: admins only
create policy "admins manage payroll" on public.payroll for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

grant select, insert, update, delete on public.payroll to authenticated;
grant usage, select on sequence public.payroll_id_seq to authenticated;
