alter table public.sports_teams add column archived_at timestamptz;
alter table public.sports_team_members add column archived_at timestamptz;
grant update(archived_at) on public.sports_teams,public.sports_team_members to authenticated;
create function public.guard_sports_archive() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (tg_op='INSERT' and new.archived_at is not null) or (tg_op='UPDATE' and new.archived_at is distinct from old.archived_at) then
  if auth.uid() is null or not public.is_admin() then raise exception 'Зөвхөн админ устгах эрхтэй' using errcode='42501'; end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_sports_archive() from public,anon;
create trigger guard_team_archive before insert or update on public.sports_teams for each row execute function public.guard_sports_archive();
create trigger guard_member_archive before insert or update on public.sports_team_members for each row execute function public.guard_sports_archive();
create function public.guard_active_sports_visit() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.sports_teams where id=new.team_id and archived_at is null for share;
 if not found then raise exception 'Устгасан багт оролт бүртгэх боломжгүй'; end if;
 perform 1 from public.sports_team_members where id=new.member_id and team_id=new.team_id and archived_at is null for share;
 if not found then raise exception 'Устгасан тамирчинд оролт бүртгэх боломжгүй'; end if;
 return new;
end $$;
revoke all on function public.guard_active_sports_visit() from public,anon;
create trigger guard_active_sports_visit before insert on public.sports_team_visits for each row execute function public.guard_active_sports_visit();
