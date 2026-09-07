-- Staff may request that one of their own sales be removed, but only an
-- administrator can approve the request. Approved sales are soft-archived so
-- historical data remains recoverable and existing reports keep filtering on
-- sales.archived_at.

create schema if not exists private;

create table if not exists public.sale_deletion_requests (
  id bigint generated always as identity primary key,
  sale_id bigint not null references public.sales(id) on delete restrict,
  requested_by uuid not null references auth.users(id) on delete restrict default auth.uid(),
  reason text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint sale_deletion_reason_length check (char_length(reason) <= 500),
  constraint sale_deletion_review_note_length check (char_length(review_note) <= 500)
);

create unique index if not exists sale_deletion_one_pending_per_sale_idx
  on public.sale_deletion_requests (sale_id)
  where status = 'pending';
create index if not exists sale_deletion_requested_by_idx
  on public.sale_deletion_requests (requested_by, created_at desc);
create index if not exists sale_deletion_pending_idx
  on public.sale_deletion_requests (created_at desc)
  where status = 'pending';

alter table public.sale_deletion_requests enable row level security;

drop policy if exists "staff read own deletion requests" on public.sale_deletion_requests;
drop policy if exists "staff create own deletion requests" on public.sale_deletion_requests;
drop policy if exists "admins review deletion requests" on public.sale_deletion_requests;

create policy "staff read own deletion requests"
  on public.sale_deletion_requests for select to authenticated
  using (
    (select public.is_admin())
    or requested_by = (select auth.uid())
  );

create policy "staff create own deletion requests"
  on public.sale_deletion_requests for insert to authenticated
  with check (
    (select public.is_cryo_employee())
    and requested_by = (select auth.uid())
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and exists (
      select 1
      from public.sales sale
      where sale.id = sale_deletion_requests.sale_id
        and sale.archived_at is null
        and (
          sale.created_by = (select auth.uid())
          or exists (
            select 1 from public.staff employee
            where employee.id = sale.staff_id
              and employee.active
              and employee.user_id = (select auth.uid())
          )
        )
    )
  );

create policy "admins review deletion requests"
  on public.sale_deletion_requests for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

grant select, insert, update on public.sale_deletion_requests to authenticated;
grant select, insert, update, delete on public.sale_deletion_requests to service_role;
grant usage, select on sequence public.sale_deletion_requests_id_seq to authenticated, service_role;

create or replace function private.protect_sales_archive()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_admin() and new.archived_at is distinct from old.archived_at then
    raise exception 'Борлуулалт устгахын тулд админы зөвшөөрөл шаардлагатай.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_sales_archive_trigger on public.sales;
create trigger protect_sales_archive_trigger
before update of archived_at on public.sales
for each row execute function private.protect_sales_archive();

create or replace function private.review_sale_deletion_request()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.sale_id is distinct from new.sale_id
     or old.requested_by is distinct from new.requested_by
     or old.reason is distinct from new.reason
     or old.created_at is distinct from new.created_at then
    raise exception 'Устгах хүсэлтийн үндсэн мэдээллийг өөрчлөх боломжгүй.'
      using errcode = '42501';
  end if;

  if old.status <> 'pending' then
    raise exception 'Шийдвэрлэсэн хүсэлтийг дахин өөрчлөх боломжгүй.'
      using errcode = '23514';
  end if;

  if new.status not in ('approved', 'rejected') then
    raise exception 'Хүсэлтийг зөвшөөрөх эсвэл татгалзах шаардлагатай.'
      using errcode = '23514';
  end if;

  if not public.is_admin() then
    raise exception 'Зөвхөн админ хүсэлтийг шийдвэрлэнэ.'
      using errcode = '42501';
  end if;

  new.reviewed_by := auth.uid();
  new.reviewed_at := now();

  if new.status = 'approved' then
    update public.sales
       set archived_at = now()
     where id = new.sale_id
       and archived_at is null;
    if not found then
      raise exception 'Борлуулалт олдсонгүй эсвэл өмнө нь устгагдсан байна.'
        using errcode = 'P0002';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists review_sale_deletion_request_trigger on public.sale_deletion_requests;
create trigger review_sale_deletion_request_trigger
before update on public.sale_deletion_requests
for each row execute function private.review_sale_deletion_request();

revoke all on function private.protect_sales_archive() from public, anon, authenticated;
revoke all on function private.review_sale_deletion_request() from public, anon, authenticated;

comment on table public.sale_deletion_requests is
  'Audited staff requests to soft-delete sales after administrator approval.';
