-- Keep service duration truthful. Only the equipment reservation window changes.
-- Preserve the existing trigger's privileged catalogue lookup, not a callable RPC.
create or replace function public.prepare_booking_schedule()
returns trigger language plpgsql security definer set search_path = '' as $$
declare svc public.services%rowtype;
begin
  if new.service_id is null then return new; end if;
  -- A status-only change must not reschedule historical appointments.
  if TG_OP = 'UPDATE' then
    if new.service_id is not distinct from old.service_id
      and new.starts_at is not distinct from old.starts_at
      and new.booked_date is not distinct from old.booked_date
      and new.booked_time is not distinct from old.booked_time then
      return new;
    end if;
  end if;
  select * into svc from public.services where id = new.service_id and active;
  if not found then raise exception 'Үйлчилгээ олдсонгүй эсвэл идэвхгүй байна' using errcode='P0001'; end if;
  if new.starts_at is null and new.booked_date is not null and new.booked_time is not null then
    new.starts_at := (new.booked_date + new.booked_time::time) at time zone 'Asia/Ulaanbaatar';
  end if;
  if new.starts_at is null then raise exception 'Захиалгын эхлэх цаг шаардлагатай' using errcode='23502'; end if;
  new.duration_minutes := svc.duration_minutes;
  new.ends_at := new.starts_at + make_interval(mins => svc.duration_minutes);
  new.blocked_until := new.starts_at + make_interval(mins => case when svc.duration_minutes <= 30 then 30 else svc.duration_minutes + 2 end);
  new.service := svc.name;
  new.booked_date := (new.starts_at at time zone 'Asia/Ulaanbaatar')::date;
  new.booked_time := to_char(new.starts_at at time zone 'Asia/Ulaanbaatar','HH24:MI');
  return new;
end $$;
revoke all on function public.prepare_booking_schedule() from public, anon, authenticated;

-- Existing future appointments retain their actual start/end; sync trigger updates availability.
-- The existing exclusion constraint rejects this entire migration if a conflict appears.
update public.bookings
set blocked_until = starts_at + interval '30 minutes'
where starts_at >= now() and duration_minutes <= 30 and status <> 'cancelled';
