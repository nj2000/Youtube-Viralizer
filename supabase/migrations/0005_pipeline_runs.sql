-- Phase 1.2 / 0005 — pipeline_runs table
-- One row per idea → 12-stage kit run. 10 JSONB stage columns + 10 stale_* booleans.
-- Stage data is jsonb at the DB layer; per-stage Zod schemas validate shape at the app layer.

create type public.pipeline_run_status as enum (
  'queued',
  'running',
  'gated_failed',
  'complete',
  'error'
);

create table public.pipeline_runs (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  channel_id               uuid not null references public.channels(id) on delete restrict,
  idea_text                text not null
                           check (char_length(idea_text) between 10 and 500),
  status                   public.pipeline_run_status not null default 'queued',
  current_stage            integer
                           check (current_stage is null or current_stage between 1 and 12),
  failure_reason           text,

  -- Stage outputs (one column per stage 3-12).
  competitor_data          jsonb,
  score_data               jsonb,
  titles_data              jsonb,
  hook_data                jsonb,
  script_data              jsonb,
  lint_data                jsonb,
  thumbnails_data          jsonb,
  seo_data                 jsonb,
  ab_plan_data             jsonb,
  engagement_drafts_data   jsonb,

  -- Staleness flags. Set when an upstream stage re-runs; cleared on self re-run.
  stale_competitor         boolean not null default false,
  stale_score              boolean not null default false,
  stale_titles             boolean not null default false,
  stale_hook               boolean not null default false,
  stale_script             boolean not null default false,
  stale_lint               boolean not null default false,
  stale_thumbnails         boolean not null default false,
  stale_seo                boolean not null default false,
  stale_ab_plan            boolean not null default false,
  stale_engagement_drafts  boolean not null default false,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  completed_at             timestamptz,
  deleted_at               timestamptz
);

create trigger pipeline_runs_set_updated_at
  before update on public.pipeline_runs
  for each row execute function public.set_updated_at();

create index pipeline_runs_user_channel_created_idx
  on public.pipeline_runs (user_id, channel_id, created_at desc)
  where deleted_at is null;

create index pipeline_runs_user_status_idx
  on public.pipeline_runs (user_id, status, created_at desc)
  where deleted_at is null;

create index pipeline_runs_idea_text_trgm
  on public.pipeline_runs using gin (idea_text gin_trgm_ops)
  where deleted_at is null;

create index pipeline_runs_channel_id_idx
  on public.pipeline_runs (channel_id)
  where deleted_at is null;

alter table public.pipeline_runs enable row level security;

create policy "pipeline_runs_select_own" on public.pipeline_runs
  for select using (auth.uid() = user_id and deleted_at is null);

create policy "pipeline_runs_insert_own" on public.pipeline_runs
  for insert with check (auth.uid() = user_id);

create policy "pipeline_runs_update_own" on public.pipeline_runs
  for update using (auth.uid() = user_id);
-- No delete policy: user-facing deletes go through app code that sets deleted_at.
