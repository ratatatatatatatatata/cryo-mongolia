-- Employees can see the shared operational queues in the ERP dashboard.
-- Updates remain restricted to owner/admin by the existing policies.

drop policy if exists "staff read bookings" on public.bookings;
create policy "staff read bookings"
on public.bookings for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'staff'
  )
);

drop policy if exists "staff read messages" on public.contact_messages;
create policy "staff read messages"
on public.contact_messages for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'staff'
  )
);
