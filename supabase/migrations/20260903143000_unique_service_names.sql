-- Production duplicate rows were backed up and removed separately under the
-- approved, ID-scoped migration `dedupe_service_names_with_private_backup_20260903`.
-- Keep the portable schema invariant in source control without relying on
-- environment-specific generated IDs.
create unique index if not exists services_name_ci_unique
  on public.services (lower(btrim(name)));
