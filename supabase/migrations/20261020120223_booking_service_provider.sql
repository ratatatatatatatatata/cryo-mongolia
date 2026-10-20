alter table public.bookings add column performed_by bigint references public.staff(id), add column performed_at timestamptz;
create index bookings_performed_by_idx on public.bookings(performed_by) where performed_by is not null;
create function private.protect_booking_provider() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user not in ('postgres','supabase_admin') then
  if TG_OP='INSERT' then new.performed_by:=null; new.performed_at:=null;
  elsif new.performed_by is distinct from old.performed_by or new.performed_at is distinct from old.performed_at then
   raise exception 'Үйлчилгээ үзүүлсэн ажилтныг бүртгэх үйлдлээр хадгална уу' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
revoke all on function private.protect_booking_provider() from public,anon,authenticated;
create trigger protect_booking_provider before insert or update on public.bookings for each row execute function private.protect_booking_provider();
create function private.record_booking_provider(p_booking_id bigint,p_staff_id bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.bookings%rowtype;
begin
 if auth.uid() is null or not public.is_cryo_employee() then raise exception 'Ажилтны эрх шаардлагатай' using errcode='42501'; end if;
 if not exists(select 1 from public.staff where id=p_staff_id and active) then raise exception 'Идэвхтэй ажилтан сонгоно уу'; end if;
 select * into b from public.bookings where id=p_booking_id for update;
 if not found then raise exception 'Захиалга олдсонгүй'; end if;
 if b.status='cancelled' then raise exception 'Цуцалсан захиалгад үйлчилгээ бүртгэхгүй'; end if;
 update public.bookings set performed_by=p_staff_id,performed_at=coalesce(performed_at,now()),status='done' where id=b.id returning * into b;
 return to_jsonb(b);
end $$;
revoke all on function private.record_booking_provider(bigint,bigint) from public,anon;
grant execute on function private.record_booking_provider(bigint,bigint) to authenticated;
create function public.record_booking_provider(p_booking_id bigint,p_staff_id bigint) returns jsonb
language sql security invoker set search_path='' as $$select private.record_booking_provider(p_booking_id,p_staff_id)$$;
revoke all on function public.record_booking_provider(bigint,bigint) from public,anon;
grant execute on function public.record_booking_provider(bigint,bigint) to authenticated;
