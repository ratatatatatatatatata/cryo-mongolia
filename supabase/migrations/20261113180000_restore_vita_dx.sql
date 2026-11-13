-- Make sure "Vita DX" (90 min, ₮249,000) is in the beauty menu: revive and
-- re-file it if a row already exists under that slug or name, else add it.
do $$
declare parent public.services%rowtype; existing bigint;
begin
 select * into parent from public.services where slug='facial';
 if not found then raise notice 'facial service missing; Vita DX not added'; return; end if;
 select id into existing from public.services where slug='beauty-vitadx' or lower(btrim(name))='vita dx' order by (slug='beauty-vitadx') desc, id limit 1;
 if existing is null then
  insert into public.services(slug,name,category,duration,duration_minutes,price,sort,active,parent_id)
  values('beauty-vitadx','Vita DX','beauty','90 мин',90,249000,coalesce(parent.sort,0)*100+5,true,parent.id);
 else
  update public.services set name='Vita DX',category='beauty',duration='90 мин',duration_minutes=90,price=249000,
   active=true,archived_at=null,parent_id=parent.id,updated_at=now() where id=existing;
 end if;
end $$;
