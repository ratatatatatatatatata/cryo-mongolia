alter table public.bookings add column team_id bigint references public.sports_teams(id);
create index bookings_team_id_idx on public.bookings(team_id) where team_id is not null;
