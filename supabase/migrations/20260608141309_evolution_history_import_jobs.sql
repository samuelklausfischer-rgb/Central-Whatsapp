create table if not exists public.evolution_history_import_jobs (
  id uuid primary key default gen_random_uuid(),
  instance_name text not null,
  device_id uuid not null references public.devices(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  total_messages integer not null default 0,
  total_pages integer not null default 0,
  target_pages integer not null default 0,
  current_page integer not null default 1,
  page_size integer not null default 50 check (page_size between 1 and 200),
  media_mode text not null default 'hybrid' check (media_mode in ('metadata_only', 'hybrid')),
  recent_media_days integer not null default 7 check (recent_media_days between 0 and 90),
  inserted_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count integer not null default 0,
  error_message text,
  started_by uuid references public.profiles(id),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_evolution_history_import_jobs_instance
  on public.evolution_history_import_jobs (instance_name);

create index if not exists idx_evolution_history_import_jobs_device
  on public.evolution_history_import_jobs (device_id);

create index if not exists idx_evolution_history_import_jobs_status
  on public.evolution_history_import_jobs (status, updated_at desc);

create unique index if not exists idx_evolution_history_import_jobs_one_active
  on public.evolution_history_import_jobs (instance_name)
  where status in ('pending', 'running', 'paused');

alter table public.evolution_history_import_jobs enable row level security;

drop policy if exists select_evolution_history_import_jobs on public.evolution_history_import_jobs;
create policy select_evolution_history_import_jobs
  on public.evolution_history_import_jobs
  for select
  to authenticated
  using (public._is_admin());

drop policy if exists insert_evolution_history_import_jobs on public.evolution_history_import_jobs;
create policy insert_evolution_history_import_jobs
  on public.evolution_history_import_jobs
  for insert
  to authenticated
  with check (public._is_admin());

drop policy if exists update_evolution_history_import_jobs on public.evolution_history_import_jobs;
create policy update_evolution_history_import_jobs
  on public.evolution_history_import_jobs
  for update
  to authenticated
  using (public._is_admin())
  with check (public._is_admin());

drop policy if exists delete_evolution_history_import_jobs on public.evolution_history_import_jobs;
create policy delete_evolution_history_import_jobs
  on public.evolution_history_import_jobs
  for delete
  to authenticated
  using (public._is_admin());
