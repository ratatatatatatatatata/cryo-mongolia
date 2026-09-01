begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(44);

select ok(
  not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
  ),
  'Every exposed public table has RLS enabled'
);

select ok(
  not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
  ),
  'Every private operational and import table has defense-in-depth RLS enabled'
);

select ok(
  not exists (
    select 1
    from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.grantee = 'anon'
  ),
  'anon has no direct public-table grants'
);

select ok(
  not exists (
    select 1
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.grantee = 'authenticated'
      and g.privilege_type = 'DELETE'
  ),
  'authenticated cannot hard-delete business rows'
);

select ok(
  not has_table_privilege('authenticated', 'public.audit_events', 'INSERT'),
  'authenticated cannot forge audit events'
);

select ok(
  not has_table_privilege('authenticated', 'public.customer_entitlements', 'UPDATE'),
  'entitlements cannot be changed directly from the browser'
);

select ok(
  not exists (
    select 1
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.grantee = 'authenticated'
      and g.privilege_type = 'INSERT'
      and g.table_name <> 'customers'
  ),
  'only customers can be inserted directly from the browser'
);

select ok(
  not exists (
    select 1
    from information_schema.column_privileges g
    where g.table_schema = 'public'
      and g.grantee = 'authenticated'
      and g.privilege_type = 'UPDATE'
      and g.table_name <> 'customers'
  ),
  'only customer fields can be updated directly from the browser'
);

select ok(
  has_schema_privilege('authenticated', 'private', 'USAGE')
  and has_function_privilege('authenticated', 'private.current_staff_role()', 'EXECUTE')
  and has_function_privilege('authenticated', 'private.has_staff_role(text[])', 'EXECUTE'),
  'authenticated can execute only the RLS role helpers through the private schema'
);

select ok(
  not exists (
    select 1
    from information_schema.role_table_grants g
    where g.table_schema = 'private' and g.grantee = 'authenticated'
  ),
  'authenticated has no direct grants on private import tables'
);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'consume_entitlement'
      and p.prosecdef
      and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')
  ),
  'consume_entitlement is a hardened SECURITY DEFINER RPC'
);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'adjust_entitlement'
      and p.prosecdef
      and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')
  ),
  'adjust_entitlement is a hardened SECURITY DEFINER RPC'
);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_customer_package'
      and p.prosecdef
      and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')
  ),
  'create_customer_package is a hardened SECURITY DEFINER RPC'
);

select ok(
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'update_staff_access'
      and p.prosecdef
      and exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')
  ),
  'update_staff_access is a hardened SECURITY DEFINER RPC'
);

select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('consume_entitlement', 'adjust_entitlement', 'create_customer_package', 'update_staff_access')
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  'anon cannot execute privileged ERP RPCs'
);

select ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.prosecdef
      and p.proname not in ('current_staff_role', 'has_staff_role')
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ),
  'authenticated cannot execute any other private SECURITY DEFINER function'
);

select ok(
  has_function_privilege('authenticated', 'private.current_staff_role()', 'EXECUTE')
  and has_function_privilege('authenticated', 'private.has_staff_role(text[])', 'EXECUTE'),
  'RLS role helpers have the exact execute grants required by policies'
);

select ok(
  not has_function_privilege('anon', 'public.reserve_staff_invite(uuid,uuid,text,text,text,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.reserve_staff_invite(uuid,uuid,text,text,text,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.finalize_staff_invite(bigint,uuid,uuid,boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.fail_staff_invite(bigint,uuid,text)', 'EXECUTE'),
  'browser roles cannot execute service-only staff invitation RPCs'
);

select ok(
  has_function_privilege('service_role', 'public.reserve_staff_invite(uuid,uuid,text,text,text,uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.finalize_staff_invite(bigint,uuid,uuid,boolean)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.fail_staff_invite(bigint,uuid,text)', 'EXECUTE'),
  'service role has only the invitation RPC execution path required by the Edge Function'
);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values (
  '00000000-0000-4000-8000-000000000001',
  'owner@example.invalid',
  now(),
  '{"full_name":"Test Owner"}'::jsonb
);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values (
  '00000000-0000-4000-8000-000000000003',
  'admin@example.invalid',
  now(),
  '{"full_name":"Test Admin"}'::jsonb
);

select lives_ok(
  $$select private.bootstrap_first_owner('00000000-0000-4000-8000-000000000001')$$,
  'database owner can perform the one-time confirmed-user bootstrap'
);

select ok(
  exists (
    select 1
    from public.staff_profiles as sp
    where sp.id = '00000000-0000-4000-8000-000000000001'
      and sp.role = 'owner'
      and sp.status = 'active'
  )
  and not has_function_privilege('service_role', 'private.bootstrap_first_owner(uuid)', 'EXECUTE'),
  'first owner becomes active while the bootstrap function remains unavailable to service role'
);

update public.staff_profiles
set role = 'admin', status = 'active'
where id = '00000000-0000-4000-8000-000000000003';

select is(
  (
    select r.should_send
    from public.reserve_staff_invite(
      '00000000-0000-4000-8000-000000000101',
      '00000000-0000-4000-8000-000000000201',
      'worker@example.invalid',
      'Test Worker',
      'reception',
      '00000000-0000-4000-8000-000000000001'
    ) as r
  ),
  true,
  'first invitation request owns the external email side effect'
);

select is(
  (
    select r.should_send
    from public.reserve_staff_invite(
      '00000000-0000-4000-8000-000000000101',
      '00000000-0000-4000-8000-000000000202',
      'worker@example.invalid',
      'Test Worker',
      'reception',
      '00000000-0000-4000-8000-000000000001'
    ) as r
  ),
  false,
  'concurrent idempotent retry cannot send a duplicate invitation'
);

select is(
  public.fail_staff_invite(
    (select si.id from public.staff_invites as si where lower(si.email) = 'worker@example.invalid'),
    '00000000-0000-4000-8000-000000000299',
    'TEST_FAILURE'
  ),
  false,
  'a non-owner attempt token cannot fail an invitation'
);

select is(
  public.fail_staff_invite(
    (select si.id from public.staff_invites as si where lower(si.email) = 'worker@example.invalid'),
    '00000000-0000-4000-8000-000000000201',
    'TEST_FAILURE'
  ),
  true,
  'the reservation owner can record an invitation failure'
);

select is(
  (
    select r.should_send
    from public.reserve_staff_invite(
      '00000000-0000-4000-8000-000000000101',
      '00000000-0000-4000-8000-000000000202',
      'worker@example.invalid',
      'Test Worker',
      'reception',
      '00000000-0000-4000-8000-000000000001'
    ) as r
  ),
  true,
  'failed invitation can be retried with a new attempt token'
);

insert into auth.users (id, email, raw_user_meta_data)
values (
  '00000000-0000-4000-8000-000000000002',
  'worker@example.invalid',
  '{"full_name":"Test Worker"}'::jsonb
);

select is(
  public.finalize_staff_invite(
    (select si.id from public.staff_invites as si where lower(si.email) = 'worker@example.invalid'),
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000202',
    false
  ),
  'linked',
  'only the active invitation attempt can finalize the linked Auth user'
);

select ok(
  exists (
    select 1
    from public.staff_profiles as sp
    where sp.id = '00000000-0000-4000-8000-000000000002'
      and sp.role = 'reception'
      and sp.status = 'invited'
  ),
  'Auth trigger preserves the reviewed invitation role without activating access'
);

update public.staff_invites
set expires_at = now() - interval '1 second'
where lower(email) = 'worker@example.invalid';

select ok(
  (
    select r.should_send
      and r.auth_user_id = '00000000-0000-4000-8000-000000000002'
    from public.reserve_staff_invite(
      '00000000-0000-4000-8000-000000000102',
      '00000000-0000-4000-8000-000000000203',
      'worker@example.invalid',
      'Renewed Worker',
      'therapist',
      '00000000-0000-4000-8000-000000000003'
    ) as r
  ),
  'expired invitation is atomically reused for the existing Auth user'
);

select is(
  public.finalize_staff_invite(
    (select si.id from public.staff_invites as si where lower(si.email) = 'worker@example.invalid'),
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000203',
    false
  ),
  'linked',
  'renewed invitation finalizes without creating a duplicate invite row'
);

select ok(
  exists (
    select 1
    from public.staff_profiles as sp
    where sp.id = '00000000-0000-4000-8000-000000000002'
      and sp.full_name = 'Renewed Worker'
      and sp.role = 'therapist'
      and sp.status = 'invited'
  ),
  'renewed reviewed role and name reconcile to the invited staff profile'
);

select ok(
  exists (
    select 1
    from public.audit_events as ae
    where ae.table_name = 'public.staff_invites'
      and ae.action = 'UPDATE'
      and ae.actor_id = '00000000-0000-4000-8000-000000000003'
      and ae.new_data ->> 'last_action_by' = '00000000-0000-4000-8000-000000000003'
  )
  and exists (
    select 1
    from public.audit_events as ae
    where ae.table_name = 'private.staff_invite_requests'
      and ae.action = 'UPDATE'
      and ae.actor_id = '00000000-0000-4000-8000-000000000003'
      and ae.new_data ->> 'retired_by' = '00000000-0000-4000-8000-000000000003'
  ),
  'cross-admin renewal audit records the administrator who performed each action'
);

select throws_ok(
  $statement$
    select *
    from public.reserve_staff_invite(
      '00000000-0000-4000-8000-000000000101',
      '00000000-0000-4000-8000-000000000204',
      'worker@example.invalid',
      'Test Worker',
      'reception',
      '00000000-0000-4000-8000-000000000001'
    )
  $statement$,
  '23505',
  'IDEMPOTENCY_RETIRED',
  'an old idempotency request cannot overwrite a renewed invitation'
);

select is(
  (
    select r.should_send
    from public.reserve_staff_invite(
      '00000000-0000-4000-8000-000000000103',
      '00000000-0000-4000-8000-000000000205',
      'late-provider@example.invalid',
      'Late Provider Worker',
      'manager',
      '00000000-0000-4000-8000-000000000001'
    ) as r
  ),
  true,
  'a new invitation reserves one provider side effect'
);

select is(
  public.fail_staff_invite(
    (select si.id from public.staff_invites as si where lower(si.email) = 'late-provider@example.invalid'),
    '00000000-0000-4000-8000-000000000205',
    'AUTH_PROVIDER_FAILED'
  ),
  true,
  'an ambiguous provider failure is recorded against the active attempt'
);

insert into auth.users (id, email, raw_user_meta_data)
values (
  '00000000-0000-4000-8000-000000000004',
  'late-provider@example.invalid',
  '{"full_name":"Late Provider Worker"}'::jsonb
);

select ok(
  exists (
    select 1
    from public.staff_invites as si
    where lower(si.email) = 'late-provider@example.invalid'
      and si.status = 'linked'
      and si.auth_user_id = '00000000-0000-4000-8000-000000000004'
  )
  and exists (
    select 1
    from public.staff_profiles as sp
    where sp.id = '00000000-0000-4000-8000-000000000004'
      and sp.role = 'manager'
      and sp.status = 'invited'
  ),
  'a late provider success is reconciled without losing the reviewed staff role'
);

select is(
  (
    select r.should_send
    from public.reserve_staff_invite(
      '00000000-0000-4000-8000-000000000104',
      '00000000-0000-4000-8000-000000000206',
      'stale-attempt@example.invalid',
      'Stale Attempt Worker',
      'reception',
      '00000000-0000-4000-8000-000000000003'
    ) as r
  ),
  true,
  'a new email invitation starts an owned sending lease'
);

update public.staff_invites
set processing_started_at = now() - interval '6 minutes'
where lower(email) = 'stale-attempt@example.invalid';

select ok(
  (
    select r.should_send
      and r.reservation_token = '00000000-0000-4000-8000-000000000207'
    from public.reserve_staff_invite(
      '00000000-0000-4000-8000-000000000105',
      '00000000-0000-4000-8000-000000000207',
      'stale-attempt@example.invalid',
      'Stale Attempt Worker',
      'reception',
      '00000000-0000-4000-8000-000000000003'
    ) as r
  )
  and exists (
    select 1
    from private.staff_invite_requests as sir
    where sir.idempotency_key = '00000000-0000-4000-8000-000000000104'
      and sir.retired_by = '00000000-0000-4000-8000-000000000003'
      and sir.retired_at is not null
  ),
  'a new request can safely take over a stale sending lease after five minutes'
);

select is(
  (
    select r.should_send
    from public.reserve_staff_invite(
      '00000000-0000-4000-8000-000000000106',
      '00000000-0000-4000-8000-000000000208',
      'confirmation-race@example.invalid',
      'Initial Confirmation Worker',
      'reception',
      '00000000-0000-4000-8000-000000000003'
    ) as r
  ),
  true,
  'the initial confirmation-race invitation owns its provider side effect'
);

insert into auth.users (id, email, raw_user_meta_data)
values (
  '00000000-0000-4000-8000-000000000005',
  'confirmation-race@example.invalid',
  '{"full_name":"Initial Confirmation Worker"}'::jsonb
);

select is(
  public.finalize_staff_invite(
    (select si.id from public.staff_invites as si where lower(si.email) = 'confirmation-race@example.invalid'),
    '00000000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000000208',
    false
  ),
  'linked',
  'the initial confirmation-race invitation links before renewal'
);

update public.staff_invites
set expires_at = now() - interval '1 second'
where lower(email) = 'confirmation-race@example.invalid';

select ok(
  (
    select r.should_send
      and r.auth_user_id = '00000000-0000-4000-8000-000000000005'
    from public.reserve_staff_invite(
      '00000000-0000-4000-8000-000000000107',
      '00000000-0000-4000-8000-000000000209',
      'confirmation-race@example.invalid',
      'Renewed Confirmation Worker',
      'therapist',
      '00000000-0000-4000-8000-000000000003'
    ) as r
  ),
  'an unconfirmed existing Auth user can start a reviewed renewal'
);

update auth.users
set email_confirmed_at = now()
where id = '00000000-0000-4000-8000-000000000005';

select ok(
  exists (
    select 1
    from public.staff_invites as si
    where lower(si.email) = 'confirmation-race@example.invalid'
      and si.status = 'accepted'
      and si.auth_user_id = '00000000-0000-4000-8000-000000000005'
  )
  and exists (
    select 1
    from public.staff_profiles as sp
    where sp.id = '00000000-0000-4000-8000-000000000005'
      and sp.full_name = 'Renewed Confirmation Worker'
      and sp.role = 'therapist'
      and sp.status = 'invited'
      and sp.invited_by = '00000000-0000-4000-8000-000000000003'
  ),
  'confirmation before Edge finalization still reconciles the reviewed renewal profile'
);

select is(
  public.finalize_staff_invite(
    (select si.id from public.staff_invites as si where lower(si.email) = 'confirmation-race@example.invalid'),
    '00000000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000000209',
    false
  ),
  'accepted',
  'Edge finalization remains idempotent after confirmation wins the race'
);

select ok(
  exists (
    select 1
    from public.staff_invites as si
    where lower(si.email) = 'confirmation-race@example.invalid'
      and si.status = 'accepted'
      and si.processing_token is null
      and si.processing_started_at is null
  ),
  'post-confirmation finalization clears the sending lease'
);

select * from finish();
rollback;
