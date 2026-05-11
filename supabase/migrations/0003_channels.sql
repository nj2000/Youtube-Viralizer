-- Phase 1.2 / 0003 — channels table
-- 21 columns per spec #01 §3.1; unique partial index allows re-insert after soft-delete.
-- Adds profiles.active_channel_id FK (deferred from 0002) and sync_channel_count trigger.

create table public.channels (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references auth.users(id) on delete cascade,
  youtube_channel_id          text not null,
  handle                      text,
  title                       text not null,
  description                 text,
  niche                       text check (char_length(niche) <= 200),
  niche_source                text not null default 'auto'
                              check (niche_source in ('auto', 'user_edited')),
  subscriber_count            integer,
  median_views                integer,
  total_views                 bigint,
  country                     text,
  top_videos_json             jsonb not null default '[]'::jsonb,
  competitor_set_json         jsonb not null default '[]'::jsonb,
  is_new_channel              boolean not null default false,
  low_cadence                 boolean not null default false,
  last_refreshed_at           timestamptz not null default now(),
  last_competitor_redetect_at timestamptz,
  deleted_at                  timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create unique index channels_user_youtube_unique
  on public.channels (user_id, youtube_channel_id)
  where deleted_at is null;

create index channels_user_id_idx
  on public.channels (user_id)
  where deleted_at is null;

alter table public.profiles
  add constraint profiles_active_channel_id_fkey
  foreign key (active_channel_id)
  references public.channels(id)
  on delete set null;

alter table public.channels enable row level security;

create policy "channels_select_own" on public.channels
  for select using (auth.uid() = user_id);

create policy "channels_insert_own" on public.channels
  for insert with check (auth.uid() = user_id);

create policy "channels_update_own" on public.channels
  for update using (auth.uid() = user_id);

create policy "channels_delete_own" on public.channels
  for delete using (auth.uid() = user_id);

create trigger channels_set_updated_at
  before update on public.channels
  for each row execute function public.set_updated_at();

-- channel_count_cache is denormalized for fast 3-channel-limit checks (Phase 1.5).
-- Trigger keeps it in sync on insert / soft-delete (deleted_at flip) / hard-delete.
-- security definer is required so the trigger can update profiles regardless of
-- the calling user's RLS context. Function lives in the `private` schema so it
-- isn't reachable via the Data API.
create or replace function private.sync_channel_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'INSERT' then
    update public.profiles
      set channel_count_cache = channel_count_cache + 1
      where id = new.user_id;
  elsif TG_OP = 'UPDATE' then
    if old.deleted_at is null and new.deleted_at is not null then
      update public.profiles
        set channel_count_cache = greatest(channel_count_cache - 1, 0)
        where id = new.user_id;
    elsif old.deleted_at is not null and new.deleted_at is null then
      update public.profiles
        set channel_count_cache = channel_count_cache + 1
        where id = new.user_id;
    end if;
  elsif TG_OP = 'DELETE' then
    if old.deleted_at is null then
      update public.profiles
        set channel_count_cache = greatest(channel_count_cache - 1, 0)
        where id = old.user_id;
    end if;
  end if;
  return null;
end;
$$;

revoke all on function private.sync_channel_count() from public, anon, authenticated;

create trigger channels_sync_count
  after insert or update of deleted_at or delete on public.channels
  for each row execute function private.sync_channel_count();
