alter table public.package_redemptions
  add column if not exists service_id bigint references public.services(id) on delete set null,
  add column if not exists service_label text,
  add column if not exists staff_id bigint references public.staff(id) on delete set null,
  add column if not exists notes text;

create index if not exists package_redemptions_service_idx
  on public.package_redemptions(service_id, used_on desc);

update public.package_redemptions pr
set service_label = case
  when lower(c.package_label) like '%cryo cabin%' then 'CryoCabin™'
  when lower(c.package_label) like '%x cryo%' or lower(c.package_label) like '%spot%' then 'X°Cryo™'
  when lower(c.package_label) like '%led%' then 'LedPro™'
  when lower(c.package_label) like '%oxy pro%' or lower(c.package_label) like '%oxypro%' then 'OxyPro™'
  when lower(c.package_label) like '%zerobody%' then 'ZeroBody™'
  when lower(c.package_label) like '%normatec%' or lower(c.package_label) like '%compression%' then 'Normatec®'
  when lower(c.package_label) like '%oxygen%' then 'Цэвэр хүчилтөрөгч'
  when lower(c.package_label) like '%baria%' or lower(c.package_label) like '%massage%' then 'Бүтэн биеийн бариа'
  else c.package_label
end
from public.customer_package_contracts c
where c.id = pr.contract_id and pr.service_label is null;

update public.package_redemptions pr
set service_id = case
  when pr.service_label = 'CryoCabin™' then (select id from public.services where slug='cryocabin' limit 1)
  when pr.service_label = 'X°Cryo™' then (select id from public.services where slug='xcryo' limit 1)
  when pr.service_label = 'LedPro™' then (select id from public.services where slug='ledpro' limit 1)
  when pr.service_label = 'OxyPro™' then (select id from public.services where slug='oxypro' limit 1)
  when pr.service_label = 'ZeroBody™' then (select id from public.services where slug='zerobody' limit 1)
  when pr.service_label = 'Normatec®' then (select id from public.services where slug='normatec' limit 1)
  when pr.service_label = 'Цэвэр хүчилтөрөгч' then (select id from public.services where slug='oxygen' limit 1)
  when pr.service_label = 'Бүтэн биеийн бариа' then (select id from public.services where slug='massage' limit 1)
  else null
end
where pr.service_id is null;
