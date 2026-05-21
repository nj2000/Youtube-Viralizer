-- Stage 10 (SEO metadata pack) FTC disclosure toggle.
-- A run flagged sponsored gets a paid-promotion disclosure prefix injected into
-- the generated description (spec §5.2). Defaults false; partial index keeps the
-- "sponsored runs" lookup cheap without bloating the common case.

alter table public.pipeline_runs
  add column if not exists is_sponsored boolean not null default false;

create index if not exists idx_pipeline_runs_sponsored
  on public.pipeline_runs (id)
  where is_sponsored = true;
