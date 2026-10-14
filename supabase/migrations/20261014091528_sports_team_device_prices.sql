create function public.valid_sports_team_prices(prices jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
begin
 if prices is null or jsonb_typeof(prices)<>'object' then return false; end if;
 return not exists(select 1 from jsonb_each(prices) e where e.key !~ '^[1-9][0-9]*$' or jsonb_typeof(e.value)<>'number' or case when jsonb_typeof(e.value)='number' then (e.value::text)::numeric<0 or (e.value::text)::numeric>9007199254740991 or trunc((e.value::text)::numeric)<>(e.value::text)::numeric else true end);
end $$;
revoke all on function public.valid_sports_team_prices(jsonb) from public,anon;
grant execute on function public.valid_sports_team_prices(jsonb) to authenticated;
alter table public.sports_teams add column service_prices jsonb not null default '{}'::jsonb check(public.valid_sports_team_prices(service_prices));
grant update(service_prices) on public.sports_teams to authenticated;
create function public.create_sports_team_priced(p_name text,p_members text[],p_request_id uuid,p_prices jsonb)
returns public.sports_teams language plpgsql security invoker set search_path='' as $$
declare result public.sports_teams%rowtype;
begin
 if auth.uid() is null or not public.is_cryo_employee() then raise exception 'Ажилтны эрх шаардлагатай' using errcode='42501'; end if;
 if not public.valid_sports_team_prices(p_prices) then raise exception 'Төхөөрөмжийн үнийг зөв оруулна уу'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into result from public.sports_teams where request_id=p_request_id;
 if found then return result; end if;
 result:=public.create_sports_team(p_name,p_members,p_request_id);
 update public.sports_teams set service_prices=p_prices where id=result.id returning * into result;
 return result;
end $$;
revoke all on function public.create_sports_team_priced(text,text[],uuid,jsonb) from public,anon;
grant execute on function public.create_sports_team_priced(text,text[],uuid,jsonb) to authenticated;
