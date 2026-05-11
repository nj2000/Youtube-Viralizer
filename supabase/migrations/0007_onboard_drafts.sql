-- Phase 1.2 / 0007 — onboard_drafts (ephemeral, service-role only)
-- 10-minute TTL row between /api/onboard (SSE) and /api/onboard/confirm.
-- A cleanup cron in Phase 2 will delete rows where expires_at < now().

create table public.onboard_drafts (
  draft_id    uuid primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  payload     jsonb not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '10 minutes')
);

create index onboard_drafts_expires_at_idx
  on public.onboard_drafts (expires_at);

alter table public.onboard_drafts enable row level security;
-- No policies → service-role only.
