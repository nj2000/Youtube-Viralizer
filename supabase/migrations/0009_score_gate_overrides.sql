-- Phase 2.2 / 0009 — Score + 92% gate override columns + reframe audit table
--
-- Adds the override path documented in
-- `Documentation/Overviews and Summaries/05-virality-score-gate/spec.md`:
--   - new `scored_overridden` status (natural pass stays running→complete)
--   - two columns on pipeline_runs to record the override act
--   - reframe_applications audit table feeding Feature #17 calibration

-- Postgres requires enum values be added in their own statement before they
-- can be referenced elsewhere in the same migration. Idempotent IF NOT EXISTS
-- makes the migration safe to re-run.
alter type public.pipeline_run_status add value if not exists 'scored_overridden';

alter table public.pipeline_runs
  add column if not exists gate_overridden_at  timestamptz,
  add column if not exists gate_override_reason text
    check (gate_override_reason is null or char_length(gate_override_reason) <= 500);

-- Audit row written every time the user clicks "Use this angle" on a reframe.
-- Feature #17 reads this in Phase 3 to calibrate predicted-vs-actual lift.
create table if not exists public.reframe_applications (
  id                   uuid primary key default gen_random_uuid(),
  run_id               uuid not null references public.pipeline_runs(id) on delete cascade,
  user_id              uuid not null references auth.users(id) on delete cascade,
  reframe_index        integer not null check (reframe_index between 0 and 9),
  original_idea_text   text not null,
  revised_idea_text    text not null,
  expected_score_lift  integer
                       check (expected_score_lift is null or expected_score_lift between 0 and 100),
  applied_at           timestamptz not null default now()
);

create index if not exists reframe_applications_user_applied_idx
  on public.reframe_applications (user_id, applied_at desc);

create index if not exists reframe_applications_run_idx
  on public.reframe_applications (run_id);

alter table public.reframe_applications enable row level security;

create policy "reframe_applications_select_own" on public.reframe_applications
  for select using (auth.uid() = user_id);

create policy "reframe_applications_insert_own" on public.reframe_applications
  for insert with check (auth.uid() = user_id);

-- No update / delete policy: audit log is append-only.
