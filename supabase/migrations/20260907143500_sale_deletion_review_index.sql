create index if not exists sale_deletion_reviewed_by_idx
  on public.sale_deletion_requests (reviewed_by)
  where reviewed_by is not null;
