-- 1) Staff see every appointment, past and present, so they can record status,
--    provider and payment for earlier visits. (Creating a new booking in the past
--    remains an administrator action — see guard_booking_backdate.)
-- 2) Gift card is a payment method for bookings. Like internal usage it is kept
--    in its own column (sales.gift_card) and is not added to cash revenue, because
--    the card's value was taken when the card was sold.

drop policy if exists "staff read bookings" on public.bookings;
create policy "staff read bookings" on public.bookings for select to authenticated
using (exists(select 1 from public.profiles where id=(select auth.uid()) and role='staff'));

create or replace function private.pay_booking(p_booking_id bigint,p_sale jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.bookings%rowtype; s public.sales%rowtype; employee public.staff%rowtype;
 staff_key bigint:=nullif(p_sale->>'staff_id','')::bigint; k text; n numeric;
 g bigint:=coalesce((p_sale->>'golomt')::bigint,0); h bigint:=coalesce((p_sale->>'khan')::bigint,0);
 c bigint:=coalesce((p_sale->>'cash')::bigint,0); internal_value bigint:=coalesce((p_sale->>'internal_amount')::bigint,0); barter_value bigint:=coalesce((p_sale->>'barter')::bigint,0); gift bigint:=coalesce((p_sale->>'gift_card')::bigint,0);
begin
 perform private.require_cryo_staff(staff_key);
 select * into b from public.bookings where id=p_booking_id for update;
 if not found then raise exception 'Захиалга олдсонгүй'; end if;
 select * into s from public.sales where booking_id=b.id;
 if b.payment_status='paid' then
  if s.id is null then raise exception 'Төлбөрийн бүртгэлийг админаар шалгуулна уу'; end if;
  return jsonb_build_object('booking',to_jsonb(b),'sale',to_jsonb(s));
 end if;
 if b.status='cancelled' then raise exception 'Цуцалсан захиалгад төлбөр бүртгэх боломжгүй'; end if;
 if b.booking_kind='package' then raise exception 'Багцын ашиглалтад давхар төлбөр бүртгэхгүй'; end if;
 -- The booked service is authoritative; never ask staff to re-enter device counts.
 select p_sale || jsonb_build_object('services',svc.name||' ×1',
 'cryo_cabin',case when svc.slug='cryocabin' then 1 else 0 end,
 'oxy_pro',case when svc.slug='oxypro' then 1 else 0 end,
 'led_pro',case when svc.slug='ledpro' then 1 else 0 end,
 'x_cryo',case when svc.slug='xcryo' then 1 else 0 end,
 'zerobody',case when svc.slug='zerobody' then 1 else 0 end,
 'normatec',case when svc.slug='normatec' then 1 else 0 end,
 'oxygen',case when svc.slug='oxygen' then 1 else 0 end) into p_sale
 from public.services svc where svc.id=b.service_id;
 if p_sale is null then raise exception 'Захиалгын төхөөрөмж олдсонгүй'; end if;
 foreach k in array array['internal_amount','golomt','khan','cash','barter','invoice','refund','therapist_amount','gift_card','cryo_cabin','oxy_pro','led_pro','x_cryo','zerobody','normatec','oxygen'] loop
  n:=coalesce((p_sale->>k)::numeric,0);
  if n<0 or n<>trunc(n) or n>2147483647 then raise exception 'Тоо, дүн эерэг бүхэл тоо байна'; end if;
 end loop;
 if internal_value>0 or coalesce((p_sale->>'is_internal')::boolean,false) then
  select price into internal_value from public.services where id=b.service_id and active;
  if internal_value is null or internal_value<=0 then raise exception 'Төхөөрөмжийн үндсэн үнэ олдсонгүй'; end if;
  if g+h+c+barter_value+gift<>0 then raise exception 'Дотоод бүртгэлийг мөнгөн төлбөртэй холихгүй'; end if;
 end if;
 if g+h+c+barter_value+internal_value+gift<=0 or coalesce((p_sale->>'invoice')::bigint,0)<>0 or coalesce((p_sale->>'refund')::bigint,0)<>0 then raise exception 'Төлсөн дүнгээ банк, бэлэн, бартер эсвэл gift card-д оруулна уу'; end if;
 if nullif(trim(p_sale->>'customer_name'),'') is null or nullif(trim(p_sale->>'services'),'') is null then raise exception 'Үйлчлүүлэгч, үйлчилгээг бөглөнө үү'; end if;
 select * into employee from public.staff where id=staff_key;
 insert into public.sales(sale_date,customer_name,phone,services,note,staff_id,therapist,therapist_amount,is_internal,internal_amount,gift_card,
 golomt,khan,cash,barter,invoice,refund,cryo_cabin,oxy_pro,led_pro,x_cryo,zerobody,normatec,oxygen,source,source_key,booking_id,created_by)
 values((now() at time zone 'Asia/Ulaanbaatar')::date,trim(p_sale->>'customer_name'),b.phone,trim(p_sale->>'services'),p_sale->>'note',staff_key,employee.name,
 coalesce((p_sale->>'therapist_amount')::bigint,0),(internal_value>0 or coalesce((p_sale->>'is_internal')::boolean,false)),internal_value,gift,
 g,h,c,barter_value,0,0,coalesce((p_sale->>'cryo_cabin')::int,0),coalesce((p_sale->>'oxy_pro')::int,0),coalesce((p_sale->>'led_pro')::int,0),coalesce((p_sale->>'x_cryo')::int,0),coalesce((p_sale->>'zerobody')::int,0),coalesce((p_sale->>'normatec')::int,0),coalesce((p_sale->>'oxygen')::int,0),'booking','booking-paid:'||b.id,b.id,auth.uid())
 on conflict(booking_id) do update set sale_date=excluded.sale_date,customer_name=excluded.customer_name,services=excluded.services,note=excluded.note,
 staff_id=excluded.staff_id,therapist=excluded.therapist,therapist_amount=excluded.therapist_amount,is_internal=excluded.is_internal,internal_amount=excluded.internal_amount,gift_card=excluded.gift_card,
 golomt=excluded.golomt,khan=excluded.khan,cash=excluded.cash,barter=excluded.barter,invoice=0,refund=0,cryo_cabin=excluded.cryo_cabin,oxy_pro=excluded.oxy_pro,led_pro=excluded.led_pro,x_cryo=excluded.x_cryo,zerobody=excluded.zerobody,normatec=excluded.normatec,oxygen=excluded.oxygen,archived_at=null,needs_review=false
 returning * into s;
 update public.bookings set payment_status='paid',paid_at=now(),staff_id=staff_key where id=b.id returning * into b;
 return jsonb_build_object('booking',to_jsonb(b),'sale',to_jsonb(s));
end $$;


-- pay_bookings: allocate gift card like the other payment channels.
create or replace function private.pay_bookings(p_booking_ids bigint[],p_sale jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare anchor public.bookings%rowtype; b public.bookings%rowtype;
 result jsonb; results jsonb:='[]'; sale_rows jsonb:='[]'; part jsonb; remaining jsonb:=p_sale;
 total bigint:=0; price bigint; due bigint; allocation bigint; channel text; supplied bigint:=0; n int:=0;
 internal_mode boolean:=coalesce((p_sale->>'is_internal')::boolean,false) or coalesce((p_sale->>'internal_amount')::bigint,0)>0;
 sale_day date:=nullif(p_sale->>'sale_date','')::date; sale_json jsonb;
begin
 perform private.require_cryo_staff(nullif(p_sale->>'staff_id','')::bigint);
 if p_booking_ids is null or cardinality(p_booking_ids)=0 then raise exception 'Захиалга сонгоно уу'; end if;
 -- Lock in id order so concurrent checkouts of overlapping sets cannot deadlock.
 perform 1 from public.bookings where id=any(p_booking_ids) order by id for update;
 select * into anchor from public.bookings where id=p_booking_ids[1];
 if not found then raise exception 'Захиалга олдсонгүй'; end if;
 for b in select * from public.bookings where id=any(p_booking_ids) order by id loop
  -- Same customer = same team, else same phone, else (no phone) same name.
  if b.team_id is distinct from anchor.team_id
   or (anchor.team_id is null and private.normalize_mn_phone(anchor.phone) is not null and private.normalize_mn_phone(b.phone) is distinct from private.normalize_mn_phone(anchor.phone))
   or (anchor.team_id is null and private.normalize_mn_phone(anchor.phone) is null and lower(btrim(b.customer_name)) is distinct from lower(btrim(anchor.customer_name))) then
   raise exception 'Нэг үйлчлүүлэгчийн захиалгуудыг л нэгтгэж төлнө';
  end if;
 end loop;
 foreach channel in array array['cash','golomt','khan','barter','gift_card','internal_amount'] loop
  allocation:=coalesce((p_sale->>channel)::bigint,0);
  if allocation<0 then raise exception 'Төлөлтийн дүн буруу'; end if;
  supplied:=supplied+allocation;
 end loop;
 if internal_mode and supplied<>coalesce((p_sale->>'internal_amount')::bigint,0) then raise exception 'Дотоод бүртгэлийг мөнгөн төлбөртэй холихгүй'; end if;
 for b in select * from public.bookings where id=any(p_booking_ids) and status<>'cancelled' and payment_status<>'paid' and booking_kind<>'package' order by id loop
  select s.price into price from public.services s where s.id=b.service_id and s.active;
  if price is null or price<=0 then raise exception 'Үндсэн үнэ олдсонгүй'; end if;
  total:=total+price; n:=n+1;
 end loop;
 if n=0 then raise exception 'Төлөх захиалга үлдээгүй байна. Хуудсаа шинэчилнэ үү.'; end if;
 if internal_mode then supplied:=total;remaining:=remaining||jsonb_build_object('internal_amount',total);end if;
 if total<>supplied then raise exception 'Нийт төлбөр %₮ байх ёстой. Захиалгаа шинэчилнэ үү.',total; end if;
 for b in select * from public.bookings where id=any(p_booking_ids) and status<>'cancelled' and payment_status<>'paid' and booking_kind<>'package' order by id loop
  select s.price into due from public.services s where s.id=b.service_id;
  part:=p_sale||jsonb_build_object('customer_name',b.customer_name,'services',b.service,'internal_amount',0,'gift_card',0,'therapist_amount',0);
  foreach channel in array array['cash','golomt','khan','barter','gift_card','internal_amount'] loop
   allocation:=least(due,coalesce((remaining->>channel)::bigint,0));
   part:=part||jsonb_build_object(channel,allocation);
   remaining:=remaining||jsonb_build_object(channel,coalesce((remaining->>channel)::bigint,0)-allocation);
   due:=due-allocation;
  end loop;
  result:=private.pay_booking(b.id,part);
  -- Administrators back-filling a past appointment record the sale on the visit day.
  if sale_day is not null and public.is_admin() then
   update public.sales sl set sale_date=sale_day where sl.id=(result->'sale'->>'id')::bigint returning to_jsonb(sl) into sale_json;
   result:=result||jsonb_build_object('sale',sale_json);
  end if;
  results:=results||jsonb_build_array(result->'booking');sale_rows:=sale_rows||jsonb_build_array(result->'sale');
 end loop;
 return jsonb_build_object('bookings',results,'sales',sale_rows,'booking',results->0,'sale',sale_rows->0);
end $$;
revoke all on function private.pay_bookings(bigint[],jsonb) from public,anon;
grant execute on function private.pay_bookings(bigint[],jsonb) to authenticated;
create or replace function public.pay_bookings(p_booking_ids bigint[],p_sale jsonb)
returns jsonb language sql security invoker set search_path='' as $$select private.pay_bookings(p_booking_ids,p_sale)$$;
revoke all on function public.pay_bookings(bigint[],jsonb) from public,anon;
grant execute on function public.pay_bookings(bigint[],jsonb) to authenticated;
