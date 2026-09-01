-- CRYO Mongolia employee ERP
-- Initial schema: staff access, customers, packages, visits, sales, operations,
-- staged imports, immutable audit history, explicit grants, and RLS.

set lock_timeout = '5s';
set statement_timeout = '60s';

-- This baseline is intentionally valid only for a fresh, dedicated Cryo ERP project.
-- Fail before changing privileges if an unrelated application already owns public objects.
do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'S')
  ) or exists (
    select 1
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public'
  ) then
    raise exception using errcode = '55000', message = 'DEDICATED_EMPTY_PROJECT_REQUIRED';
  end if;
end;
$$;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create extension if not exists pg_trgm with schema extensions;

-- New database objects are private until this migration explicitly grants access.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.touch_updated_at() from public, anon, authenticated, service_role;

create table public.staff_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  phone text,
  role text not null default 'viewer'
    check (role in ('owner', 'admin', 'manager', 'reception', 'therapist', 'accountant', 'auditor', 'viewer')),
  status text not null default 'invited'
    check (status in ('invited', 'active', 'suspended')),
  last_seen_at timestamptz,
  invited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(email) between 3 and 320),
  check (char_length(full_name) <= 160)
);

create unique index staff_profiles_email_key on public.staff_profiles (lower(email));
create index staff_profiles_active_role_idx on public.staff_profiles (role, id) where status = 'active';

create trigger staff_profiles_touch_updated_at
before update on public.staff_profiles
for each row execute function private.touch_updated_at();

create table public.staff_invites (
  id bigint generated always as identity primary key,
  email text not null,
  full_name text not null,
  intended_role text not null
    check (intended_role in ('owner', 'admin', 'manager', 'reception', 'therapist', 'accountant', 'auditor', 'viewer')),
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'linked', 'accepted', 'failed', 'expired')),
  invited_by uuid not null references auth.users(id),
  last_action_by uuid not null references auth.users(id),
  auth_user_id uuid unique references auth.users(id),
  processing_token uuid,
  processing_started_at timestamptz,
  expires_at timestamptz not null default (now() + interval '1 hour'),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(email) between 3 and 320),
  check (char_length(btrim(full_name)) between 2 and 160),
  check (error_code is null or char_length(error_code) <= 80),
  check ((processing_token is null) = (processing_started_at is null))
);

create unique index staff_invites_email_key on public.staff_invites (lower(email));

create unique index staff_invites_processing_token_key
on public.staff_invites (processing_token)
where processing_token is not null;

create index staff_invites_status_created_idx on public.staff_invites (status, created_at desc, id desc);

create trigger staff_invites_touch_updated_at
before update on public.staff_invites
for each row execute function private.touch_updated_at();

create table public.staff_access_changes (
  id bigint generated always as identity primary key,
  target_user_id uuid not null references public.staff_profiles(id),
  previous_role text not null,
  previous_status text not null,
  new_role text not null,
  new_status text not null,
  reason text not null,
  changed_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (char_length(btrim(reason)) between 3 and 1000)
);

create index staff_access_changes_target_date_idx
on public.staff_access_changes (target_user_id, created_at desc, id desc);

create index staff_access_changes_actor_date_idx
on public.staff_access_changes (changed_by, created_at desc, id desc);

create or replace function private.bootstrap_first_owner(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_role text;
  previous_status text;
  confirmed_at timestamptz;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'INVALID_BOOTSTRAP_USER';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cryo_staff_owner_guard', 0)
  );

  if exists (
    select 1
    from public.staff_profiles as sp
    where sp.status = 'active' and sp.role in ('owner', 'admin')
  ) then
    raise exception using errcode = '55000', message = 'BOOTSTRAP_ALREADY_COMPLETED';
  end if;

  select au.email_confirmed_at into confirmed_at
  from auth.users as au
  where au.id = p_user_id
  for update;

  if not found or confirmed_at is null then
    raise exception using errcode = '22023', message = 'BOOTSTRAP_EMAIL_NOT_CONFIRMED';
  end if;

  select sp.role, sp.status into previous_role, previous_status
  from public.staff_profiles as sp
  where sp.id = p_user_id
    and sp.role = 'viewer'
    and sp.status = 'invited'
  for update;

  if not found then
    raise exception using errcode = '55000', message = 'BOOTSTRAP_PROFILE_NOT_ELIGIBLE';
  end if;

  update public.staff_profiles as sp
  set role = 'owner',
      status = 'active',
      invited_by = p_user_id,
      updated_at = now()
  where sp.id = p_user_id;

  insert into public.staff_access_changes (
    target_user_id, previous_role, previous_status,
    new_role, new_status, reason, changed_by
  ) values (
    p_user_id, previous_role, previous_status,
    'owner', 'active', 'INITIAL_OWNER_BOOTSTRAP', p_user_id
  );
end;
$$;

revoke all on function private.bootstrap_first_owner(uuid) from public, anon, authenticated, service_role;

create table private.staff_invite_attempts (
  id bigint generated always as identity primary key,
  invite_id bigint not null references public.staff_invites(id),
  idempotency_key uuid not null,
  attempt_token uuid not null unique,
  invited_by uuid not null references auth.users(id),
  attempted_at timestamptz not null default now()
);

create index staff_invite_attempts_actor_date_idx
on private.staff_invite_attempts (invited_by, attempted_at desc, id desc);

create table private.staff_invite_requests (
  idempotency_key uuid primary key,
  invite_id bigint not null references public.staff_invites(id),
  email text not null,
  full_name text not null,
  intended_role text not null
    check (intended_role in ('owner', 'admin', 'manager', 'reception', 'therapist', 'accountant', 'auditor', 'viewer')),
  invited_by uuid not null references auth.users(id),
  retired_at timestamptz,
  retired_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (char_length(email) between 3 and 320),
  check (char_length(btrim(full_name)) between 2 and 160),
  check ((retired_at is null) = (retired_by is null))
);

create index staff_invite_requests_invite_created_idx
on private.staff_invite_requests (invite_id, created_at desc);

create or replace function public.reserve_staff_invite(
  p_idempotency_key uuid,
  p_attempt_token uuid,
  p_email text,
  p_full_name text,
  p_intended_role text,
  p_invited_by uuid
)
returns table (
  invite_id bigint,
  invite_status text,
  auth_user_id uuid,
  reservation_token uuid,
  should_send boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  inviter_role text;
  normalized_email text;
  selected_invite public.staff_invites%rowtype;
  selected_request private.staff_invite_requests%rowtype;
  request_found boolean := false;
  invite_found boolean := false;
  recent_attempt_count bigint;
  hourly_attempt_count bigint;
begin
  normalized_email := lower(btrim(coalesce(p_email, '')));

  if p_idempotency_key is null
     or p_attempt_token is null
     or p_invited_by is null
     or char_length(normalized_email) < 3
     or char_length(normalized_email) > 320
     or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
     or p_full_name is null
     or char_length(btrim(p_full_name)) < 2
     or char_length(p_full_name) > 160
     or p_intended_role is null
     or p_intended_role not in ('owner', 'admin', 'manager', 'reception', 'therapist', 'accountant', 'auditor', 'viewer') then
    raise exception using errcode = '22023', message = 'INVALID_INVITE';
  end if;

  -- Serialize with access changes before authorizing the inviter, so a caller
  -- that was suspended while waiting cannot continue with a stale role.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cryo_staff_owner_guard', 0)
  );

  select sp.role into inviter_role
  from public.staff_profiles as sp
  where sp.id = p_invited_by and sp.status = 'active';

  if inviter_role is null or inviter_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'NOT_AUTHORIZED';
  end if;

  if inviter_role <> 'owner' and p_intended_role in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED';
  end if;

  -- Serialize both the inviter's rate window and this email's open invitation state.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cryo_inviter:' || p_invited_by::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cryo_invite_email:' || normalized_email, 0)
  );

  update public.staff_invites as si
  set status = 'expired',
      processing_token = null,
      processing_started_at = null,
      last_action_by = p_invited_by,
      updated_at = now()
  where lower(si.email) = normalized_email
    and si.status in ('pending', 'sending', 'sent', 'linked')
    and si.expires_at <= now();

  select sir.* into selected_request
  from private.staff_invite_requests as sir
  where sir.idempotency_key = p_idempotency_key
  for update;
  request_found := found;

  if request_found then
    if selected_request.retired_at is not null then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_RETIRED';
    end if;
    if lower(selected_request.email) <> normalized_email
       or selected_request.full_name <> btrim(p_full_name)
       or selected_request.intended_role <> p_intended_role
       or selected_request.invited_by <> p_invited_by then
      raise exception using errcode = '23505', message = 'IDEMPOTENCY_CONFLICT';
    end if;

    select si.* into selected_invite
    from public.staff_invites as si
    where si.id = selected_request.invite_id
    for update;
    invite_found := found;
    if not invite_found then
      raise exception using errcode = '55000', message = 'INVITE_STATE_FAILED';
    end if;

    if selected_invite.status in ('sent', 'linked', 'accepted') then
      return query select selected_invite.id, selected_invite.status,
        selected_invite.auth_user_id, null::uuid, false;
      return;
    end if;

    if selected_invite.status = 'sending'
       and selected_invite.processing_started_at > now() - interval '5 minutes' then
      return query select selected_invite.id, selected_invite.status,
        selected_invite.auth_user_id, null::uuid, false;
      return;
    end if;
  else
    select si.* into selected_invite
    from public.staff_invites as si
    where lower(si.email) = normalized_email
    for update;
    invite_found := found;

    if invite_found
       and selected_invite.status = 'sending'
       and selected_invite.processing_started_at > now() - interval '5 minutes' then
      raise exception using errcode = '55000', message = 'INVITE_IN_PROGRESS';
    end if;
    if invite_found and selected_invite.status in ('pending', 'sent', 'linked') then
      raise exception using errcode = '23505', message = 'INVITE_ALREADY_PENDING';
    end if;
    if invite_found and selected_invite.status = 'accepted' then
      raise exception using errcode = '23505', message = 'STAFF_ALREADY_EXISTS';
    end if;
  end if;

  select count(*) into recent_attempt_count
  from private.staff_invite_attempts as sia
  where sia.invited_by = p_invited_by
    and sia.attempted_at >= now() - interval '10 minutes';

  if recent_attempt_count >= 5 then
    raise exception using errcode = 'P0001', message = 'RATE_LIMITED';
  end if;

  select count(*) into hourly_attempt_count
  from private.staff_invite_attempts as sia
  where sia.invited_by = p_invited_by
    and sia.attempted_at >= now() - interval '1 hour';

  if hourly_attempt_count >= 10 then
    raise exception using errcode = 'P0001', message = 'RATE_LIMITED';
  end if;

  if not invite_found then
    insert into public.staff_invites (
      email, full_name, intended_role, status, invited_by, last_action_by,
      processing_token, processing_started_at, expires_at
    ) values (
      normalized_email, btrim(p_full_name), p_intended_role,
      'sending', p_invited_by, p_invited_by,
      p_attempt_token, now(), now() + interval '1 hour'
    )
    returning * into selected_invite;
  else
    update private.staff_invite_requests as sir
    set retired_at = now(),
        retired_by = p_invited_by
    where sir.invite_id = selected_invite.id
      and sir.idempotency_key <> p_idempotency_key
      and sir.retired_at is null;

    update public.staff_invites as si
    set email = normalized_email,
        full_name = btrim(p_full_name),
        intended_role = p_intended_role,
        invited_by = p_invited_by,
        last_action_by = p_invited_by,
        status = 'sending',
        processing_token = p_attempt_token,
        processing_started_at = now(),
        expires_at = now() + interval '1 hour',
        error_code = null,
        updated_at = now()
    where si.id = selected_invite.id
    returning * into selected_invite;
  end if;

  if not request_found then
    insert into private.staff_invite_requests (
      idempotency_key, invite_id, email, full_name, intended_role, invited_by
    ) values (
      p_idempotency_key, selected_invite.id, normalized_email,
      btrim(p_full_name), p_intended_role, p_invited_by
    );
  end if;

  insert into private.staff_invite_attempts (invite_id, idempotency_key, attempt_token, invited_by)
  values (selected_invite.id, p_idempotency_key, p_attempt_token, p_invited_by);

  return query select selected_invite.id, selected_invite.status,
    selected_invite.auth_user_id, p_attempt_token, true;
end;
$$;

create or replace function public.finalize_staff_invite(
  p_invite_id bigint,
  p_auth_user_id uuid,
  p_attempt_token uuid,
  p_email_confirmed boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_invite public.staff_invites%rowtype;
  reconciled_profile_id uuid;
begin
  if p_invite_id is null or p_auth_user_id is null or p_attempt_token is null then
    raise exception using errcode = '22023', message = 'INVALID_INVITE_FINALIZATION';
  end if;

  update public.staff_invites as si
  set auth_user_id = p_auth_user_id,
      status = case
        when si.status = 'accepted' or p_email_confirmed then 'accepted'
        else 'linked'
      end,
      error_code = null,
      last_action_by = si.invited_by,
      processing_token = null,
      processing_started_at = null,
      updated_at = now()
  where si.id = p_invite_id
    and si.status in ('sending', 'sent', 'linked', 'accepted')
    and si.processing_token = p_attempt_token
    and (si.auth_user_id is null or si.auth_user_id = p_auth_user_id)
  returning si.* into selected_invite;

  if selected_invite.id is null then
    raise exception using errcode = '55000', message = 'INVITE_RECONCILIATION_REQUIRED';
  end if;

  update public.staff_profiles as sp
  set email = selected_invite.email,
      full_name = selected_invite.full_name,
      role = selected_invite.intended_role,
      invited_by = selected_invite.invited_by,
      updated_at = now()
  where sp.id = p_auth_user_id
    and sp.status = 'invited'
  returning sp.id into reconciled_profile_id;

  if reconciled_profile_id is null then
    raise exception using errcode = '55000', message = 'INVITE_RECONCILIATION_REQUIRED';
  end if;

  return selected_invite.status;
end;
$$;

create or replace function public.fail_staff_invite(
  p_invite_id bigint,
  p_attempt_token uuid,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_invite_id is null
     or p_attempt_token is null
     or p_error_code is null
     or char_length(p_error_code) < 3
     or char_length(p_error_code) > 80 then
    raise exception using errcode = '22023', message = 'INVALID_INVITE_FAILURE';
  end if;

  update public.staff_invites as si
  set status = 'failed',
      error_code = p_error_code,
      last_action_by = si.invited_by,
      processing_token = null,
      processing_started_at = null,
      updated_at = now()
  where si.id = p_invite_id
    and si.status = 'sending'
    and si.processing_token = p_attempt_token;

  return found;
end;
$$;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pending_invite_id bigint;
  pending_role text;
  pending_invited_by uuid;
begin
  select si.id, si.intended_role, si.invited_by
    into pending_invite_id, pending_role, pending_invited_by
  from public.staff_invites as si
  where lower(si.email) = lower(coalesce(new.email, ''))
    and (
      si.status in ('pending', 'sending', 'sent')
      or (
        si.status = 'failed'
        and si.error_code = 'AUTH_PROVIDER_FAILED'
      )
    )
    and si.expires_at > now()
  order by si.created_at desc, si.id desc
  limit 1
  for update;

  insert into public.staff_profiles (id, email, full_name, role, status, invited_by)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 160),
    coalesce(pending_role, 'viewer'),
    'invited',
    pending_invited_by
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = case
        when public.staff_profiles.full_name = '' then excluded.full_name
        else public.staff_profiles.full_name
      end,
      updated_at = now();

  if pending_invite_id is not null then
    update public.staff_invites
    set auth_user_id = new.id,
        status = 'linked',
        last_action_by = invited_by,
        error_code = null,
        updated_at = now()
    where id = pending_invite_id;
  end if;

  return new;
end;
$$;

revoke all on function private.handle_new_auth_user() from public, anon, authenticated, service_role;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

create or replace function private.handle_auth_user_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  confirmed_invite public.staff_invites%rowtype;
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    -- Keep the same invite -> profile lock order as finalize_staff_invite so
    -- confirmation and Edge finalization cannot deadlock each other.
    update public.staff_invites as si
    set status = 'accepted',
        last_action_by = new.id,
        updated_at = now()
    where si.auth_user_id = new.id
      and si.status in ('sending', 'sent', 'linked')
    returning si.* into confirmed_invite;
  end if;

  update public.staff_profiles as sp
  set email = coalesce(new.email, sp.email),
      full_name = case
        when confirmed_invite.id is not null and sp.status = 'invited'
          then confirmed_invite.full_name
        else sp.full_name
      end,
      role = case
        when confirmed_invite.id is not null and sp.status = 'invited'
          then confirmed_invite.intended_role
        else sp.role
      end,
      invited_by = case
        when confirmed_invite.id is not null and sp.status = 'invited'
          then confirmed_invite.invited_by
        else sp.invited_by
      end,
      updated_at = now()
  where sp.id = new.id;

  return new;
end;
$$;

revoke all on function private.handle_auth_user_confirmed() from public, anon, authenticated, service_role;

create trigger on_auth_user_confirmed
after update of email, email_confirmed_at on auth.users
for each row execute function private.handle_auth_user_confirmed();

create or replace function private.current_staff_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select sp.role
  from public.staff_profiles as sp
  where sp.id = (select auth.uid())
    and sp.status = 'active'
  limit 1
$$;

create or replace function private.has_staff_role(allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select private.current_staff_role()) = any(allowed_roles), false)
$$;

revoke all on function private.current_staff_role() from public, anon, authenticated, service_role;
revoke all on function private.has_staff_role(text[]) from public, anon, authenticated, service_role;

-- RLS policies explicitly call only these two helpers. The private schema is not exposed
-- through the Data API, and no authenticated role receives access to its staging tables.
grant usage on schema private to authenticated;
grant execute on function private.current_staff_role() to authenticated;
grant execute on function private.has_staff_role(text[]) to authenticated;

create table public.customers (
  id bigint generated always as identity primary key,
  full_name text not null,
  phone text,
  phone_normalized text generated always as (
    case
      when left(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 3) = '976'
        and length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) = 11
      then right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 8)
      else regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')
    end
  ) stored,
  email text,
  birth_date date,
  gender text check (gender is null or gender in ('female', 'male', 'other', 'unspecified')),
  notes text,
  consent_recorded_at timestamptz,
  source text not null default 'manual',
  archived_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_document tsvector generated always as (
    to_tsvector('simple', coalesce(full_name, '') || ' ' || coalesce(phone_normalized, '') || ' ' || coalesce(email, ''))
  ) stored,
  check (char_length(btrim(full_name)) between 2 and 160),
  check (phone is null or char_length(phone) <= 40),
  check (email is null or char_length(email) <= 320),
  check (notes is null or char_length(notes) <= 4000)
);

create index customers_search_document_idx on public.customers using gin (search_document);
create index customers_name_trgm_idx on public.customers using gin (lower(full_name) extensions.gin_trgm_ops);
create index customers_phone_idx on public.customers (phone_normalized text_pattern_ops) where archived_at is null;
create index customers_updated_idx on public.customers (updated_at desc, id desc) where archived_at is null;

create or replace function private.set_customer_updated_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

revoke all on function private.set_customer_updated_by() from public, anon, authenticated, service_role;

create trigger customers_touch_updated_at
before update on public.customers
for each row execute function private.touch_updated_at();

create trigger customers_set_updated_by
before update on public.customers
for each row execute function private.set_customer_updated_by();

create table public.customer_contacts (
  id bigint generated always as identity primary key,
  customer_id bigint not null references public.customers(id),
  contact_type text not null check (contact_type in ('phone', 'email', 'social', 'other')),
  label text,
  value text not null,
  normalized_value text,
  is_primary boolean not null default false,
  archived_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(value) between 1 and 320),
  check (label is null or char_length(label) <= 80)
);

create index customer_contacts_customer_idx on public.customer_contacts (customer_id, id) where archived_at is null;
create index customer_contacts_normalized_idx on public.customer_contacts (normalized_value) where archived_at is null;

create trigger customer_contacts_touch_updated_at
before update on public.customer_contacts
for each row execute function private.touch_updated_at();

create table public.services (
  id bigint generated always as identity primary key,
  code text not null,
  name text not null,
  category text not null default 'other',
  duration_minutes integer check (duration_minutes is null or duration_minutes between 1 and 1440),
  default_price numeric(14,2) check (default_price is null or default_price >= 0),
  is_active boolean not null default true,
  notes text,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  check (char_length(btrim(name)) between 2 and 160)
);

create unique index services_code_key on public.services (lower(code));
create unique index services_active_name_key on public.services (lower(name)) where is_active;
create index services_active_category_idx on public.services (category, name) where is_active;

create trigger services_touch_updated_at
before update on public.services
for each row execute function private.touch_updated_at();

create table public.service_aliases (
  id bigint generated always as identity primary key,
  service_id bigint not null references public.services(id),
  alias text not null,
  source text not null default 'legacy_excel',
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  check (char_length(btrim(alias)) between 1 and 200)
);

create unique index service_aliases_source_alias_key on public.service_aliases (source, lower(alias));
create index service_aliases_service_idx on public.service_aliases (service_id);

create table public.package_templates (
  id bigint generated always as identity primary key,
  code text not null,
  name text not null,
  description text,
  validity_days integer check (validity_days is null or validity_days between 1 and 3650),
  list_price numeric(14,2) check (list_price is null or list_price >= 0),
  is_active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  check (char_length(btrim(name)) between 2 and 160)
);

create unique index package_templates_code_key on public.package_templates (lower(code));
create index package_templates_active_name_idx on public.package_templates (name) where is_active;

create trigger package_templates_touch_updated_at
before update on public.package_templates
for each row execute function private.touch_updated_at();

create table public.package_template_items (
  id bigint generated always as identity primary key,
  package_template_id bigint not null references public.package_templates(id),
  service_id bigint not null references public.services(id),
  quantity integer not null check (quantity > 0 and quantity <= 10000),
  created_at timestamptz not null default now(),
  unique (package_template_id, service_id)
);

create index package_template_items_service_idx on public.package_template_items (service_id);

create table public.import_batches (
  id bigint generated always as identity primary key,
  source_filename text not null,
  source_sha256 text not null,
  sheet_count integer check (sheet_count is null or sheet_count >= 0),
  status text not null default 'uploaded'
    check (status in ('uploaded', 'parsed', 'needs_review', 'approved', 'applying', 'applied', 'rejected', 'failed')),
  source_row_count integer not null default 0 check (source_row_count >= 0),
  valid_row_count integer not null default 0 check (valid_row_count >= 0),
  issue_count integer not null default 0 check (issue_count >= 0),
  applied_row_count integer not null default 0 check (applied_row_count >= 0),
  reconciliation jsonb not null default '{}'::jsonb,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_sha256),
  check (source_sha256 ~ '^[0-9a-f]{64}$'),
  check (char_length(source_filename) between 1 and 255),
  check (status not in ('approved', 'applying', 'applied') or (approved_by is not null and approved_at is not null))
);

create index import_batches_status_created_idx on public.import_batches (status, created_at desc);

create trigger import_batches_touch_updated_at
before update on public.import_batches
for each row execute function private.touch_updated_at();

create table private.import_rows (
  id bigint generated always as identity primary key,
  batch_id bigint not null references public.import_batches(id),
  sheet_index integer not null check (sheet_index >= 0),
  sheet_name text not null,
  source_row integer not null check (source_row >= 1),
  source_cell text,
  source_key text not null,
  row_kind text not null default 'unclassified',
  raw_data jsonb not null,
  normalized_data jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'valid', 'issue', 'duplicate_candidate', 'approved', 'applied', 'skipped')),
  target_table text,
  target_id text,
  created_at timestamptz not null default now(),
  unique (batch_id, source_key)
);

create index import_rows_batch_status_idx on private.import_rows (batch_id, status, id);

create table private.import_issues (
  id bigint generated always as identity primary key,
  batch_id bigint not null references public.import_batches(id),
  import_row_id bigint references private.import_rows(id),
  issue_code text not null,
  severity text not null check (severity in ('warning', 'error', 'blocking')),
  field_name text,
  message text not null,
  resolution text,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check ((resolved_by is null) = (resolved_at is null)),
  check (resolved_at is null or resolution is not null)
);

create index import_issues_batch_severity_idx on private.import_issues (batch_id, severity, resolved_at);

create table private.identity_resolution (
  id bigint generated always as identity primary key,
  batch_id bigint not null references public.import_batches(id),
  entity_type text not null,
  candidate_key text not null,
  proposed_target_id text,
  decision text not null default 'pending'
    check (decision in ('pending', 'match', 'create', 'ignore')),
  evidence jsonb not null default '{}'::jsonb,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (batch_id, entity_type, candidate_key),
  check (
    (decision = 'pending' and decided_by is null and decided_at is null)
    or (decision <> 'pending' and decided_by is not null and decided_at is not null)
  )
);

create table public.customer_packages (
  id bigint generated always as identity primary key,
  customer_id bigint not null references public.customers(id),
  package_template_id bigint references public.package_templates(id),
  name text not null,
  status text not null default 'active'
    check (status in ('draft', 'active', 'completed', 'expired', 'cancelled')),
  purchased_at timestamptz,
  starts_on date not null default ((now() at time zone 'Asia/Ulaanbaatar')::date),
  expires_on date,
  price numeric(14,2) check (price is null or price >= 0),
  notes text,
  source_batch_id bigint references public.import_batches(id),
  source_ref text,
  archived_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_on is null or expires_on >= starts_on),
  check (char_length(btrim(name)) between 2 and 160),
  check (notes is null or char_length(notes) <= 4000),
  unique (source_batch_id, source_ref)
);

create index customer_packages_customer_status_idx on public.customer_packages (customer_id, status, expires_on, id) where archived_at is null;
create index customer_packages_expiry_idx on public.customer_packages (expires_on, id) where status = 'active' and archived_at is null;
create index customer_packages_template_idx on public.customer_packages (package_template_id);

create trigger customer_packages_touch_updated_at
before update on public.customer_packages
for each row execute function private.touch_updated_at();

create table public.customer_entitlements (
  id bigint generated always as identity primary key,
  customer_package_id bigint not null references public.customer_packages(id),
  service_id bigint not null references public.services(id),
  total_quantity integer not null check (total_quantity > 0 and total_quantity <= 10000),
  used_quantity integer not null default 0 check (used_quantity >= 0),
  remaining_quantity integer generated always as (total_quantity - used_quantity) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_package_id, service_id),
  check (used_quantity <= total_quantity)
);

create index customer_entitlements_service_idx on public.customer_entitlements (service_id);
create index customer_entitlements_remaining_idx on public.customer_entitlements (customer_package_id, remaining_quantity) where remaining_quantity > 0;

create trigger customer_entitlements_touch_updated_at
before update on public.customer_entitlements
for each row execute function private.touch_updated_at();

create table public.entitlement_adjustments (
  id bigint generated always as identity primary key,
  entitlement_id bigint not null references public.customer_entitlements(id),
  previous_total integer not null,
  previous_used integer not null,
  new_total integer not null,
  new_used integer not null,
  reason text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (new_total > 0),
  check (new_used between 0 and new_total),
  check (char_length(btrim(reason)) between 3 and 1000)
);

create index entitlement_adjustments_entitlement_idx on public.entitlement_adjustments (entitlement_id, created_at desc);

create table public.appointments (
  id bigint generated always as identity primary key,
  customer_id bigint not null references public.customers(id),
  service_id bigint references public.services(id),
  assigned_staff_id uuid references public.staff_profiles(id),
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'booked'
    check (status in ('booked', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show')),
  source text not null default 'erp',
  notes text,
  archived_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  check (notes is null or char_length(notes) <= 4000)
);

create index appointments_start_status_idx on public.appointments (starts_at, status, id) where archived_at is null;
create index appointments_customer_idx on public.appointments (customer_id, starts_at desc);
create index appointments_staff_idx on public.appointments (assigned_staff_id, starts_at) where archived_at is null;
create index appointments_service_idx on public.appointments (service_id);

create trigger appointments_touch_updated_at
before update on public.appointments
for each row execute function private.touch_updated_at();

create table public.visits (
  id bigint generated always as identity primary key,
  customer_id bigint not null references public.customers(id),
  appointment_id bigint references public.appointments(id),
  visited_at timestamptz not null default now(),
  status text not null default 'completed'
    check (status in ('planned', 'in_progress', 'completed', 'cancelled', 'corrected')),
  notes text,
  source_batch_id bigint references public.import_batches(id),
  source_ref text,
  archived_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (notes is null or char_length(notes) <= 4000),
  unique (source_batch_id, source_ref)
);

create index visits_customer_date_idx on public.visits (customer_id, visited_at desc, id desc) where archived_at is null;
create index visits_date_status_idx on public.visits (visited_at desc, status, id) where archived_at is null;
create index visits_appointment_idx on public.visits (appointment_id);

create trigger visits_touch_updated_at
before update on public.visits
for each row execute function private.touch_updated_at();

create table public.visit_services (
  id bigint generated always as identity primary key,
  visit_id bigint not null references public.visits(id),
  service_id bigint not null references public.services(id),
  entitlement_id bigint references public.customer_entitlements(id),
  quantity integer not null default 1 check (quantity > 0 and quantity <= 1000),
  unit_price numeric(14,2) check (unit_price is null or unit_price >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  final_amount numeric(14,2) check (final_amount is null or final_amount >= 0),
  performed_by uuid references public.staff_profiles(id),
  created_at timestamptz not null default now()
);

create index visit_services_visit_idx on public.visit_services (visit_id);
create index visit_services_service_idx on public.visit_services (service_id, visit_id);
create index visit_services_entitlement_idx on public.visit_services (entitlement_id) where entitlement_id is not null;
create index visit_services_staff_idx on public.visit_services (performed_by, visit_id) where performed_by is not null;

create table public.sales (
  id bigint generated always as identity primary key,
  customer_id bigint references public.customers(id),
  sold_at timestamptz not null default now(),
  status text not null default 'completed'
    check (status in ('draft', 'completed', 'partially_refunded', 'refunded', 'voided', 'corrected')),
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  notes text,
  source_batch_id bigint references public.import_batches(id),
  source_ref text,
  archived_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (discount_amount <= subtotal),
  check (total_amount = subtotal - discount_amount),
  check (notes is null or char_length(notes) <= 4000),
  unique (source_batch_id, source_ref)
);

create index sales_date_status_idx on public.sales (sold_at desc, status, id) where archived_at is null;
create index sales_customer_date_idx on public.sales (customer_id, sold_at desc) where customer_id is not null and archived_at is null;

create trigger sales_touch_updated_at
before update on public.sales
for each row execute function private.touch_updated_at();

create table public.sale_items (
  id bigint generated always as identity primary key,
  sale_id bigint not null references public.sales(id),
  item_type text not null check (item_type in ('service', 'package', 'product', 'gift_card', 'other')),
  service_id bigint references public.services(id),
  package_template_id bigint references public.package_templates(id),
  customer_package_id bigint references public.customer_packages(id),
  description text not null,
  quantity numeric(12,2) not null default 1 check (quantity > 0),
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  check (char_length(btrim(description)) between 1 and 500)
);

create index sale_items_sale_idx on public.sale_items (sale_id);
create index sale_items_service_idx on public.sale_items (service_id) where service_id is not null;
create index sale_items_package_template_idx on public.sale_items (package_template_id) where package_template_id is not null;
create index sale_items_customer_package_idx on public.sale_items (customer_package_id) where customer_package_id is not null;

create table public.payments (
  id bigint generated always as identity primary key,
  sale_id bigint not null references public.sales(id),
  paid_at timestamptz not null default now(),
  payment_type text not null default 'charge' check (payment_type in ('charge', 'refund', 'adjustment')),
  method text not null
    check (method in ('golomt', 'khan', 'cash', 'invoice', 'barter', 'qpay', 'bank_transfer', 'other')),
  amount numeric(14,2) not null check (amount > 0),
  external_reference text,
  notes text,
  source_batch_id bigint references public.import_batches(id),
  source_ref text,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  check (notes is null or char_length(notes) <= 2000),
  unique (source_batch_id, source_ref)
);

create index payments_sale_date_idx on public.payments (sale_id, paid_at, id);
create index payments_date_method_idx on public.payments (paid_at desc, method, id);
create unique index payments_external_reference_key on public.payments (external_reference) where external_reference is not null;

create table public.expenses (
  id bigint generated always as identity primary key,
  spent_at timestamptz not null,
  category text not null,
  vendor text,
  description text not null,
  method text check (method is null or method in ('golomt', 'khan', 'cash', 'invoice', 'barter', 'bank_transfer', 'other')),
  amount numeric(14,2) not null check (amount >= 0),
  status text not null default 'recorded' check (status in ('draft', 'recorded', 'reversed', 'corrected')),
  source_batch_id bigint references public.import_batches(id),
  source_ref text,
  archived_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(btrim(description)) between 1 and 1000),
  unique (source_batch_id, source_ref)
);

create index expenses_date_category_idx on public.expenses (spent_at desc, category, id) where archived_at is null;

create trigger expenses_touch_updated_at
before update on public.expenses
for each row execute function private.touch_updated_at();

create table public.inventory_items (
  id bigint generated always as identity primary key,
  code text not null,
  name text not null,
  unit text not null,
  current_quantity numeric(14,3) not null default 0 check (current_quantity >= 0),
  reorder_level numeric(14,3) check (reorder_level is null or reorder_level >= 0),
  is_active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  check (char_length(btrim(name)) between 2 and 160),
  check (char_length(btrim(unit)) between 1 and 40)
);

create unique index inventory_items_code_key on public.inventory_items (lower(code));
create index inventory_items_active_name_idx on public.inventory_items (name) where is_active;

create trigger inventory_items_touch_updated_at
before update on public.inventory_items
for each row execute function private.touch_updated_at();

create or replace function private.initialize_inventory_item()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.current_quantity := 0;
  return new;
end;
$$;

revoke all on function private.initialize_inventory_item() from public, anon, authenticated, service_role;

create trigger inventory_items_initialize_quantity
before insert on public.inventory_items
for each row execute function private.initialize_inventory_item();

create table public.inventory_movements (
  id bigint generated always as identity primary key,
  inventory_item_id bigint not null references public.inventory_items(id),
  moved_at timestamptz not null default now(),
  movement_type text not null check (movement_type in ('opening', 'receipt', 'usage', 'adjustment', 'reversal')),
  quantity_change numeric(14,3) not null check (quantity_change <> 0),
  reason text not null,
  visit_id bigint references public.visits(id),
  reverses_movement_id bigint unique references public.inventory_movements(id),
  source_batch_id bigint references public.import_batches(id),
  source_ref text,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  check (char_length(btrim(reason)) between 2 and 1000),
  check (
    (movement_type in ('opening', 'receipt') and quantity_change > 0 and reverses_movement_id is null)
    or (movement_type = 'usage' and quantity_change < 0 and reverses_movement_id is null)
    or (movement_type = 'adjustment' and reverses_movement_id is null)
    or (movement_type = 'reversal' and reverses_movement_id is not null)
  ),
  unique (source_batch_id, source_ref)
);

create index inventory_movements_item_date_idx on public.inventory_movements (inventory_item_id, moved_at desc, id);
create index inventory_movements_visit_idx on public.inventory_movements (visit_id) where visit_id is not null;

create or replace function private.validate_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  original_item_id bigint;
  original_quantity numeric(14,3);
begin
  if new.movement_type = 'reversal' then
    select im.inventory_item_id, im.quantity_change
      into original_item_id, original_quantity
    from public.inventory_movements as im
    where im.id = new.reverses_movement_id
      and im.movement_type <> 'reversal'
    for update;

    if not found
       or original_item_id <> new.inventory_item_id
       or new.quantity_change <> -original_quantity then
      raise exception using errcode = '22023', message = 'INVALID_INVENTORY_REVERSAL';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.validate_inventory_movement() from public, anon, authenticated, service_role;

create trigger inventory_movements_validate
before insert on public.inventory_movements
for each row execute function private.validate_inventory_movement();

create or replace function private.apply_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.inventory_items
  set current_quantity = current_quantity + new.quantity_change,
      updated_at = now()
  where id = new.inventory_item_id
    and current_quantity + new.quantity_change >= 0;

  if not found then
    raise exception using errcode = 'P0001', message = 'INSUFFICIENT_INVENTORY';
  end if;

  return new;
end;
$$;

revoke all on function private.apply_inventory_movement() from public, anon, authenticated, service_role;

create trigger inventory_movements_apply_quantity
after insert on public.inventory_movements
for each row execute function private.apply_inventory_movement();

create table public.staff_shifts (
  id bigint generated always as identity primary key,
  staff_id uuid not null references public.staff_profiles(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'confirmed', 'completed', 'cancelled')),
  notes text,
  source_batch_id bigint references public.import_batches(id),
  source_ref text,
  archived_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (notes is null or char_length(notes) <= 2000),
  unique (source_batch_id, source_ref)
);

create index staff_shifts_staff_start_idx on public.staff_shifts (staff_id, starts_at, id) where archived_at is null;

create trigger staff_shifts_touch_updated_at
before update on public.staff_shifts
for each row execute function private.touch_updated_at();

create table public.attendance_events (
  id bigint generated always as identity primary key,
  staff_id uuid not null references public.staff_profiles(id),
  event_at timestamptz not null,
  event_type text not null check (event_type in ('check_in', 'check_out', 'absence', 'leave', 'correction')),
  notes text,
  source_batch_id bigint references public.import_batches(id),
  source_ref text,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  check (notes is null or char_length(notes) <= 2000),
  unique (source_batch_id, source_ref)
);

create index attendance_events_staff_date_idx on public.attendance_events (staff_id, event_at desc, id);

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  table_name text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_table_record_idx on public.audit_events (table_name, record_id, created_at desc, id desc);
create index audit_events_actor_date_idx on public.audit_events (actor_id, created_at desc, id desc) where actor_id is not null;
create index audit_events_created_idx on public.audit_events (created_at desc, id desc);

create or replace function private.redact_audit_data(row_data jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select row_data
    - array[
      'full_name', 'phone', 'phone_normalized', 'email', 'birth_date', 'gender',
      'notes', 'value', 'normalized_value', 'description', 'external_reference',
      'reason', 'raw_data', 'normalized_data', 'reconciliation', 'idempotency_key',
      'search_document', 'candidate_key', 'evidence', 'message', 'resolution',
      'source_filename', 'source_ref', 'processing_token'
    ]::text[]
$$;

revoke all on function private.redact_audit_data(jsonb) from public, anon, authenticated, service_role;

create or replace function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_row jsonb;
  current_row jsonb;
  row_id text;
  resolved_actor_id uuid;
begin
  if tg_op = 'INSERT' then
    current_row := private.redact_audit_data(to_jsonb(new));
    row_id := current_row ->> 'id';
  elsif tg_op = 'UPDATE' then
    previous_row := private.redact_audit_data(to_jsonb(old));
    current_row := private.redact_audit_data(to_jsonb(new));
    row_id := coalesce(current_row ->> 'id', previous_row ->> 'id');
  else
    previous_row := private.redact_audit_data(to_jsonb(old));
    row_id := previous_row ->> 'id';
  end if;

  resolved_actor_id := (select auth.uid());
  if resolved_actor_id is null then
    resolved_actor_id := coalesce(
      nullif(current_row ->> 'changed_by', '')::uuid,
      nullif(previous_row ->> 'changed_by', '')::uuid,
      nullif(current_row ->> 'last_action_by', '')::uuid,
      nullif(previous_row ->> 'last_action_by', '')::uuid,
      nullif(current_row ->> 'retired_by', '')::uuid,
      nullif(previous_row ->> 'retired_by', '')::uuid,
      nullif(current_row ->> 'resolved_by', '')::uuid,
      nullif(previous_row ->> 'resolved_by', '')::uuid,
      nullif(current_row ->> 'decided_by', '')::uuid,
      nullif(previous_row ->> 'decided_by', '')::uuid,
      nullif(current_row ->> 'approved_by', '')::uuid,
      nullif(previous_row ->> 'approved_by', '')::uuid,
      nullif(current_row ->> 'created_by', '')::uuid,
      nullif(previous_row ->> 'created_by', '')::uuid,
      nullif(current_row ->> 'invited_by', '')::uuid,
      nullif(previous_row ->> 'invited_by', '')::uuid
    );
  end if;

  if resolved_actor_id is null
     and tg_table_schema = 'private'
     and tg_table_name in ('import_rows', 'import_issues', 'identity_resolution') then
    select ib.created_by into resolved_actor_id
    from public.import_batches as ib
    where ib.id = coalesce(
      nullif(current_row ->> 'batch_id', '')::bigint,
      nullif(previous_row ->> 'batch_id', '')::bigint
    );
  end if;

  insert into public.audit_events (actor_id, action, table_name, record_id, old_data, new_data)
  values (resolved_actor_id, tg_op, tg_table_schema || '.' || tg_table_name, row_id, previous_row, current_row);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.audit_row_change() from public, anon, authenticated, service_role;

create trigger audit_staff_profiles after insert or update or delete on public.staff_profiles
for each row execute function private.audit_row_change();
create trigger audit_staff_invites after insert or update or delete on public.staff_invites
for each row execute function private.audit_row_change();
create trigger audit_staff_invite_requests after insert or update or delete on private.staff_invite_requests
for each row execute function private.audit_row_change();
create trigger audit_customers after insert or update or delete on public.customers
for each row execute function private.audit_row_change();
create trigger audit_customer_contacts after insert or update or delete on public.customer_contacts
for each row execute function private.audit_row_change();
create trigger audit_services after insert or update or delete on public.services
for each row execute function private.audit_row_change();
create trigger audit_service_aliases after insert or update or delete on public.service_aliases
for each row execute function private.audit_row_change();
create trigger audit_package_templates after insert or update or delete on public.package_templates
for each row execute function private.audit_row_change();
create trigger audit_package_template_items after insert or update or delete on public.package_template_items
for each row execute function private.audit_row_change();
create trigger audit_import_batches after insert or update or delete on public.import_batches
for each row execute function private.audit_row_change();
create trigger audit_import_rows after insert or update or delete on private.import_rows
for each row execute function private.audit_row_change();
create trigger audit_import_issues after insert or update or delete on private.import_issues
for each row execute function private.audit_row_change();
create trigger audit_identity_resolution after insert or update or delete on private.identity_resolution
for each row execute function private.audit_row_change();
create trigger audit_customer_packages after insert or update or delete on public.customer_packages
for each row execute function private.audit_row_change();
create trigger audit_customer_entitlements after insert or update or delete on public.customer_entitlements
for each row execute function private.audit_row_change();
create trigger audit_entitlement_adjustments after insert or update or delete on public.entitlement_adjustments
for each row execute function private.audit_row_change();
create trigger audit_appointments after insert or update or delete on public.appointments
for each row execute function private.audit_row_change();
create trigger audit_visits after insert or update or delete on public.visits
for each row execute function private.audit_row_change();
create trigger audit_visit_services after insert or update or delete on public.visit_services
for each row execute function private.audit_row_change();
create trigger audit_sales after insert or update or delete on public.sales
for each row execute function private.audit_row_change();
create trigger audit_sale_items after insert or update or delete on public.sale_items
for each row execute function private.audit_row_change();
create trigger audit_payments after insert or update or delete on public.payments
for each row execute function private.audit_row_change();
create trigger audit_expenses after insert or update or delete on public.expenses
for each row execute function private.audit_row_change();
create trigger audit_inventory_items after insert or update or delete on public.inventory_items
for each row execute function private.audit_row_change();
create trigger audit_inventory_movements after insert or update or delete on public.inventory_movements
for each row execute function private.audit_row_change();
create trigger audit_staff_shifts after insert or update or delete on public.staff_shifts
for each row execute function private.audit_row_change();
create trigger audit_attendance_events after insert or update or delete on public.attendance_events
for each row execute function private.audit_row_change();

create or replace function public.search_customers(search_term text, result_limit integer default 30)
returns table (
  id bigint,
  full_name text,
  phone text,
  email text,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, c.full_name, c.phone, c.email, c.updated_at
  from public.customers as c
  where c.archived_at is null
    and char_length(btrim(coalesce(search_term, ''))) >= 2
    and (
      c.search_document @@ websearch_to_tsquery('simple', btrim(search_term))
      or lower(c.full_name) operator(extensions.%) lower(btrim(search_term))
      or c.phone_normalized like '%' || regexp_replace(search_term, '[^0-9]', '', 'g') || '%'
    )
  order by
    case when c.phone_normalized = regexp_replace(search_term, '[^0-9]', '', 'g') then 0 else 1 end,
    extensions.similarity(lower(c.full_name), lower(btrim(search_term))) desc,
    c.updated_at desc,
    c.id desc
  limit least(greatest(coalesce(result_limit, 30), 1), 100)
$$;

create or replace function public.dashboard_metrics()
returns table (
  active_customers bigint,
  today_visits bigint,
  active_packages bigint,
  expiring_packages bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (select count(*) from public.customers c where c.archived_at is null),
    (select count(*) from public.visits v
      where v.archived_at is null
        and v.status = 'completed'
        and v.visited_at >= (((now() at time zone 'Asia/Ulaanbaatar')::date)::timestamp at time zone 'Asia/Ulaanbaatar')
        and v.visited_at < ((((now() at time zone 'Asia/Ulaanbaatar')::date + 1))::timestamp at time zone 'Asia/Ulaanbaatar')),
    (select count(*) from public.customer_packages p where p.archived_at is null and p.status = 'active'),
    (select count(*) from public.customer_packages p
      where p.archived_at is null
        and p.status = 'active'
        and p.expires_on between (now() at time zone 'Asia/Ulaanbaatar')::date
          and (now() at time zone 'Asia/Ulaanbaatar')::date + 14)
$$;

create or replace function public.consume_entitlement(
  entitlement_id bigint,
  quantity integer default 1,
  used_at timestamptz default now(),
  notes text default null
)
returns table (visit_id bigint, remaining_quantity integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text;
  selected_customer_id bigint;
  selected_service_id bigint;
  selected_remaining integer;
  new_visit_id bigint;
begin
  select sp.role into actor_role
  from public.staff_profiles as sp
  where sp.id = actor_id and sp.status = 'active';

  if actor_role is null or actor_role <> all(array['owner', 'admin', 'manager', 'reception', 'therapist']) then
    raise exception using errcode = '42501', message = 'NOT_AUTHORIZED';
  end if;

  if entitlement_id is null or quantity is null or quantity < 1 or quantity > 1000 then
    raise exception using errcode = '22023', message = 'INVALID_QUANTITY';
  end if;

  if notes is not null and char_length(notes) > 4000 then
    raise exception using errcode = '22023', message = 'NOTES_TOO_LONG';
  end if;

  select cp.customer_id, ce.service_id, ce.remaining_quantity
    into selected_customer_id, selected_service_id, selected_remaining
  from public.customer_entitlements as ce
  join public.customer_packages as cp on cp.id = ce.customer_package_id
  where ce.id = entitlement_id
    and cp.archived_at is null
    and cp.status = 'active'
    and cp.starts_on <= (used_at at time zone 'Asia/Ulaanbaatar')::date
    and (cp.expires_on is null or cp.expires_on >= (used_at at time zone 'Asia/Ulaanbaatar')::date)
  for update of ce;

  if not found then
    raise exception using errcode = 'P0002', message = 'ENTITLEMENT_NOT_AVAILABLE';
  end if;

  if selected_remaining < quantity then
    raise exception using errcode = 'P0001', message = 'INSUFFICIENT_ENTITLEMENT';
  end if;

  insert into public.visits (customer_id, visited_at, status, notes, created_by)
  values (selected_customer_id, used_at, 'completed', notes, actor_id)
  returning id into new_visit_id;

  insert into public.visit_services (visit_id, service_id, entitlement_id, quantity, performed_by)
  values (new_visit_id, selected_service_id, entitlement_id, quantity, actor_id);

  update public.customer_entitlements
  set used_quantity = used_quantity + quantity,
      updated_at = now()
  where id = entitlement_id;

  return query
  select new_visit_id, ce.remaining_quantity
  from public.customer_entitlements as ce
  where ce.id = entitlement_id;
end;
$$;

create or replace function public.adjust_entitlement(
  entitlement_id bigint,
  new_total integer,
  new_used integer,
  reason text
)
returns table (total_quantity integer, used_quantity integer, remaining_quantity integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text;
  previous_total integer;
  previous_used integer;
begin
  select sp.role into actor_role
  from public.staff_profiles as sp
  where sp.id = actor_id and sp.status = 'active';

  if actor_role is null or actor_role <> all(array['owner', 'admin', 'manager']) then
    raise exception using errcode = '42501', message = 'NOT_AUTHORIZED';
  end if;

  if entitlement_id is null or new_total is null or new_used is null
     or new_total < 1 or new_total > 10000 or new_used < 0 or new_used > new_total then
    raise exception using errcode = '22023', message = 'INVALID_ENTITLEMENT_VALUES';
  end if;

  if reason is null or char_length(btrim(reason)) < 3 or char_length(reason) > 1000 then
    raise exception using errcode = '22023', message = 'ADJUSTMENT_REASON_REQUIRED';
  end if;

  select ce.total_quantity, ce.used_quantity
    into previous_total, previous_used
  from public.customer_entitlements as ce
  where ce.id = entitlement_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'ENTITLEMENT_NOT_FOUND';
  end if;

  update public.customer_entitlements as ce
  set total_quantity = new_total,
      used_quantity = new_used,
      updated_at = now()
  where ce.id = entitlement_id;

  insert into public.entitlement_adjustments (
    entitlement_id, previous_total, previous_used, new_total, new_used, reason, created_by
  ) values (
    entitlement_id, previous_total, previous_used, new_total, new_used, btrim(reason), actor_id
  );

  return query
  select ce.total_quantity, ce.used_quantity, ce.remaining_quantity
  from public.customer_entitlements as ce
  where ce.id = entitlement_id;
end;
$$;

create or replace function public.update_staff_access(
  p_target_user_id uuid,
  p_role text,
  p_status text,
  p_reason text
)
returns table (
  id uuid,
  email text,
  full_name text,
  role text,
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text;
  previous_role text;
  previous_status text;
  active_owner_count bigint;
  recent_change_count bigint;
begin
  if actor_id is null or coalesce((select auth.jwt() ->> 'aal'), 'aal1') <> 'aal2' then
    raise exception using errcode = '42501', message = 'MFA_REQUIRED';
  end if;

  if p_target_user_id is null
     or p_role is null
     or p_role not in ('owner', 'admin', 'manager', 'reception', 'therapist', 'accountant', 'auditor', 'viewer')
     or p_status is null
     or p_status not in ('invited', 'active', 'suspended') then
    raise exception using errcode = '22023', message = 'INVALID_ACCESS_UPDATE';
  end if;

  if p_reason is null or char_length(btrim(p_reason)) < 3 or char_length(p_reason) > 1000 then
    raise exception using errcode = '22023', message = 'ACCESS_REASON_REQUIRED';
  end if;

  if p_target_user_id = actor_id then
    raise exception using errcode = '22023', message = 'CANNOT_CHANGE_SELF';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cryo_staff_owner_guard', 0));

  select sp.role into actor_role
  from public.staff_profiles as sp
  where sp.id = actor_id and sp.status = 'active';

  if actor_role is null or actor_role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'NOT_AUTHORIZED';
  end if;

  select count(*) into recent_change_count
  from public.staff_access_changes as sac
  where sac.changed_by = actor_id
    and sac.created_at >= now() - interval '10 minutes';

  if recent_change_count >= 20 then
    raise exception using errcode = 'P0001', message = 'RATE_LIMITED';
  end if;

  select sp.role, sp.status
    into previous_role, previous_status
  from public.staff_profiles as sp
  where sp.id = p_target_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'STAFF_NOT_FOUND';
  end if;

  if actor_role <> 'owner'
     and (previous_role in ('owner', 'admin') or p_role in ('owner', 'admin')) then
    raise exception using errcode = '42501', message = 'ROLE_NOT_ALLOWED';
  end if;

  if p_status = 'active' and not exists (
    select 1
    from auth.users as au
    where au.id = p_target_user_id and au.email_confirmed_at is not null
  ) then
    raise exception using errcode = '22023', message = 'EMAIL_NOT_CONFIRMED';
  end if;

  if previous_role = 'owner'
     and previous_status = 'active'
     and (p_role <> 'owner' or p_status <> 'active') then
    select count(*) into active_owner_count
    from public.staff_profiles as sp
    where sp.role = 'owner' and sp.status = 'active';

    if active_owner_count <= 1 then
      raise exception using errcode = '23514', message = 'LAST_OWNER_REQUIRED';
    end if;
  end if;

  if previous_role = p_role and previous_status = p_status then
    raise exception using errcode = '22023', message = 'NO_ACCESS_CHANGE';
  end if;

  update public.staff_profiles as sp
  set role = p_role,
      status = p_status,
      updated_at = now()
  where sp.id = p_target_user_id;

  insert into public.staff_access_changes (
    target_user_id, previous_role, previous_status, new_role, new_status, reason, changed_by
  ) values (
    p_target_user_id, previous_role, previous_status, p_role, p_status, btrim(p_reason), actor_id
  );

  return query
  select sp.id, sp.email, sp.full_name, sp.role, sp.status
  from public.staff_profiles as sp
  where sp.id = p_target_user_id;
end;
$$;

create or replace function public.create_customer_package(
  p_customer_id bigint,
  p_package_name text,
  p_purchased_at timestamptz,
  p_starts_on date,
  p_expires_on date,
  p_price numeric,
  p_entitlement_items jsonb,
  p_notes text default null,
  p_package_template_id bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text;
  new_package_id bigint;
  item_count integer;
begin
  select sp.role into actor_role
  from public.staff_profiles as sp
  where sp.id = actor_id and sp.status = 'active';

  if actor_role is null or actor_role <> all(array['owner', 'admin', 'manager', 'reception']) then
    raise exception using errcode = '42501', message = 'NOT_AUTHORIZED';
  end if;

  if p_customer_id is null or not exists (
    select 1 from public.customers c where c.id = p_customer_id and c.archived_at is null
  ) then
    raise exception using errcode = 'P0002', message = 'CUSTOMER_NOT_FOUND';
  end if;

  if p_package_name is null or char_length(btrim(p_package_name)) < 2 or char_length(p_package_name) > 160 then
    raise exception using errcode = '22023', message = 'INVALID_PACKAGE_NAME';
  end if;

  if p_starts_on is null or (p_expires_on is not null and p_expires_on < p_starts_on) then
    raise exception using errcode = '22023', message = 'INVALID_PACKAGE_DATES';
  end if;

  if p_price is not null and p_price < 0 then
    raise exception using errcode = '22023', message = 'INVALID_PRICE';
  end if;

  if p_notes is not null and char_length(p_notes) > 4000 then
    raise exception using errcode = '22023', message = 'NOTES_TOO_LONG';
  end if;

  if p_entitlement_items is null or jsonb_typeof(p_entitlement_items) <> 'array' then
    raise exception using errcode = '22023', message = 'ENTITLEMENTS_REQUIRED';
  end if;

  select count(*) into item_count from jsonb_array_elements(p_entitlement_items);
  if item_count < 1 or item_count > 100 then
    raise exception using errcode = '22023', message = 'INVALID_ENTITLEMENT_COUNT';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_entitlement_items) as item(service_id bigint, quantity integer)
    where item.service_id is null or item.quantity is null or item.quantity < 1 or item.quantity > 10000
  ) or exists (
    select 1
    from jsonb_to_recordset(p_entitlement_items) as item(service_id bigint, quantity integer)
    group by item.service_id
    having count(*) > 1
  ) or exists (
    select 1
    from jsonb_to_recordset(p_entitlement_items) as item(service_id bigint, quantity integer)
    left join public.services s on s.id = item.service_id and s.is_active
    where s.id is null
  ) then
    raise exception using errcode = '22023', message = 'INVALID_ENTITLEMENTS';
  end if;

  insert into public.customer_packages (
    customer_id, package_template_id, name, status, purchased_at, starts_on, expires_on,
    price, notes, created_by
  ) values (
    p_customer_id, p_package_template_id, btrim(p_package_name), 'active', p_purchased_at, p_starts_on,
    p_expires_on, p_price, p_notes, actor_id
  ) returning id into new_package_id;

  insert into public.customer_entitlements (customer_package_id, service_id, total_quantity)
  select new_package_id, item.service_id, item.quantity
  from jsonb_to_recordset(p_entitlement_items) as item(service_id bigint, quantity integer);

  return new_package_id;
end;
$$;

-- Row Level Security is enabled on every table in the exposed public schema.
alter table public.staff_profiles enable row level security;
alter table public.staff_invites enable row level security;
alter table public.staff_access_changes enable row level security;
alter table private.staff_invite_attempts enable row level security;
alter table private.staff_invite_requests enable row level security;
alter table private.import_rows enable row level security;
alter table private.import_issues enable row level security;
alter table private.identity_resolution enable row level security;
alter table public.customers enable row level security;
alter table public.customer_contacts enable row level security;
alter table public.services enable row level security;
alter table public.service_aliases enable row level security;
alter table public.package_templates enable row level security;
alter table public.package_template_items enable row level security;
alter table public.import_batches enable row level security;
alter table public.customer_packages enable row level security;
alter table public.customer_entitlements enable row level security;
alter table public.entitlement_adjustments enable row level security;
alter table public.appointments enable row level security;
alter table public.visits enable row level security;
alter table public.visit_services enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.payments enable row level security;
alter table public.expenses enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.staff_shifts enable row level security;
alter table public.attendance_events enable row level security;
alter table public.audit_events enable row level security;

create policy staff_profiles_select on public.staff_profiles
for select to authenticated
using (
  id = (select auth.uid())
  or (select private.has_staff_role(array['owner', 'admin', 'manager', 'auditor']))
);

create policy staff_invites_select on public.staff_invites
for select to authenticated
using ((select private.has_staff_role(array['owner', 'admin'])));

create policy staff_access_changes_select on public.staff_access_changes
for select to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'auditor'])));

create policy customers_select on public.customers
for select to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager', 'reception', 'therapist'])));

create policy customers_insert on public.customers
for insert to authenticated
with check (
  (select private.has_staff_role(array['owner', 'admin', 'manager', 'reception']))
  and created_by = (select auth.uid())
);

create policy customers_update on public.customers
for update to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager', 'reception'])))
with check ((select private.has_staff_role(array['owner', 'admin', 'manager', 'reception'])));

create policy customer_contacts_select on public.customer_contacts
for select to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager', 'reception', 'therapist'])));

create policy customer_contacts_insert on public.customer_contacts
for insert to authenticated
with check (
  (select private.has_staff_role(array['owner', 'admin', 'manager', 'reception']))
  and created_by = (select auth.uid())
);

create policy customer_contacts_update on public.customer_contacts
for update to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager', 'reception'])))
with check ((select private.has_staff_role(array['owner', 'admin', 'manager', 'reception'])));

create policy services_select on public.services
for select to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager', 'reception', 'therapist', 'accountant', 'auditor'])));

create policy services_insert on public.services
for insert to authenticated
with check (
  (select private.has_staff_role(array['owner', 'admin', 'manager']))
  and created_by = (select auth.uid())
);

create policy services_update on public.services
for update to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager'])))
with check ((select private.has_staff_role(array['owner', 'admin', 'manager'])));

create policy service_aliases_select on public.service_aliases
for select to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager', 'reception', 'accountant'])));

create policy service_aliases_insert on public.service_aliases
for insert to authenticated
with check (
  (select private.has_staff_role(array['owner', 'admin', 'manager']))
  and created_by = (select auth.uid())
);

create policy package_templates_select on public.package_templates
for select to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager', 'reception', 'therapist', 'accountant', 'auditor'])));

create policy package_templates_insert on public.package_templates
for insert to authenticated
with check (
  (select private.has_staff_role(array['owner', 'admin', 'manager']))
  and created_by = (select auth.uid())
);

create policy package_templates_update on public.package_templates
for update to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager'])))
with check ((select private.has_staff_role(array['owner', 'admin', 'manager'])));

create policy package_template_items_select on public.package_template_items
for select to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager', 'reception', 'therapist', 'accountant', 'auditor'])));

create policy package_template_items_insert on public.package_template_items
for insert to authenticated
with check ((select private.has_staff_role(array['owner', 'admin', 'manager'])));

create policy import_batches_select on public.import_batches
for select to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager', 'accountant', 'auditor'])));

create policy customer_packages_select on public.customer_packages
for select to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager', 'reception', 'therapist'])));

create policy customer_packages_update on public.customer_packages
for update to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager', 'reception'])))
with check ((select private.has_staff_role(array['owner', 'admin', 'manager', 'reception'])));

create policy customer_entitlements_select on public.customer_entitlements
for select to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager', 'reception', 'therapist'])));

create policy entitlement_adjustments_select on public.entitlement_adjustments
for select to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager', 'auditor'])));

create policy appointments_select on public.appointments
for select to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager', 'reception', 'therapist'])));

create policy appointments_insert on public.appointments
for insert to authenticated
with check (
  (select private.has_staff_role(array['owner', 'admin', 'manager', 'reception']))
  and created_by = (select auth.uid())
);

create policy appointments_manage_update on public.appointments
for update to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager', 'reception'])))
with check ((select private.has_staff_role(array['owner', 'admin', 'manager', 'reception'])));

create policy visits_select on public.visits
for select to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager', 'reception', 'therapist'])));

create policy visits_insert on public.visits
for insert to authenticated
with check (
  (select private.has_staff_role(array['owner', 'admin', 'manager', 'reception', 'therapist']))
  and created_by = (select auth.uid())
  and source_batch_id is null
  and source_ref is null
);

create policy visits_update on public.visits
for update to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager'])))
with check ((select private.has_staff_role(array['owner', 'admin', 'manager'])));

create policy visit_services_select on public.visit_services
for select to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager', 'reception', 'therapist'])));

create policy visit_services_insert on public.visit_services
for insert to authenticated
with check (
  (select private.has_staff_role(array['owner', 'admin', 'manager', 'reception', 'therapist']))
  and entitlement_id is null
  and performed_by = (select auth.uid())
);

create policy sales_select on public.sales
for select to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager', 'reception', 'accountant', 'auditor'])));

create policy sales_insert on public.sales
for insert to authenticated
with check (
  (select private.has_staff_role(array['owner', 'admin', 'manager', 'reception', 'accountant']))
  and created_by = (select auth.uid())
  and source_batch_id is null
  and source_ref is null
);

create policy sales_update on public.sales
for update to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager', 'accountant'])))
with check ((select private.has_staff_role(array['owner', 'admin', 'manager', 'accountant'])));

create policy sale_items_select on public.sale_items
for select to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager', 'reception', 'accountant', 'auditor'])));

create policy sale_items_insert on public.sale_items
for insert to authenticated
with check ((select private.has_staff_role(array['owner', 'admin', 'manager', 'reception', 'accountant'])));

create policy payments_select on public.payments
for select to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager', 'reception', 'accountant', 'auditor'])));

create policy payments_insert on public.payments
for insert to authenticated
with check (
  (select private.has_staff_role(array['owner', 'admin', 'manager', 'reception', 'accountant']))
  and created_by = (select auth.uid())
  and source_batch_id is null
  and source_ref is null
);

create policy expenses_select on public.expenses
for select to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager', 'accountant', 'auditor'])));

create policy expenses_insert on public.expenses
for insert to authenticated
with check (
  (select private.has_staff_role(array['owner', 'admin', 'manager', 'accountant']))
  and created_by = (select auth.uid())
  and source_batch_id is null
  and source_ref is null
);

create policy expenses_update on public.expenses
for update to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager', 'accountant'])))
with check ((select private.has_staff_role(array['owner', 'admin', 'manager', 'accountant'])));

create policy inventory_items_select on public.inventory_items
for select to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager', 'therapist'])));

create policy inventory_items_insert on public.inventory_items
for insert to authenticated
with check (
  (select private.has_staff_role(array['owner', 'admin', 'manager']))
  and created_by = (select auth.uid())
);

create policy inventory_items_update on public.inventory_items
for update to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager'])))
with check ((select private.has_staff_role(array['owner', 'admin', 'manager'])));

create policy inventory_movements_select on public.inventory_movements
for select to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager', 'therapist'])));

create policy inventory_movements_insert on public.inventory_movements
for insert to authenticated
with check (
  (select private.has_staff_role(array['owner', 'admin', 'manager']))
  and created_by = (select auth.uid())
  and source_batch_id is null
  and source_ref is null
);

create policy staff_shifts_select on public.staff_shifts
for select to authenticated
using (
  staff_id = (select auth.uid())
  or (select private.has_staff_role(array['owner', 'admin', 'manager']))
);

create policy staff_shifts_insert on public.staff_shifts
for insert to authenticated
with check (
  (select private.has_staff_role(array['owner', 'admin', 'manager']))
  and created_by = (select auth.uid())
  and source_batch_id is null
  and source_ref is null
);

create policy staff_shifts_update on public.staff_shifts
for update to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'manager'])))
with check ((select private.has_staff_role(array['owner', 'admin', 'manager'])));

create policy attendance_events_select on public.attendance_events
for select to authenticated
using (
  staff_id = (select auth.uid())
  or (select private.has_staff_role(array['owner', 'admin', 'manager', 'accountant', 'auditor']))
);

create policy attendance_events_insert on public.attendance_events
for insert to authenticated
with check (
  (select private.has_staff_role(array['owner', 'admin', 'manager']))
  and created_by = (select auth.uid())
  and source_batch_id is null
  and source_ref is null
);

create policy audit_events_select on public.audit_events
for select to authenticated
using ((select private.has_staff_role(array['owner', 'admin', 'auditor'])));

-- No browser role receives DELETE on any business table. Existing records are archived,
-- corrected, or reversed with compensating entries.
revoke all on all tables in schema public from public, anon, authenticated, service_role;
revoke all on all sequences in schema public from public, anon, authenticated, service_role;
revoke all on all functions in schema public from public, anon, authenticated, service_role;

grant usage on schema public to authenticated, service_role;

grant select on public.staff_profiles to authenticated;
grant select on public.staff_invites to authenticated;
grant select on public.staff_access_changes to authenticated;
grant select, insert on public.customers to authenticated;
grant update (full_name, phone, email, birth_date, gender, notes, consent_recorded_at, archived_at, updated_at)
  on public.customers to authenticated;
grant select on public.customer_contacts to authenticated;
grant select on public.services to authenticated;
grant select on public.service_aliases to authenticated;
grant select on public.package_templates to authenticated;
grant select on public.package_template_items to authenticated;
grant select on public.import_batches to authenticated;
grant select on public.customer_packages to authenticated;
grant select on public.customer_entitlements, public.entitlement_adjustments to authenticated;
grant select on public.appointments to authenticated;
grant select on public.visits to authenticated;
grant select on public.visit_services to authenticated;
-- Financial ledgers are read-only from the browser in this release. Production writes
-- must be added later through one atomic server-side sale/payment workflow.
grant select on public.sales, public.sale_items, public.payments to authenticated;
grant select on public.expenses to authenticated;
grant select on public.inventory_items to authenticated;
grant select on public.inventory_movements to authenticated;
grant select on public.staff_shifts to authenticated;
grant select on public.attendance_events to authenticated;
grant select on public.audit_events to authenticated;

grant usage, select on sequence public.customers_id_seq to authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

revoke execute on function public.search_customers(text, integer) from public, anon, service_role;
revoke execute on function public.dashboard_metrics() from public, anon, service_role;
revoke execute on function public.consume_entitlement(bigint, integer, timestamptz, text) from public, anon, service_role;
revoke execute on function public.adjust_entitlement(bigint, integer, integer, text) from public, anon, service_role;
revoke execute on function public.update_staff_access(uuid, text, text, text) from public, anon, service_role;
revoke execute on function public.create_customer_package(bigint, text, timestamptz, date, date, numeric, jsonb, text, bigint) from public, anon, service_role;
revoke execute on function public.reserve_staff_invite(uuid, uuid, text, text, text, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.finalize_staff_invite(bigint, uuid, uuid, boolean) from public, anon, authenticated, service_role;
revoke execute on function public.fail_staff_invite(bigint, uuid, text) from public, anon, authenticated, service_role;

grant execute on function public.search_customers(text, integer) to authenticated;
grant execute on function public.dashboard_metrics() to authenticated;
grant execute on function public.consume_entitlement(bigint, integer, timestamptz, text) to authenticated;
grant execute on function public.adjust_entitlement(bigint, integer, integer, text) to authenticated;
grant execute on function public.update_staff_access(uuid, text, text, text) to authenticated;
grant execute on function public.create_customer_package(bigint, text, timestamptz, date, date, numeric, jsonb, text, bigint) to authenticated;

grant execute on function public.reserve_staff_invite(uuid, uuid, text, text, text, uuid) to service_role;
grant execute on function public.finalize_staff_invite(bigint, uuid, uuid, boolean) to service_role;
grant execute on function public.fail_staff_invite(bigint, uuid, text) to service_role;

reset statement_timeout;
reset lock_timeout;
