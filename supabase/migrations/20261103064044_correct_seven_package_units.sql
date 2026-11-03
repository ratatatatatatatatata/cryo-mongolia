-- User-confirmed catalog units, 2026-11-03. Existing customer entitlements and usage are preserved.
do $$
declare specification jsonb:='{"discover": {"cryocabin": 1, "xcryo": 1, "ledpro": 1, "zerobody": 1, "normatec": 1, "oxypro": 1}, "athlete": {"cryocabin": 6, "normatec": 8, "xcryo": 4, "oxypro": 4, "zerobody": 2, "massage": 2}, "reset": {"cryocabin": 4, "oxypro": 8, "zerobody": 4, "ledpro": 4, "normatec": 4, "oxygen": 8, "massage": 2}, "glow": {"ledpro": 8, "xcryo": 8, "facial": 4, "oxypro": 2, "zerobody": 2}, "sleep": {"oxypro": 8, "zerobody": 4, "ledpro": 4, "oxygen": 8, "cryocabin": 2, "massage": 2}, "agereset": {"cryocabin": 8, "oxypro": 4, "ledpro": 8, "xcryo": 8, "normatec": 4, "zerobody": 4, "massage": 4, "oxygen": 8, "facial": 4}, "under21": {"ledpro": 6, "xcryo": 6, "facial": 5, "oxygen": 6, "zerobody": 3}}'::jsonb; entry record; mapped jsonb; expected integer; changed integer;
begin
 for entry in select key,value from jsonb_each(specification) loop
  select count(*) into expected from jsonb_each(entry.value);
  select jsonb_agg(jsonb_build_object('service_id',s.id,'service_name',s.name,'units',v.value::int) order by s.id) into mapped
  from jsonb_each_text(entry.value) v join public.services s on s.slug=v.key and s.active;
  if jsonb_array_length(mapped) is distinct from expected then raise exception 'Missing or duplicate services for %',entry.key; end if;
  update public.packages set service_units=mapped where slug=entry.key and active and archived_at is null;
  get diagnostics changed=row_count;
  if changed<>1 then raise exception 'Expected one active package for %',entry.key; end if;
 end loop;
end $$;
