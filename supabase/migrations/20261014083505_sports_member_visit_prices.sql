alter table public.sports_team_visits add column price bigint check(price>=0);

create function public.record_sports_member_visit(p_team_id bigint,p_member_id bigint,p_devices jsonb,p_visited_at timestamptz,p_staff_id bigint,p_note text,p_request_id uuid)
returns integer language plpgsql security invoker set search_path='' as $$
declare inserted integer;
begin
 if auth.uid() is null or not public.is_cryo_employee() then raise exception 'Ажилтны эрх шаардлагатай' using errcode='42501'; end if;
 if p_devices is null or jsonb_typeof(p_devices)<>'array' then raise exception 'Төхөөрөмжөө сонгоно уу'; end if;
 if jsonb_array_length(p_devices) not between 1 and 100 or p_request_id is null or p_visited_at is null then raise exception 'Төхөөрөмж болон огноогоо сонгоно уу'; end if;
 if not exists(select 1 from public.sports_team_members where id=p_member_id and team_id=p_team_id) then raise exception 'Энэ багийн гишүүнээ сонгоно уу'; end if;
 if exists(select 1 from jsonb_array_elements(p_devices) d where jsonb_typeof(d->'price') is distinct from 'number' or (d->>'price')::numeric<0 or (d->>'price')::numeric>9007199254740991 or (d->>'price')::numeric<>trunc((d->>'price')::numeric) or not exists(select 1 from public.services s where s.id=(d->>'service_id')::bigint and s.active and s.category<>'legacy-import')) then raise exception 'Төхөөрөмж болон үнийг зөв оруулна уу'; end if;
 if (select count(distinct (d->>'service_id')::bigint) from jsonb_array_elements(p_devices) d)<>jsonb_array_length(p_devices) then raise exception 'Төхөөрөмж давхардсан байна'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 if exists(select 1 from public.sports_team_visits where request_id=p_request_id) then return 0; end if;
 insert into public.sports_team_visits(team_id,member_id,service_id,service_label,price,visited_at,staff_id,note,request_id)
 select p_team_id,p_member_id,s.id,s.name,(d->>'price')::bigint,p_visited_at,p_staff_id,nullif(trim(p_note),''),p_request_id
 from jsonb_array_elements(p_devices) d join public.services s on s.id=(d->>'service_id')::bigint;
 get diagnostics inserted=row_count;
 return inserted;
end $$;
revoke all on function public.record_sports_member_visit(bigint,bigint,jsonb,timestamptz,bigint,text,uuid) from public,anon;
grant execute on function public.record_sports_member_visit(bigint,bigint,jsonb,timestamptz,bigint,text,uuid) to authenticated;
