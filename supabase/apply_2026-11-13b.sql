-- °CRYO Mongolia · ажилтан захиалга засах/устгах. Supabase → SQL Editor-т бүтнээр нь хуулж Run дарна.
-- Өмнө нь apply_2026-11-13.sql ажиллуулсан байх ёстой. Дахин ажиллуулсан ч аюулгүй.
begin;
-- Employees (not only administrators) may back-fill past slots, correct an
-- appointment, and delete one. A booking with a recorded payment can only be
-- deleted by an administrator, and its sale is archived rather than lost.

create or replace function public.guard_booking_backdate() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.starts_at < now() and not coalesce(public.is_cryo_employee(),false) then
  if tg_op='INSERT' then raise exception 'Өнгөрсөн цагт зөвхөн ажилтан бүртгэл нэмнэ' using errcode='42501';
  elsif new.starts_at is distinct from old.starts_at then raise exception 'Өнгөрсөн цагт зөвхөн ажилтан өөрчилнө' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_booking_backdate() from public,anon,authenticated;

create or replace function private.edit_booking(p_booking_id bigint,p_patch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.bookings%rowtype; v_name text:=btrim(regexp_replace(coalesce(p_patch->>'customer_name',''),'\s+',' ','g')); v_phone text:=btrim(coalesce(p_patch->>'phone',''));
begin
 if auth.uid() is null or not public.is_cryo_employee() then raise exception 'Ажилтны эрх шаардлагатай' using errcode='42501'; end if;
 select * into b from public.bookings where id=p_booking_id for update;
 if not found then raise exception 'Захиалга олдсонгүй'; end if;
 if v_name='' or char_length(v_name)>200 or v_phone='' or char_length(v_phone)>30 then raise exception 'Үйлчлүүлэгчийн нэр, утсыг оруулна уу'; end if;
 update public.bookings set customer_name=v_name,phone=v_phone,note=nullif(btrim(coalesce(p_patch->>'note','')),'') where id=b.id;
 -- Device and time stay fixed once a payment is recorded against the booking.
 if b.payment_status<>'paid' and (p_patch ? 'service_id' or p_patch ? 'starts_at') then
  update public.bookings set service_id=coalesce((p_patch->>'service_id')::bigint,service_id),
   starts_at=coalesce((p_patch->>'starts_at')::timestamptz,starts_at) where id=b.id;
 end if;
 select * into b from public.bookings where id=p_booking_id;
 return to_jsonb(b);
end $$;
revoke all on function private.edit_booking(bigint,jsonb) from public,anon;
grant execute on function private.edit_booking(bigint,jsonb) to authenticated;
create or replace function public.edit_booking(p_booking_id bigint,p_patch jsonb) returns jsonb
language sql security invoker set search_path='' as $$select private.edit_booking(p_booking_id,p_patch)$$;
revoke all on function public.edit_booking(bigint,jsonb) from public,anon;
grant execute on function public.edit_booking(bigint,jsonb) to authenticated;

create or replace function private.delete_booking(p_booking_id bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.bookings%rowtype; s public.sales%rowtype; has_money boolean:=false;
begin
 if auth.uid() is null or not public.is_cryo_employee() then raise exception 'Ажилтны эрх шаардлагатай' using errcode='42501'; end if;
 select * into b from public.bookings where id=p_booking_id for update;
 if not found then return jsonb_build_object('deleted',p_booking_id); end if;
 select * into s from public.sales where booking_id=b.id for update;
 if s.id is not null then
  has_money:=s.golomt+s.khan+s.cash+s.barter+s.gift_card+s.internal_amount+s.refund<>0;
  if has_money or b.payment_status='paid' then
   if not public.is_admin() then raise exception 'Төлбөр бүртгэгдсэн захиалгыг зөвхөн админ устгана'; end if;
   -- Keep the money trail: detach and archive instead of deleting.
   update public.sales set booking_id=null,archived_at=now(),needs_review=true,
    note=concat_ws(' · ',nullif(note,''),'Захиалга '||b.ref||' устгагдсан') where id=s.id;
  else
   delete from public.sales where id=s.id; -- unpaid placeholder invoice
  end if;
 end if;
 delete from public.bookings where id=b.id;
 return jsonb_build_object('deleted',b.id,'sale_id',s.id,'sale_archived',has_money or b.payment_status='paid');
end $$;
revoke all on function private.delete_booking(bigint) from public,anon;
grant execute on function private.delete_booking(bigint) to authenticated;
create or replace function public.delete_booking(p_booking_id bigint) returns jsonb
language sql security invoker set search_path='' as $$select private.delete_booking(p_booking_id)$$;
revoke all on function public.delete_booking(bigint) from public,anon;
grant execute on function public.delete_booking(bigint) to authenticated;
commit;
select 'Амжилттай' as result;
