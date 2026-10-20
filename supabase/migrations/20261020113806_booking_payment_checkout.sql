-- Booking status and payment are independent. Only explicit checkout posts sales.
drop trigger if exists sync_confirmed_booking_sale on public.bookings;
alter table public.bookings add column payment_status text not null default 'pending' check(payment_status in('pending','paid'));
alter table public.bookings add column paid_at timestamptz;
update public.bookings b set payment_status='paid',paid_at=s.created_at from public.sales s
where s.booking_id=b.id and s.archived_at is null and s.golomt+s.khan+s.cash+s.barter>0;
-- Existing accounting records are retained; reports exclude unpaid automatic invoices.

create function private.protect_booking_payment() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user not in ('postgres','supabase_admin') then
  if TG_OP='INSERT' then new.payment_status:='pending'; new.paid_at:=null;
  elsif new.payment_status is distinct from old.payment_status or new.paid_at is distinct from old.paid_at then
   raise exception 'Төлбөрийг төлбөр бүртгэх үйлдлээр хадгална уу' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
revoke all on function private.protect_booking_payment() from public,anon,authenticated;
create trigger protect_booking_payment before insert or update on public.bookings for each row execute function private.protect_booking_payment();

create function private.pay_booking(p_booking_id bigint,p_sale jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.bookings%rowtype; s public.sales%rowtype; employee public.staff%rowtype;
 staff_key bigint:=nullif(p_sale->>'staff_id','')::bigint; k text; n numeric;
 g bigint:=coalesce((p_sale->>'golomt')::bigint,0); h bigint:=coalesce((p_sale->>'khan')::bigint,0);
 c bigint:=coalesce((p_sale->>'cash')::bigint,0); barter_value bigint:=coalesce((p_sale->>'barter')::bigint,0);
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
 foreach k in array array['golomt','khan','cash','barter','invoice','refund','therapist_amount','gift_card','cryo_cabin','oxy_pro','led_pro','x_cryo','zerobody','normatec','oxygen'] loop
  n:=coalesce((p_sale->>k)::numeric,0);
  if n<0 or n<>trunc(n) or n>2147483647 then raise exception 'Тоо, дүн эерэг бүхэл тоо байна'; end if;
 end loop;
 if g+h+c+barter_value<=0 or coalesce((p_sale->>'invoice')::bigint,0)<>0 or coalesce((p_sale->>'refund')::bigint,0)<>0 then raise exception 'Төлсөн дүнгээ банк, бэлэн эсвэл бартерт оруулна уу'; end if;
 if nullif(trim(p_sale->>'customer_name'),'') is null or nullif(trim(p_sale->>'services'),'') is null then raise exception 'Үйлчлүүлэгч, үйлчилгээг бөглөнө үү'; end if;
 select * into employee from public.staff where id=staff_key;
 insert into public.sales(sale_date,customer_name,phone,services,note,staff_id,therapist,therapist_amount,is_internal,gift_card,
 golomt,khan,cash,barter,invoice,refund,cryo_cabin,oxy_pro,led_pro,x_cryo,zerobody,normatec,oxygen,source,source_key,booking_id,created_by)
 values((now() at time zone 'Asia/Ulaanbaatar')::date,trim(p_sale->>'customer_name'),b.phone,trim(p_sale->>'services'),p_sale->>'note',staff_key,employee.name,
 coalesce((p_sale->>'therapist_amount')::bigint,0),coalesce((p_sale->>'is_internal')::boolean,false),coalesce((p_sale->>'gift_card')::bigint,0),
 g,h,c,barter_value,0,0,coalesce((p_sale->>'cryo_cabin')::int,0),coalesce((p_sale->>'oxy_pro')::int,0),coalesce((p_sale->>'led_pro')::int,0),coalesce((p_sale->>'x_cryo')::int,0),coalesce((p_sale->>'zerobody')::int,0),coalesce((p_sale->>'normatec')::int,0),coalesce((p_sale->>'oxygen')::int,0),'booking','booking-paid:'||b.id,b.id,auth.uid())
 on conflict(booking_id) do update set sale_date=excluded.sale_date,customer_name=excluded.customer_name,services=excluded.services,note=excluded.note,
 staff_id=excluded.staff_id,therapist=excluded.therapist,therapist_amount=excluded.therapist_amount,is_internal=excluded.is_internal,gift_card=excluded.gift_card,
 golomt=excluded.golomt,khan=excluded.khan,cash=excluded.cash,barter=excluded.barter,invoice=0,refund=0,cryo_cabin=excluded.cryo_cabin,oxy_pro=excluded.oxy_pro,led_pro=excluded.led_pro,x_cryo=excluded.x_cryo,zerobody=excluded.zerobody,normatec=excluded.normatec,oxygen=excluded.oxygen,archived_at=null,needs_review=false
 returning * into s;
 update public.bookings set payment_status='paid',paid_at=now(),staff_id=staff_key where id=b.id returning * into b;
 return jsonb_build_object('booking',to_jsonb(b),'sale',to_jsonb(s));
end $$;
revoke all on function private.pay_booking(bigint,jsonb) from public,anon;
grant execute on function private.pay_booking(bigint,jsonb) to authenticated;
create function public.pay_booking(p_booking_id bigint,p_sale jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.pay_booking(p_booking_id,p_sale)$$;
revoke all on function public.pay_booking(bigint,jsonb) from public,anon;
grant execute on function public.pay_booking(bigint,jsonb) to authenticated;
