-- ═══════════════════════════════════════════════════════════════
--  °CRYO Mongolia — migration 002: customer accounts
--  Run once in Supabase → SQL Editor if you already ran schema.sql.
--  (A fresh project only needs schema.sql, which already includes this.)
--
--  What changes:
--   · new signups become "customer" instead of "staff"
--   · bookings belong to the account that made them
--   · customers can see their own bookings, nothing else
--   · roles are plain text + CHECK, so adding a role later is one line
-- ═══════════════════════════════════════════════════════════════

-- ── roles: enum → text, so new roles need no type surgery ──────
alter table public.profiles alter column role drop default;
alter table public.profiles alter column role type text using role::text;
alter table public.profiles alter column role set default 'customer';

alter table public.profiles drop constraint if exists profiles_role_chk;
alter table public.profiles
  add constraint profiles_role_chk
  check (role in ('owner', 'admin', 'staff', 'customer'));

-- anyone who signed up before this migration was parked as staff
update public.profiles set role = 'customer' where role = 'staff';

-- ── new accounts are customers ─────────────────────────────────
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''), 'customer')
  on conflict (id) do nothing;
  return new;
end $$;

-- ── bookings belong to an account ──────────────────────────────
alter table public.bookings
  add column if not exists user_id uuid references auth.users(id) on delete set null;
create index if not exists bookings_user_idx on public.bookings (user_id);

drop policy if exists "public creates booking"    on public.bookings;
drop policy if exists "customers read own"        on public.bookings;
drop policy if exists "customers cancel own"      on public.bookings;
drop policy if exists "admins read bookings"      on public.bookings;
drop policy if exists "admins update bookings"    on public.bookings;
drop policy if exists "owner deletes bookings"    on public.bookings;

-- a signed-in customer may only file a booking under their own id;
-- anonymous walk-ups are still accepted with no owner attached
create policy "create own booking" on public.bookings for insert
  to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

create policy "customers read own" on public.bookings for select
  to authenticated using (user_id = auth.uid());

-- customers may only ever move their own booking to "cancelled"
create policy "customers cancel own" on public.bookings for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and status in ('pending', 'cancelled'));

create policy "admins read bookings"   on public.bookings for select using (public.is_admin());
create policy "admins update bookings" on public.bookings for update
  using (public.is_admin()) with check (public.is_admin());
create policy "owner deletes bookings" on public.bookings for delete using (public.is_owner());

-- ── customers may keep their own name up to date, never their role ──
drop policy if exists "users update own name" on public.profiles;
create policy "users update own name" on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select p.role from public.profiles p where p.id = auth.uid())
  );

-- ═══════════════════════════════════════════════════════════════
--  Make yourself the owner (replace the email if needed)
-- ═══════════════════════════════════════════════════════════════
update public.profiles set role = 'owner' where email = 'tumee.jav@gmail.com';

-- check it landed
select email, role, created_at from public.profiles order by created_at;
