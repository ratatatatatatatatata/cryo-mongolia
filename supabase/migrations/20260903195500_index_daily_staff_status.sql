-- Cover foreign keys used by daily staff status policies and audit queries.

create index if not exists daily_staff_status_staff_id_idx
  on public.daily_staff_status (staff_id);

create index if not exists daily_staff_status_reported_by_idx
  on public.daily_staff_status (reported_by);
