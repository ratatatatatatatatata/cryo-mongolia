revoke update,delete,truncate,references,trigger on public.sports_teams,public.sports_team_members,public.sports_team_visits from authenticated;
grant update(name) on public.sports_teams to authenticated;
grant update(full_name) on public.sports_team_members to authenticated;
