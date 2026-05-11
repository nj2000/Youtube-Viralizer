-- Phase 1.2 / 0006 — YouTube quota + API cache (CRIT-1, EXT-2)
-- Service-role only: RLS enabled with zero policies = deny all anon/authenticated.

create table public.youtube_quota_usage (
  id          uuid primary key default gen_random_uuid(),
  date        date not null,
  units_used  integer not null default 0,
  consumer    text not null default 'hot_path'
              check (consumer in ('hot_path', 'corpus_cron'))
);

create unique index youtube_quota_usage_date_consumer_unique
  on public.youtube_quota_usage (date, consumer);

create table public.youtube_api_cache (
  cache_key   text primary key,
  payload     jsonb not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index youtube_api_cache_expires_at_idx
  on public.youtube_api_cache (expires_at);

alter table public.youtube_quota_usage enable row level security;
alter table public.youtube_api_cache enable row level security;
-- No policies → only service-role bypass works.
