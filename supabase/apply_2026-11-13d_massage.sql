-- °CRYO Mongolia · барианы цэс. apply_2026-11-13_all.sql-ийг аль хэдийн ажиллуулсан бол зөвхөн үүнийг Run дарна.
begin;
-- Massage menu: the existing "Бүтэн биеийн бариа" becomes 90 min / ₮250,000 and
-- the other massages are nested inside it, sharing its calendar.
update public.services set duration='90 мин',duration_minutes=90,price=250000,updated_at=now()
where slug='massage' and (duration_minutes is distinct from 90 or price is distinct from 250000);

insert into public.services(slug,name,category,duration,duration_minutes,price,sort,active,parent_id)
select v.slug,v.name,p.category,v.mins||' мин',v.mins,v.price,coalesce(p.sort,0)*100+v.ord,true,p.id
from (values
 ('massage-lymph','Лимфийн бариа',60,200000,1),
 ('massage-kids','Хүүхдийн бариа',40,75000,2),
 ('massage-anticellulite','Антицеллюлит массаж',30,129000,3),
 ('massage-sport','Спорт бариа',45,150000,4)
) as v(slug,name,mins,price,ord)
cross join (select id,sort,category from public.services where slug='massage') p
where not exists(select 1 from public.services s where s.slug=v.slug or lower(btrim(s.name))=lower(btrim(v.name)));
commit;
select name,duration_minutes,price from public.services where slug like 'massage%' order by sort;
