-- Phase 1.2 / 0002 — profiles table
-- One row per auth.users row, auto-created by trigger in 0004.
-- active_channel_id FK is added in 0003 after channels exists.

create table public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  active_channel_id   uuid,
  channel_count_cache integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- Shared updated_at trigger function reused on channels and pipeline_runs.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
