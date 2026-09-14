-- Device-aware realtime booking with a mandatory 2-minute equipment reset buffer.
create extension if not exists btree_gist;

alter table public.services add column if not exists duration_minutes integer;
update public.services
set duration_minutes = case
  when slug = 'xcryo' then 3
  else greatest(1, coalesce((regexp_match(duration, '(\d+)'))[1]::integer, 30))
end
where duration_minutes is null;
alter table public.services alter column duration_minutes set default 30;
alter table public.services
  add constraint services_duration_minutes_check
  check (duration_minutes between 1 and 480) not valid;

alter table public.bookings add column if not exists service_id bigint references public.services(id);
alter table public.bookings add column if not exists starts_at timestamptz;
alter table public.bookings add column if not exists ends_at timestamptz;
alter table public.bookings add column if not exists blocked_until timestamptz;
alter table public.bookings add column if not exists duration_minutes integer;

create or replace function public.prepare_booking_schedule()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  svc public.services%rowtype;
begin
  if new.service_id is null then
    return new;
  end if;

  select * into svc
  from public.services
  where id = new.service_id and active;

  if not found then
    raise exception 'Үйлчилгээ олдсонгүй эсвэл идэвхгүй байна' using errcode = 'P0001';
  end if;

  if new.starts_at is null and new.booked_date is not null and new.booked_time is not null then
    new.starts_at := (new.booked_date + new.booked_time::time) at time zone 'Asia/Ulaanbaatar';
  end if;
  if new.starts_at is null then
    raise exception 'Захиалгын эхлэх цаг шаардлагатай' using errcode = '23502';
  end if;

  new.duration_minutes := svc.duration_minutes;
  new.ends_at := new.starts_at + make_interval(mins => svc.duration_minutes);
  new.blocked_until := new.ends_at + interval '2 minutes';
  new.service := svc.name;
  new.booked_date := (new.starts_at at time zone 'Asia/Ulaanbaatar')::date;
  new.booked_time := to_char(new.starts_at at time zone 'Asia/Ulaanbaatar', 'HH24:MI');
  return new;
end
$$;

drop trigger if exists trg_prepare_booking_schedule on public.bookings;
create trigger trg_prepare_booking_schedule
before insert or update of service_id, starts_at, booked_date, booked_time, status
on public.bookings
for each row execute function public.prepare_booking_schedule();

alter table public.bookings drop constraint if exists bookings_no_device_overlap;
alter table public.bookings
  add constraint bookings_no_device_overlap
  exclude using gist (
    service_id with =,
    tstzrange(starts_at, blocked_until, '[)') with &&
  )
  where (
    status <> 'cancelled'
    and service_id is not null
    and starts_at is not null
    and blocked_until is not null
  );

create table if not exists public.booking_blocks (
  booking_id bigint primary key references public.bookings(id) on delete cascade,
  service_id bigint not null references public.services(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  blocked_until timestamptz not null,
  status text not null
);

alter table public.booking_blocks enable row level security;
drop policy if exists "public reads booking availability" on public.booking_blocks;
create policy "public reads booking availability"
on public.booking_blocks for select to anon, authenticated using (true);
grant select on public.booking_blocks to anon, authenticated;

create or replace function public.sync_booking_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.booking_blocks where booking_id = old.id;
    return old;
  end if;

  delete from public.booking_blocks where booking_id = new.id;
  if new.status <> 'cancelled'
     and new.service_id is not null
     and new.starts_at is not null
     and new.ends_at is not null then
    insert into public.booking_blocks
      (booking_id, service_id, starts_at, ends_at, blocked_until, status)
    values
      (new.id, new.service_id, new.starts_at, new.ends_at, new.blocked_until, new.status);
  end if;
  return new;
end
$$;

drop trigger if exists trg_sync_booking_block on public.bookings;
create trigger trg_sync_booking_block
after insert or update or delete on public.bookings
for each row execute function public.sync_booking_block();

insert into public.booking_blocks
  (booking_id, service_id, starts_at, ends_at, blocked_until, status)
select id, service_id, starts_at, ends_at, blocked_until, status
from public.bookings
where status <> 'cancelled'
  and service_id is not null
  and starts_at is not null
  and ends_at is not null
on conflict (booking_id) do update set
  service_id = excluded.service_id,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  blocked_until = excluded.blocked_until,
  status = excluded.status;

drop policy if exists "staff read bookings" on public.bookings;
create policy "staff read bookings"
on public.bookings for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'staff'
  )
);

alter table public.packages add column if not exists archived_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'booking_blocks'
  ) then
    alter publication supabase_realtime add table public.booking_blocks;
  end if;
end
$$;
