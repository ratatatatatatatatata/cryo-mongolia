-- The schedule trigger must read the service duration regardless of caller RLS.
-- It is trigger-only: direct API execution is revoked for every client role.
alter function public.prepare_booking_schedule() security definer;
revoke all on function public.prepare_booking_schedule() from public, anon, authenticated;
