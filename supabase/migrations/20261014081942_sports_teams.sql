create table public.sports_teams (
 id bigint generated always as identity primary key,
 name text not null check(length(trim(name)) between 1 and 200),
 request_id uuid not null unique,
 created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now()
);
create table public.sports_team_members (
 id bigint generated always as identity primary key,
 team_id bigint not null references public.sports_teams(id),
 full_name text not null check(length(trim(full_name)) between 1 and 200),
 created_by uuid not null default auth.uid() references auth.users(id),
 unique(id,team_id)
);
create table public.sports_team_visits (
 id bigint generated always as identity primary key,
 team_id bigint not null references public.sports_teams(id),
 member_id bigint not null,
 service_id bigint not null references public.services(id),
 service_label text not null,
 visited_at timestamptz not null,
 staff_id bigint not null references public.staff(id),
 note text check(length(note)<=1000),
 request_id uuid not null,
 created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now(),
 foreign key(member_id,team_id) references public.sports_team_members(id,team_id),
 unique(request_id,member_id,service_id)
);
create index sports_members_team_idx on public.sports_team_members(team_id);
create index sports_visits_team_date_idx on public.sports_team_visits(team_id,visited_at);
create index sports_visits_member_idx on public.sports_team_visits(member_id);
alter table public.sports_teams enable row level security;
alter table public.sports_team_members enable row level security;
alter table public.sports_team_visits enable row level security;
create policy "employees read teams" on public.sports_teams for select to authenticated using ((select public.is_cryo_employee()));
create policy "employees create teams" on public.sports_teams for insert to authenticated with check ((select public.is_cryo_employee()) and created_by=(select auth.uid()));
create policy "employees read team members" on public.sports_team_members for select to authenticated using ((select public.is_cryo_employee()));
create policy "employees create team members" on public.sports_team_members for insert to authenticated with check ((select public.is_cryo_employee()) and created_by=(select auth.uid()));
create policy "employees read team visits" on public.sports_team_visits for select to authenticated using ((select public.is_cryo_employee()));
create policy "employees create team visits" on public.sports_team_visits for insert to authenticated with check (
 (select public.is_cryo_employee()) and created_by=(select auth.uid()) and exists(select 1 from public.staff s where s.id=staff_id and s.active and
 ((select public.is_admin()) or (select public.is_shared_staff_account()) or s.user_id=(select auth.uid())))
);
revoke all on public.sports_teams,public.sports_team_members,public.sports_team_visits from anon;
grant select,insert on public.sports_teams,public.sports_team_members,public.sports_team_visits to authenticated;
grant usage,select on sequence public.sports_teams_id_seq,public.sports_team_members_id_seq,public.sports_team_visits_id_seq to authenticated;

create function public.create_sports_team(p_name text,p_members text[],p_request_id uuid)
returns public.sports_teams language plpgsql security invoker set search_path='' as $$
declare result public.sports_teams%rowtype;
begin
 if auth.uid() is null or not public.is_cryo_employee() then raise exception 'Ажилтны эрх шаардлагатай' using errcode='42501'; end if;
 if p_request_id is null or coalesce(cardinality(p_members),0) not between 1 and 500 or exists(select 1 from unnest(p_members) n where n is null or length(trim(n)) not between 1 and 200) then raise exception 'Гишүүдийн нэрээ зөв оруулна уу'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into result from public.sports_teams where request_id=p_request_id;
 if found then return result; end if;
 insert into public.sports_teams(name,request_id) values(trim(p_name),p_request_id) returning * into result;
 insert into public.sports_team_members(team_id,full_name) select result.id,trim(n) from unnest(p_members) n;
 return result;
end $$;
revoke all on function public.create_sports_team(text,text[],uuid) from public,anon;
grant execute on function public.create_sports_team(text,text[],uuid) to authenticated;

create function public.record_sports_team_visit(p_team_id bigint,p_members bigint[],p_services bigint[],p_visited_at timestamptz,p_staff_id bigint,p_note text,p_request_id uuid)
returns integer language plpgsql security invoker set search_path='' as $$
declare inserted integer;
begin
 if auth.uid() is null or not public.is_cryo_employee() then raise exception 'Ажилтны эрх шаардлагатай' using errcode='42501'; end if;
 if coalesce(cardinality(p_members),0) not between 1 and 500 or coalesce(cardinality(p_services),0) not between 1 and 100 or p_request_id is null or p_visited_at is null then raise exception 'Гишүүд, төхөөрөмж болон огноогоо сонгоно уу'; end if;
 if exists(select 1 from unnest(p_members) x where x is null or not exists(select 1 from public.sports_team_members m where m.id=x and m.team_id=p_team_id)) then raise exception 'Энэ багт хамаарах гишүүдээ сонгоно уу'; end if;
 if exists(select 1 from unnest(p_services) x where x is null or not exists(select 1 from public.services s where s.id=x and s.active and s.category<>'legacy-import')) then raise exception 'Идэвхтэй төхөөрөмжөө сонгоно уу'; end if;
 insert into public.sports_team_visits(team_id,member_id,service_id,service_label,visited_at,staff_id,note,request_id)
 select p_team_id,m.id,s.id,s.name,p_visited_at,p_staff_id,nullif(trim(p_note),''),p_request_id
 from public.sports_team_members m cross join public.services s
 where m.id=any(p_members) and s.id=any(p_services)
 on conflict(request_id,member_id,service_id) do nothing;
 get diagnostics inserted=row_count;
 return inserted;
end $$;
revoke all on function public.record_sports_team_visit(bigint,bigint[],bigint[],timestamptz,bigint,text,uuid) from public,anon;
grant execute on function public.record_sports_team_visit(bigint,bigint[],bigint[],timestamptz,bigint,text,uuid) to authenticated;
