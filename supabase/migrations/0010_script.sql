-- Phase 2.5 / 0010 — Retention script (Stage 7) columns + spend/throttle tables
--
-- Adds the script length + locked-index columns, the daily Anthropic spend
-- cap, and the per-channel generation throttle documented in
-- `Documentation/Overviews and Summaries/08-retention-script/spec.md` §9.

alter table public.pipeline_runs
  add column if not exists script_target_minutes smallint
    check (script_target_minutes is null or script_target_minutes in (5, 8, 12, 20)),
  add column if not exists script_locked_title_index smallint
    check (script_locked_title_index is null or script_locked_title_index between 0 and 2),
  add column if not exists script_locked_hook_index smallint
    check (script_locked_hook_index is null or script_locked_hook_index between 0 and 2);

-- Daily Anthropic spend tracking. Service-role only (RLS, zero policies) —
-- the cap is enforced app-side before the most expensive call in the app
-- (Opus 4.7 script generation).
create table if not exists public.anthropic_spend_daily (
  day             date primary key,
  total_micro_usd bigint not null default 0,
  updated_at      timestamptz not null default now()
);

-- Per-channel generation throttle: 30 full scripts / 24h, 60 section regens / 24h.
create table if not exists public.script_gen_throttle (
  channel_id     uuid not null references public.channels(id) on delete cascade,
  day            date not null,
  full_count     integer not null default 0,
  section_count  integer not null default 0,
  updated_at     timestamptz not null default now()
);

create unique index if not exists script_gen_throttle_channel_day_unique
  on public.script_gen_throttle (channel_id, day);

alter table public.anthropic_spend_daily enable row level security;
alter table public.script_gen_throttle enable row level security;
-- No policies → only the service-role key can read/write (these are
-- infra-level counters, never touched by a user-scoped client).
