grant update(name) on public.sports_teams to authenticated;
grant update(full_name) on public.sports_team_members to authenticated;
create policy "employees rename teams" on public.sports_teams for update to authenticated
 using ((select public.is_cryo_employee())) with check ((select public.is_cryo_employee()));
create policy "employees rename members" on public.sports_team_members for update to authenticated
 using ((select public.is_cryo_employee())) with check ((select public.is_cryo_employee()));
