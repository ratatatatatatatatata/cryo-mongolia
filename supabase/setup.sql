-- ═══════════════════════════════════════════════════════════════
--  °CRYO Mongolia — complete database setup
--
--  Supabase Dashboard → SQL Editor → paste the whole file → Run.
--
--  This replaces schema.sql, migration-002 and migration-003: it is
--  the only structural file you need. Safe to run on a fresh project
--  and safe to re-run on an existing one — nothing here drops data.
--
--  Afterwards, load the sales history once with import-sales.sql.
-- ═══════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
--  1 · ACCOUNTS AND ROLES
--
--  customer — books online, sees only their own bookings (default)
--  staff    — sees own sales and attendance after email linking
--  admin    — runs the centre
--  owner    — admin, plus grants roles to everyone else
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text default '',
  role       text not null default 'customer',
  created_at timestamptz not null default now()
);

-- older installs had role as an enum; move it to text either way
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'role' and data_type = 'USER-DEFINED'
  ) then
    alter table public.profiles alter column role drop default;
    alter table public.profiles alter column role type text using role::text;
  end if;
end $$;

alter table public.profiles alter column role set default 'customer';
alter table public.profiles drop constraint if exists profiles_role_chk;
alter table public.profiles
  add constraint profiles_role_chk
  check (role in ('owner', 'admin', 'staff', 'customer'));

-- accounts parked as staff by the first version of this schema were customers
update public.profiles set role = 'customer' where role = 'staff';

-- SECURITY DEFINER so policies can read the role without recursing into RLS
create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('owner','admin') from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_owner() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'owner' from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''), 'customer')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
drop policy if exists "read own profile"      on public.profiles;
drop policy if exists "admins read profiles"  on public.profiles;
drop policy if exists "owner writes profiles" on public.profiles;
drop policy if exists "users update own name" on public.profiles;

create policy "read own profile"     on public.profiles for select using (id = auth.uid());
create policy "admins read profiles" on public.profiles for select using (public.is_admin());
-- only the owner may change roles, so nobody can promote themselves
create policy "owner writes profiles" on public.profiles for update
  using (public.is_owner()) with check (public.is_owner());
create policy "users update own name" on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid()
              and role = (select p.role from public.profiles p where p.id = auth.uid()));


-- ═══════════════════════════════════════════════════════════════
--  2 · ONLINE BOOKINGS
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.bookings (
  id            bigint generated always as identity primary key,
  ref           text unique not null,
  customer_name text not null,
  phone         text,
  service       text,
  package       text,
  booked_date   date,
  booked_time   text,
  amount        integer not null default 0,
  deposit       integer not null default 0,
  bank          text,
  status        text not null default 'pending'
                check (status in ('pending','confirmed','done','cancelled')),
  note          text,
  user_id       uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
alter table public.bookings add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists bookings_created_idx on public.bookings (created_at desc);
create index if not exists bookings_date_idx    on public.bookings (booked_date);
create index if not exists bookings_user_idx    on public.bookings (user_id);

alter table public.bookings enable row level security;
drop policy if exists "public creates booking" on public.bookings;
drop policy if exists "create own booking"     on public.bookings;
drop policy if exists "customers read own"     on public.bookings;
drop policy if exists "customers cancel own"   on public.bookings;
drop policy if exists "admins read bookings"   on public.bookings;
drop policy if exists "admins update bookings" on public.bookings;
drop policy if exists "owner deletes bookings" on public.bookings;

-- a signed-in customer may only file a booking under their own id;
-- anonymous walk-ups are accepted with no owner attached
create policy "create own booking" on public.bookings for insert
  to anon, authenticated
  with check (user_id is null or user_id = auth.uid());
create policy "customers read own" on public.bookings for select
  to authenticated using (user_id = auth.uid());
-- a customer may only ever move their own booking to cancelled
create policy "customers cancel own" on public.bookings for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and status in ('pending','cancelled'));
create policy "admins read bookings"   on public.bookings for select using (public.is_admin());
create policy "admins update bookings" on public.bookings for update
  using (public.is_admin()) with check (public.is_admin());
create policy "owner deletes bookings" on public.bookings for delete using (public.is_owner());


-- ═══════════════════════════════════════════════════════════════
--  3 · CONTACT REQUESTS
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.contact_messages (
  id         bigint generated always as identity primary key,
  name       text not null,
  phone      text,
  email      text,
  service    text,
  message    text,
  handled    boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.contact_messages enable row level security;
drop policy if exists "public sends message"   on public.contact_messages;
drop policy if exists "admins read messages"   on public.contact_messages;
drop policy if exists "admins update messages" on public.contact_messages;
create policy "public sends message"   on public.contact_messages for insert
  to anon, authenticated with check (true);
create policy "admins read messages"   on public.contact_messages for select using (public.is_admin());
create policy "admins update messages" on public.contact_messages for update
  using (public.is_admin()) with check (public.is_admin());


-- ═══════════════════════════════════════════════════════════════
--  4 · PRICE LIST — what the public site reads
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.services (
  id         bigint generated always as identity primary key,
  slug       text unique not null,
  name       text not null,
  category   text,
  duration   text,
  price      integer not null default 0,
  sort       integer not null default 0,
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.services enable row level security;
drop policy if exists "public reads services" on public.services;
drop policy if exists "admins write services" on public.services;
create policy "public reads services" on public.services for select
  to anon, authenticated using (active);
create policy "admins write services" on public.services for all
  using (public.is_admin()) with check (public.is_admin());

create table if not exists public.packages (
  id         bigint generated always as identity primary key,
  slug       text unique not null,
  name       text not null,
  kicker     text,
  tagline    text,
  period     text,
  old_price  integer not null default 0,
  price      integer not null default 0,
  bonus      text,
  featured   boolean not null default false,
  sort       integer not null default 0,
  active     boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.packages enable row level security;
drop policy if exists "public reads packages" on public.packages;
drop policy if exists "admins write packages" on public.packages;
create policy "public reads packages" on public.packages for select
  to anon, authenticated using (active);
create policy "admins write packages" on public.packages for all
  using (public.is_admin()) with check (public.is_admin());

insert into public.services (slug, name, category, duration, price, sort) values
  ('cryocabin', 'CryoCabin™ — Бүх биеийн криотерапи', 'cryo',     '3 мин',  149000, 1),
  ('xcryo',     'X°Cryo™ — Хэсэгчилсэн крио',          'cryo',     '1–3 мин', 59000, 2),
  ('ledpro',    'LedPro™ — Улаан гэрлийн эмчилгээ',    'beauty',   '15 мин', 139000, 3),
  ('oxypro',    'OxyPro™ — Хүчилтөрөгчийн камер',      'recovery', '30 мин', 129000, 4),
  ('zerobody',  'ZeroBody™ — Хуурай хөвөх эмчилгээ',   'relax',    '30 мин',  85000, 5),
  ('normatec',  'Normatec® — Хөлний динамик компресс', 'recovery', '20 мин',  49000, 6),
  ('oxygen',    'Oxygen Therapy — Цэвэр хүчилтөрөгч',  'recovery', '15 мин',  35000, 7),
  ('massage',   'Бүтэн биеийн бариа',                  'relax',    '60 мин', 150000, 8),
  ('facial',    'Гоо сайхны нүүрний үйлчилгээ',        'beauty',   '60 мин', 150000, 9)
on conflict (slug) do nothing;

insert into public.packages (slug, name, kicker, tagline, period, old_price, price, bonus, featured, sort) values
  ('discover',  'DISCOVER CRYO',    'Эхний удаад',       'Бүх үндсэн технологийг нэг ирэлтээр туршина.', '~2 цаг 15 мин',            645000,  483750, 'Цэвэр хүчилтөрөгч 15 мин + дараагийн багцад 10%',                   false, 1),
  ('athlete',   'Athlete Recovery', 'Спорт · Фитнес',    'Хүч, хурд, сэргэлтийн хослол.',                '1 сар · 60–90 мин/ирэлт', 2788000, 2006400, 'Хүчилтөрөгч 8 удаа · биеийн анализ 2 удаа · 2 дахь сар ₮1,700,000', false, 2),
  ('reset',     'RE:SET',           'Стресс · Ядаргаа',  'Бие, оюунаа дахин асаа.',                      '1 сар · 20–22 удаа',      3300000, 2475000, 'Биеийн анализ 2 удаа · унтах зөвлөгөө · дараагийн багцад 10%',      false, 3),
  ('glow',      'GLOW & LIFT',      'Арьс · Гоо сайхан', 'Арьсаа сэргээ. Гэрэлтүүл.',                    '1 сар',                   2892000, 2089000, 'Арьсны оношилгоо · хүчилтөрөгч 8 удаа · дараагийн багцад 10%',      false, 4),
  ('sleep',     'SLEEP & RESTORE',  'Нойр · Амралт',     'Гүн амралт, чанартай нойр.',                   '4 долоо хоног',           2280000, 1600000, 'Дараагийн багцад нэмэлт 10% хөнгөлөлт',                             false, 5),
  ('agereset',  'AGE RESET',        'Залуужилт · VIP',   'Биеийнхээ биологийн насаа түгж.',              '1 сар · Longevity VIP',   5308000, 3981000, 'Гоо сайхны үйлчилгээ сонгох эрх · хосоор авбал Cryo+LedPro үнэгүй', true,  6),
  ('under21',   '21 DAYS UNDER 21', '13–21 нас · 40%',   'Цэвэрхэн арьс, итгэлтэй өсвөр нас.',           '3 долоо хоног',           2253000, 1352800, 'Зөвхөн 13–21 насныханд 40% хөнгөлөлт',                              false, 7)
on conflict (slug) do nothing;


-- ═══════════════════════════════════════════════════════════════
--  5 · SALES LEDGER — the daily book from the tracking workbook
--
--  The workbook kept each visit twice: "Income" for the money split
--  by bank, "CryoStart" for the devices and the therapist. One row
--  here carries both, so a visit is entered once.
-- ═══════════════════════════════════════════════════════════════

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

create table if not exists public.sales (
  id            bigint generated always as identity primary key,
  sale_date     date not null,
  customer_name text,
  phone         text,
  services      text,                       -- as written in the sheet: "CC; RL; Oxy pro"

  golomt        bigint not null default 0,
  khan          bigint not null default 0,
  cash          bigint not null default 0,
  invoice       bigint not null default 0,  -- Нэхэмжлэх
  barter        bigint not null default 0,
  refund        bigint not null default 0,  -- Буцаалт, subtracted
  total         bigint generated always as
                (golomt + khan + cash + invoice + barter - refund) stored,

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
-- turnover never leaves the dashboard
create policy "admins read sales"  on public.sales for select using (public.is_admin());
create policy "admins write sales" on public.sales for all
  using (public.is_admin()) with check (public.is_admin());


-- ═══════════════════════════════════════════════════════════════
--  6 · EXPENSES (Зардал)
-- ═══════════════════════════════════════════════════════════════

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
  source     text not null default 'manual'
             check (source in ('manual', 'import')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.expenses add column if not exists source text not null default 'manual';

create index if not exists expenses_date_idx on public.expenses (spend_date desc);

alter table public.expenses enable row level security;
drop policy if exists "admins read expenses"  on public.expenses;
drop policy if exists "admins write expenses" on public.expenses;
create policy "admins read expenses"  on public.expenses for select using (public.is_admin());
create policy "admins write expenses" on public.expenses for all
  using (public.is_admin()) with check (public.is_admin());


-- ═══════════════════════════════════════════════════════════════
--  7 · REPORTING VIEWS (they inherit the table policies)
-- ═══════════════════════════════════════════════════════════════

drop view if exists public.report_monthly;
create view public.report_monthly with (security_invoker = on) as
  select date_trunc('month', created_at)::date                              as month,
         count(*)                                                           as bookings,
         count(*) filter (where status = 'done')                            as completed,
         count(*) filter (where status = 'cancelled')                       as cancelled,
         coalesce(sum(amount) filter (where status in ('confirmed','done')), 0) as revenue
  from public.bookings
  group by 1
  order by 1;

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


-- ═══════════════════════════════════════════════════════════════
--  8 · MAKE YOURSELF THE OWNER
--  Register once on the site first, then this line takes effect.
-- ═══════════════════════════════════════════════════════════════

update public.profiles set role = 'owner' where email = 'tumee.jav@gmail.com';

select email, role, created_at from public.profiles order by created_at;
