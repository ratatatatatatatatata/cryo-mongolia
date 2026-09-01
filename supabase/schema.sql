-- ═══════════════════════════════════════════════════════════════
--  °CRYO Mongolia — Supabase schema
--  Supabase Dashboard → SQL Editor → paste → Run
--  Run once. Safe to re-run (everything is idempotent).
-- ═══════════════════════════════════════════════════════════════

-- ── roles ──────────────────────────────────────────────────────
do $$ begin
  create type public.user_role as enum ('owner', 'admin', 'staff');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text default '',
  role       public.user_role not null default 'staff',
  created_at timestamptz not null default now()
);

-- SECURITY DEFINER so policies can read the role without recursing into RLS
create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('owner','admin') from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_owner() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'owner' from public.profiles where id = auth.uid()), false);
$$;

-- every new auth user gets the lowest role; the owner promotes them later
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''), 'staff')
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
create policy "read own profile"      on public.profiles for select using (id = auth.uid());
create policy "admins read profiles"  on public.profiles for select using (public.is_admin());
-- only the owner may change roles, so no one can promote themselves
create policy "owner writes profiles" on public.profiles for update
  using (public.is_owner()) with check (public.is_owner());


-- ── bookings ───────────────────────────────────────────────────
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
  created_at    timestamptz not null default now()
);
create index if not exists bookings_created_idx on public.bookings (created_at desc);
create index if not exists bookings_date_idx    on public.bookings (booked_date);

alter table public.bookings enable row level security;
drop policy if exists "public creates booking" on public.bookings;
drop policy if exists "admins read bookings"   on public.bookings;
drop policy if exists "admins update bookings" on public.bookings;
drop policy if exists "owner deletes bookings" on public.bookings;
-- the public site writes here, but can never read anyone's booking back
create policy "public creates booking" on public.bookings for insert
  to anon, authenticated with check (true);
create policy "admins read bookings"   on public.bookings for select using (public.is_admin());
create policy "admins update bookings" on public.bookings for update
  using (public.is_admin()) with check (public.is_admin());
create policy "owner deletes bookings" on public.bookings for delete using (public.is_owner());


-- ── contact messages ───────────────────────────────────────────
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


-- ── services (single-session price list) ───────────────────────
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
drop policy if exists "public reads services"  on public.services;
drop policy if exists "admins write services"  on public.services;
create policy "public reads services" on public.services for select
  to anon, authenticated using (active);
create policy "admins write services" on public.services for all
  using (public.is_admin()) with check (public.is_admin());


-- ── packages ───────────────────────────────────────────────────
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


-- ── reporting view (inherits the bookings policies) ────────────
drop view if exists public.report_monthly;
create view public.report_monthly with (security_invoker = on) as
  select date_trunc('month', created_at)::date as month,
         count(*)                                                     as bookings,
         count(*) filter (where status = 'done')                      as completed,
         count(*) filter (where status = 'cancelled')                 as cancelled,
         coalesce(sum(amount) filter (where status in ('confirmed','done')), 0) as revenue
  from public.bookings
  group by 1
  order by 1;


-- ═══════════════════════════════════════════════════════════════
--  SEED — the current price list
-- ═══════════════════════════════════════════════════════════════
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
  ('discover',  'DISCOVER CRYO',    'Эхний удаад',        'Бүх үндсэн технологийг нэг ирэлтээр туршина.',        '~2 цаг 15 мин',              645000,  483750, 'Цэвэр хүчилтөрөгч 15 мин + дараагийн багцад 10%',                      false, 1),
  ('athlete',   'Athlete Recovery', 'Спорт · Фитнес',     'Хүч, хурд, сэргэлтийн хослол.',                       '1 сар · 60–90 мин/ирэлт',   2788000, 2006400, 'Хүчилтөрөгч 8 удаа · биеийн анализ 2 удаа · 2 дахь сар ₮1,700,000',   false, 2),
  ('reset',     'RE:SET',           'Стресс · Ядаргаа',   'Бие, оюунаа дахин асаа.',                             '1 сар · 20–22 удаа',        3300000, 2475000, 'Биеийн анализ 2 удаа · унтах зөвлөгөө · дараагийн багцад 10%',        false, 3),
  ('glow',      'GLOW & LIFT',      'Арьс · Гоо сайхан',  'Арьсаа сэргээ. Гэрэлтүүл.',                           '1 сар',                     2892000, 2089000, 'Арьсны оношилгоо · хүчилтөрөгч 8 удаа · дараагийн багцад 10%',        false, 4),
  ('sleep',     'SLEEP & RESTORE',  'Нойр · Амралт',      'Гүн амралт, чанартай нойр.',                          '4 долоо хоног',             2280000, 1600000, 'Дараагийн багцад нэмэлт 10% хөнгөлөлт',                               false, 5),
  ('agereset',  'AGE RESET',        'Залуужилт · VIP',    'Биеийнхээ биологийн насаа түгж.',                     '1 сар · Longevity VIP',     5308000, 3981000, 'Гоо сайхны үйлчилгээ сонгох эрх · хосоор авбал Cryo+LedPro үнэгүй',    true,  6),
  ('under21',   '21 DAYS UNDER 21', '13–21 нас · 40%',    'Цэвэрхэн арьс, итгэлтэй өсвөр нас.',                  '3 долоо хоног',             2253000, 1352800, 'Зөвхөн 13–21 насныханд 40% хөнгөлөлт',                                false, 7)
on conflict (slug) do nothing;


-- ═══════════════════════════════════════════════════════════════
--  LAST STEP — make yourself the owner
--  1. Register once at /admin.html (or Authentication → Add user)
--  2. Replace the email below and run this line
-- ═══════════════════════════════════════════════════════════════
-- update public.profiles set role = 'owner' where email = 'tumee.jav@gmail.com';
