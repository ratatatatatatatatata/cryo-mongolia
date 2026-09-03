-- Trigger functions must never be callable through the public Data API.
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Role-check helpers are needed by authenticated RLS policies, but not by anonymous users.
revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_owner() to authenticated;

