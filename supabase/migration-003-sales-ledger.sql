-- ═══════════════════════════════════════════════════════════════
--  °CRYO Mongolia — migration 003: sales ledger, expenses, staff
--  Mirrors "CRYO Mongolia борлуулалт хөтлөлт.xlsx" so the daily
--  tracking moves off the spreadsheet without losing a column.
--
--  One row per transaction, carrying BOTH halves the workbook kept
--  on separate sheets:
--    · "2026 Income"    → money split by payment method
--    · "CryoStart 2026" → which devices ran, and which therapist earned it
--  Run once in Supabase → SQL Editor.
-- ═══════════════════════════════════════════════════════════════

-- ── staff (therapists the sales get attributed to) ─────────────
create table if not exists public.staff (
  id         bigint generated always as identity primary key,
  name       text unique not null,
  title      text,
  active     boolean not null default true,
  sort       integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.staff enable row level security;
drop policy if exists "admins read staff"  on public.staff;
drop policy if exists "admins write staff" on public.staff;
create policy "admins read staff"  on public.staff for select using (public.is_admin());
create policy "admins write staff" on public.staff for all
  using (public.is_admin()) with check (public.is_admin());

insert into public.staff (name, sort) values
  ('Сараа', 1), ('Muujig', 2), ('Denis', 3), ('Uranjargal', 4), ('Munkhtuya', 5)
on conflict (name) do nothing;


-- ── the ledger ─────────────────────────────────────────────────
create table if not exists public.sales (
  id            bigint generated always as identity primary key,
  sale_date     date not null,
  customer_name text,
  phone         text,
  services      text,                       -- as written in the sheet: "CC; RL; Oxy pro"

  -- money, split the way the book splits it
  golomt        bigint not null default 0,
  khan          bigint not null default 0,
  cash          bigint not null default 0,
  invoice       bigint not null default 0,  -- Нэхэмжлэх
  barter        bigint not null default 0,
  refund        bigint not null default 0,  -- Буцаалт, subtracted
  total         bigint generated always as
                (golomt + khan + cash + invoice + barter - refund) stored,

  -- device sessions used on this visit
  cryo_cabin    smallint not null default 0,
  oxy_pro       smallint not null default 0,
  led_pro       smallint not null default 0,
  x_cryo        smallint not null default 0,
  zerobody      smallint not null default 0,
  normatec      smallint not null default 0,
  oxygen        smallint not null default 0,

  therapist        text,                    -- staff.name, kept as text so history survives
  therapist_amount bigint not null default 0,
  gift_card        bigint not null default 0,

  is_internal   boolean not null default false,   -- Дотоод
  needs_review  boolean not null default false,   -- imported without a customer name
  note          text,
  source        text not null default 'manual'
                check (source in ('manual', 'import', 'booking')),
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists sales_date_idx      on public.sales (sale_date desc);
create index if not exists sales_therapist_idx on public.sales (therapist);
create index if not exists sales_customer_idx  on public.sales (customer_name);

alter table public.sales enable row level security;
drop policy if exists "admins read sales"  on public.sales;
drop policy if exists "admins write sales" on public.sales;
-- business figures never leave the dashboard
create policy "admins read sales"  on public.sales for select using (public.is_admin());
create policy "admins write sales" on public.sales for all
  using (public.is_admin()) with check (public.is_admin());


-- ── expenses (Зардал) ──────────────────────────────────────────
create table if not exists public.expenses (
  id         bigint generated always as identity primary key,
  spend_date date not null,
  item       text not null,                 -- Юунд
  category   text,
  qty        numeric,
  amount     bigint not null default 0,
  paid_with  text,                          -- Бэлнээр / данс
  paid_by    text,                          -- Хэн
  note       text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists expenses_date_idx on public.expenses (spend_date desc);

alter table public.expenses enable row level security;
drop policy if exists "admins read expenses"  on public.expenses;
drop policy if exists "admins write expenses" on public.expenses;
create policy "admins read expenses"  on public.expenses for select using (public.is_admin());
create policy "admins write expenses" on public.expenses for all
  using (public.is_admin()) with check (public.is_admin());


-- ── monthly P&L, straight off the ledger ───────────────────────
drop view if exists public.report_sales_monthly;
create view public.report_sales_monthly with (security_invoker = on) as
  select date_trunc('month', sale_date)::date as month,
         count(*)                             as sales,
         coalesce(sum(total), 0)              as revenue,
         coalesce(sum(golomt), 0)             as golomt,
         coalesce(sum(khan), 0)               as khan,
         coalesce(sum(cash), 0)               as cash,
         coalesce(sum(invoice), 0)            as invoice,
         coalesce(sum(barter), 0)             as barter,
         coalesce(sum(refund), 0)             as refund,
         coalesce(sum(cryo_cabin), 0)         as cryo_cabin,
         coalesce(sum(oxy_pro), 0)            as oxy_pro,
         coalesce(sum(led_pro), 0)            as led_pro,
         coalesce(sum(x_cryo), 0)             as x_cryo,
         coalesce(sum(zerobody), 0)           as zerobody,
         coalesce(sum(normatec), 0)           as normatec,
         coalesce(sum(oxygen), 0)             as oxygen
  from public.sales
  where not is_internal
  group by 1
  order by 1;
