-- Harden the trigger-only function and index realtime availability lookups.
create schema if not exists extensions;
alter extension btree_gist set schema extensions;
revoke all on function public.sync_booking_block() from public, anon, authenticated;
create index if not exists booking_blocks_service_start_idx
  on public.booking_blocks(service_id, starts_at);

drop policy if exists "staff read bookings" on public.bookings;
create policy "staff read bookings"
on public.bookings for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'staff'
  )
);
