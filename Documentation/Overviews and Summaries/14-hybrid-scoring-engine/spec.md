# Spec — Feature #14: Hybrid Scoring Engine (Phase 2 enhancement of Stage 4)

> **Status:** Approved · **Phase:** 2 · **Tier:** 3.1 (Defensibility unlock) · **Build Order:** §3.1
> **Source PRD:** `Documentation/PRDs/14-hybrid-scoring-engine.md`
> **Mockup:** `Documentation/Mockups/14-hybrid-scoring-engine.html`
> **Enhances:** Feature #05 — `Documentation/Overviews and Summaries/05-virality-score-gate/spec.md` (Stage 4)
> **Cross-feature contracts:** Feature #01 (`channels.niche`), Feature #04 (`competitor_data` shape), Feature #17 (calibration reads `outlier_corpus`), Feature #18 (niche vocabulary reads `outlier_corpus`)

This spec is the engineering contract. It supersedes the PRD on any conflict. Code is built from this document.

This feature is the **defensibility unlock** for the product. Without it, Stage 4 is opinion-shaped LLM scoring that can be cloned by any team with a Claude key. With it, scores are grounded in a per-niche empirical base rate built from real YouTube outliers — a moat that compounds with every nightly cron run.

It is the **highest priority within Phase 2**. It must ship before Feature #17 (calibration loop) and Feature #18 (niche vocabulary), both of which depend on the outlier corpus this feature creates.

---

## 1. Overview

The Phase 1 Stage 4 spec ships LLM-only scoring: Opus 4.7 reasons over the Stage 3 outlier set produced *during* the user's run and emits five integer dimension scores. That path remains intact. This feature adds a second, parallel scoring path — the **empirical component** — and a deterministic blending step.

**The hybrid pipeline:**

1. **Embed** the idea + niche label as a 1,536-dim vector (default: OpenAI `text-embedding-3-small`; §5.1 covers alternatives).
2. **k-NN search** `outlier_corpus`, scoped to the user's niche, returning top-20 neighbors above similarity floor `0.75` (cosine).
3. **Compute the empirical component** as 0–100 from neighbor density, `view_multiple` distribution, and recency (§5.5).
4. **Run the LLM component** in parallel — same prompt as Phase 1 plus a read-only `<empirical_signals>` block.
5. **Blend** deterministically: `weightedFinal = 0.4 × llmScore + 0.6 × empiricalScore` when ≥30 neighbors above floor; otherwise fall back to `weightedFinal = llmScore` (low-confidence banner).
6. **Apply the gate** at `GATE_THRESHOLD = 92` (unchanged); reframe behavior unchanged.

**The corpus is built by a nightly cron** that scrapes YouTube for `view_multiple ≥ 5×` videos in tracked niches, four times daily, embeds each title, and persists. Cron stops at 5K of 10K daily YouTube quota so it never competes with the hot path (CRIT-1).

**Phase 2 vs. Phase 1.** Forward-compatible extension of the Phase 1 score-data shape. The `score_data.version` field is bumped from `"v1"` to `"v2"`; v2 adds `empiricalScore`, `corpusMatches`, `confidence`, `weightedFinal`, `weights`. Gate semantics are preserved: `passed` and `finalScore` keep their meaning; in v2, `finalScore = weightedFinal`.

**MVP defaults.** Blending weights, similarity thresholds, neighbor-count thresholds, retention window — all constants in `lib/config.ts`. Feature #17 learns better values per niche; this spec ships static defaults and never changes them at runtime.

**Why it matters.** LLM-only same-idea variance is ±5 pts; hybrid drops it to ±1.8 (admin view target). More importantly, the score answers a different question: not "does Opus think this is viral-shaped?" but "do similar ideas in this niche actually break out?" That has an empirical answer.

**Source attribution.** No new prompt is ported from `claude-youtube`. The Stage 4 prompt is reused with an additive user-prompt block. pgvector setup, cron, and empirical formula are original.

---

## 2. User Stories

Phase 2 covers the following stories from the PRD. Out-of-scope deferred items live in §10.

- As a creator, my idea is scored against real videos that recently broke out in my niche, so the score reflects what's actually working now (not just what Opus thinks is "viral-shaped").
- As a creator, I see the historical outliers my idea is being compared to (top 5 nearest neighbors with similarity, view-multiple, channel, and a one-line "why match"), so I trust the score.
- As a creator, I get the same score (±2 points) when I re-run the same idea, so the gate isn't a coin flip.
- As a creator, when my niche has a thin corpus, I see a "Limited reference data" banner and the score falls back to LLM-only — I'd rather see a directional score with a confidence label than a confidently wrong number.
- As a creator, when the corpus is brand-new (cold start), I see a "We're still learning your niche" banner with an estimate of when calibrated scoring becomes available, so I'm not surprised by the missing component.
- As a creator, when the embedding service is down, my run still completes with the LLM-only score and a small "service degraded" badge, so a Claude / OpenAI outage doesn't block the kit.
- As a product owner, I have an admin view (`/admin/corpus`) that shows corpus density per niche, the last cron run, and the current calibration drift, so I can intervene if the system goes off the rails.
- As a product owner, I can trigger an out-of-band cron run from the admin view without opening a terminal, so I can backfill after a niche is added or after a quota outage.

---

## 3. Data Model

### 3.1 New table: `public.outlier_corpus`

One row per scraped outlier. Inserted by the nightly cron (§5.7) and by Stage 3's opportunistic side-write (§5.8). Read by the empirical-scoring service (§5.4) and Features #17 / #18.

#### 3.1.1 pgvector setup

```sql
-- supabase/migrations/{timestamp}_enable_pgvector.sql
create extension if not exists vector;
```

Supabase Postgres supports `pgvector` on every project tier. **HNSW vs. IVFFlat:** we use HNSW — sub-50ms query latency at launch scale (≤50K rows), no periodic re-indexing. Decision flagged in Appendix B.

#### 3.1.2 Schema

```sql
-- supabase/migrations/{timestamp}_create_outlier_corpus.sql

create table public.outlier_corpus (
  id                    uuid primary key default gen_random_uuid(),

  -- YouTube identity
  video_id              text not null,                       -- "dQw4w9WgXcQ" (11 chars)
  channel_id            text not null,                       -- "UCxxx..."

  -- Niche scoping
  niche_label           text not null check (char_length(niche_label) <= 200),
  niche_embedding       vector(1536),                        -- nullable; backfilled by §5.6

  -- Title content
  title_text            text not null check (char_length(title_text) <= 500),
  title_embedding       vector(1536) not null,

  -- Optional thumbnail brief stub (forward-compat for Phase 3 image-gen)
  thumbnail_brief       jsonb,                               -- nullable; structure TBD by Feature #23

  -- Outlier statistics
  view_count            bigint not null,
  channel_median_views  bigint not null,
  view_multiple         numeric(8, 2) not null check (view_multiple >= 5.0),
  published_at          timestamptz not null,

  -- Provenance
  source_run_id         uuid references public.pipeline_runs(id) on delete set null,
                                                             -- non-null when scraped via §5.8 side-write;
                                                             -- null when scraped by the nightly cron
  scrape_source         text not null check (scrape_source in ('cron', 'pipeline_side_write'))
                          default 'cron',
  indexed_at            timestamptz not null default now(),

  -- Quality / dedup
  is_active             boolean not null default true,       -- false when archived (>180d) or filtered out
  archived_at           timestamptz,
  filter_reason         text                                 -- 'livestream' | 'short' | 'inflated' | 'duplicate' | null
);

-- Idempotency: never index the same video twice.
create unique index outlier_corpus_video_unique
  on public.outlier_corpus (video_id)
  where is_active = true;

-- Niche scoping is the most common filter; standalone btree.
create index outlier_corpus_niche_active
  on public.outlier_corpus (niche_label)
  where is_active = true;

-- HNSW vector index on title_embedding scoped to active rows.
-- ef_construction = 64 / m = 16 are pgvector defaults that work well at this scale.
create index outlier_corpus_title_embedding_hnsw
  on public.outlier_corpus
  using hnsw (title_embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- Optional secondary HNSW for niche similarity (used by Feature #18, not by this spec's hot path).
create index outlier_corpus_niche_embedding_hnsw
  on public.outlier_corpus
  using hnsw (niche_embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64)
  where niche_embedding is not null;

-- Recency filter. Most empirical queries restrict to last 180 days.
create index outlier_corpus_published_at
  on public.outlier_corpus (published_at desc)
  where is_active = true;

-- RLS: corpus is global and read-only to authenticated users.
alter table public.outlier_corpus enable row level security;

create policy "outlier_corpus_select_authenticated"
  on public.outlier_corpus
  for select
  using (auth.role() = 'authenticated');

-- Inserts/updates are restricted to the service role (used by the cron + side-write).
-- No INSERT/UPDATE/DELETE policy means no end-user can write directly. The service role
-- bypasses RLS, which is the intended path for cron jobs.
```

#### 3.1.3 Companion table: `public.corpus_cron_runs`

The cron emits one row per execution for the admin health view (§4.5).

```sql
create table public.corpus_cron_runs (
  id                    uuid primary key default gen_random_uuid(),
  started_at            timestamptz not null default now(),
  finished_at           timestamptz,
  status                text not null default 'running'
                          check (status in ('running', 'success', 'partial', 'failed')),
  niches_processed      integer not null default 0,
  outliers_added        integer not null default 0,
  outliers_skipped      integer not null default 0,
  youtube_quota_used    integer not null default 0,
  embedding_calls       integer not null default 0,
  error_message         text,
  trigger_source        text not null check (trigger_source in ('schedule', 'manual_admin'))
                          default 'schedule'
);

create index corpus_cron_runs_started_at on public.corpus_cron_runs (started_at desc);

alter table public.corpus_cron_runs enable row level security;

-- Admin-only read (admin role check happens at the API layer; RLS enforces no end-user reads).
create policy "corpus_cron_runs_select_admin"
  on public.corpus_cron_runs
  for select
  using (auth.uid() in (select id from public.admin_users));
```

> **Decision flagged:** the `admin_users` table is referenced but its creation is owned by Tier 0 / pre-existing infrastructure (already used for general admin gating). If it does not yet exist, this migration must declare it as a prerequisite, not create it inline. See Appendix B.

#### 3.1.4 Companion table: `public.tracked_niches`

The cron iterates a fixed set of niches. They are stored in a small reference table so the admin view can display them and so the cron can read them transactionally.

```sql
create table public.tracked_niches (
  id                    uuid primary key default gen_random_uuid(),
  niche_label           text not null unique check (char_length(niche_label) <= 200),
  search_queries        jsonb not null default '[]'::jsonb,  -- 3-5 query strings used by the cron's search.list calls
  is_launch_niche       boolean not null default false,      -- true for the 20 launch niches; affects priority
  enabled               boolean not null default true,
  added_at              timestamptz not null default now(),
  last_scraped_at       timestamptz
);

alter table public.tracked_niches enable row level security;

create policy "tracked_niches_select_authenticated"
  on public.tracked_niches
  for select
  using (auth.role() = 'authenticated');
```

**Seed.** The migration seeds 20 launch niches:

```
AI tools / productivity, Personal finance, Fitness, Tech reviews,
Indie SaaS dev, Cooking, Real estate, Crypto, Cars, Travel,
Gaming, Photography, Music production, Self-improvement, Parenting,
Outdoor / camping, Career advice, Language learning, Stocks / investing,
Beauty / skincare
```

For each niche, three search queries are seeded (e.g. AI tools / productivity → `"AI workflow tutorial"`, `"Claude Code tutorial"`, `"productivity AI tools 2026"`). The exact strings are tunable via the admin view but require no migration.

#### 3.1.5 Constraints and invariants

- `view_multiple >= 5.0` is enforced by check constraint. The cron's filter step (§5.7.4) refuses to insert anything below 5×.
- `(video_id) WHERE is_active = true` is unique. Re-scraping an already-indexed video is a no-op.
- `title_embedding` is `not null`; the cron must successfully embed before insertion. Embedding failures retry once, then drop the row (counted in `outliers_skipped`).
- `niche_embedding` is nullable in v2 and lazily populated by Feature #18. This spec writes it opportunistically when convenient (the cron has the niche string handy and may batch-embed niches separately) but **does not require** it for hybrid scoring.
- Soft-archive after 180 days: a daily job sets `is_active = false`, `archived_at = now()` for rows where `published_at < now() - interval '180 days'`. The unique-index `WHERE is_active = true` clause means archived rows can be re-inserted later under the same `video_id` if they re-emerge as outliers in a different time window — extremely unlikely but defensively allowed.

### 3.2 Extension to existing table: `public.pipeline_runs`

No schema change. This feature extends the **shape** of the JSONB column `pipeline_runs.score_data` — see §3.4.

### 3.3 Extension to existing table: `public.youtube_quota_usage`

The cron consumes the same daily quota counter that the hot path uses (CRIT-1 / CRIT-2). The table already exists from Tier 0; this spec adds a `consumer` column for telemetry:

```sql
alter table public.youtube_quota_usage
  add column if not exists consumer text not null default 'hot_path'
    check (consumer in ('hot_path', 'corpus_cron'));
```

The cron writes `consumer = 'corpus_cron'`. The hot path writes `consumer = 'hot_path'`. The 5,000-unit cap is enforced by reading the per-day sum where `consumer = 'corpus_cron'` (§5.7.5).

### 3.4 Score data shape: v1 → v2

The Zod schema for `pipeline_runs.score_data` is extended in `lib/validation/score.ts`. The v1 shape (Phase 1) and v2 shape (Phase 2) coexist; a discriminated union on the `version` literal handles both.

```typescript
// lib/validation/score.ts (Phase 2 additions)

import { z } from "zod";
import { ScoreDimensionsSchema, ReframeSchema } from "./score-v1";

/** Phase 1 schema, retained as v1 (kept for backward compatibility on legacy rows). */
export const ScoreDataV1Schema = z.object({
  version:             z.literal("v1"),
  finalScore:          z.number().int().min(0).max(100),
  dimensions:          ScoreDimensionsSchema,
  reasoning:           z.string().min(200).max(1800),
  passed:              z.boolean(),
  outlierPatternCount: z.number().int().nonnegative(),
  lowConfidence:       z.boolean(),
  reframes:            z.array(ReframeSchema).min(1).max(3).nullable(),
  reframeShortfall:    z.boolean(),
  scoredAt:            z.string().datetime(),
  model:               z.string(),
  durationMs:          z.number().int().nonnegative(),
});

/**
 * Each k-NN match shown to the user. The full neighbor set (top-20) is computed
 * and used for the empirical score; only the top 5 are persisted in score_data
 * for UI rendering. The remaining 15 stay in memory and are discarded after
 * scoring — Feature #17 has its own audit table for full-neighbor retention.
 */
export const CorpusMatchSchema = z.object({
  corpusId:           z.string().uuid(),
  videoId:            z.string().regex(/^[\w-]{11}$/),
  title:              z.string().min(1).max(500),
  channelTitle:       z.string().min(1),
  similarity:         z.number().min(0).max(1),                    // cosine, 0..1
  viewMultiple:       z.number().min(5).max(10000),
  publishedAt:        z.string().datetime(),
  /**
   * One-line "why match" extracted by the empirical-scoring service from the
   * archetype/title overlap heuristic in §5.5.4. ≤ 200 chars.
   */
  why:                z.string().min(8).max(200),
});

export const ConfidenceLevelSchema = z.enum(["high", "medium", "low"]);

export const ScoreWeightsSchema = z.object({
  llm:                z.number().min(0).max(1),
  empirical:          z.number().min(0).max(1),
});

/**
 * v2 — hybrid scoring. All v1 fields are preserved (so v1 readers that bother
 * to check `version` continue to work) plus the empirical extension.
 */
export const ScoreDataV2Schema = z.object({
  version:             z.literal("v2"),

  // ----- Carried forward from v1 -----
  finalScore:          z.number().int().min(0).max(100),           // = weightedFinal, integer-rounded
  dimensions:          ScoreDimensionsSchema,
  reasoning:           z.string().min(200).max(1800),
  passed:              z.boolean(),                                // weightedFinal >= GATE_THRESHOLD
  outlierPatternCount: z.number().int().nonnegative(),             // from competitor_data (Stage 3)
  lowConfidence:       z.boolean(),                                // = (confidence === 'low')
  reframes:            z.array(ReframeSchema).min(1).max(3).nullable(),
  reframeShortfall:    z.boolean(),
  scoredAt:            z.string().datetime(),
  model:               z.string(),
  durationMs:          z.number().int().nonnegative(),

  // ----- New in v2 -----
  /** 0–100. Same as Phase 1 finalScore — the LLM-only weighted average of dimensions. */
  llmScore:            z.number().int().min(0).max(100),
  /**
   * 0–100, computed in §5.5 from the k-NN neighbor distribution. null when
   * the empirical path was skipped (cold start, embedding failure, corpus
   * thin). When null, weightedFinal === llmScore and confidence is 'low'.
   */
  empiricalScore:      z.number().int().min(0).max(100).nullable(),
  /** Integer rounded weighted blend; equal to finalScore. Always present. */
  weightedFinal:       z.number().int().min(0).max(100),
  /** Weights applied. {0.4, 0.6} when blending; {1.0, 0.0} when fallback. */
  weights:             ScoreWeightsSchema,
  /** Top 5 corpus matches for UI display. Empty array when empirical was skipped. */
  corpusMatches:       z.array(CorpusMatchSchema).max(5),
  /**
   * Total neighbors above similarity floor in the niche slice; used for the
   * "18 / 20 above sim 0.75" UI strip.
   */
  neighborsAboveFloor: z.number().int().nonnegative(),
  /**
   * Confidence level — derived from neighborsAboveFloor and median similarity.
   * - 'high'   : >= 30 neighbors above sim floor with median sim >= 0.80
   * - 'medium' : 5..29 neighbors above sim floor (or sim density between thresholds)
   * - 'low'    : < 5 neighbors above sim floor, embedding failure, or cold start
   */
  confidence:          ConfidenceLevelSchema,
  /** Why we skipped the empirical path (null when not skipped). */
  fallbackReason:      z
    .enum(["cold_start", "corpus_thin", "embedding_failed", "vector_query_failed", "niche_unmapped"])
    .nullable(),
  /** Embedding model used for the idea (and for corpus rows). Frozen per row. */
  embeddingModel:      z.string(),
  /** Hash of (idea_text, niche) used for the embedding — enables idempotent re-scoring. */
  embeddingCacheKey:   z.string().regex(/^[a-f0-9]{64}$/),
});

export const ScoreDataSchema = z.discriminatedUnion("version", [
  ScoreDataV1Schema,
  ScoreDataV2Schema,
]);

export type ScoreDataV2     = z.infer<typeof ScoreDataV2Schema>;
export type CorpusMatch     = z.infer<typeof CorpusMatchSchema>;
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;
export type ScoreWeights    = z.infer<typeof ScoreWeightsSchema>;
```

**Read-side enforcement.** `lib/db/runs.ts` parses through the discriminated union; v1 rows parse as v1, v2 as v2. New writes always emit `version: "v2"`. **No row migration needed:** Phase 1 readers that read `finalScore` / `passed` continue to work; Phase 2 readers narrow on `version === "v2"`.

### 3.5 New table: `public.embedding_cache`

A small key-value cache so re-scoring an unchanged idea doesn't re-embed.

```sql
create table public.embedding_cache (
  cache_key       text primary key,                          -- sha256(idea_text + '|' + niche_label + '|' + model)
  embedding       vector(1536) not null,
  embedding_model text not null,                             -- 'text-embedding-3-small' (or alternative)
  created_at      timestamptz not null default now(),
  hit_count       integer not null default 0,
  last_hit_at     timestamptz
);

create index embedding_cache_created_at on public.embedding_cache (created_at desc);

alter table public.embedding_cache enable row level security;

-- Service role only; no end-user reads/writes.
-- Empty policy set means RLS denies all non-service access.
```

The service-layer wrapper in `lib/embeddings/cache.ts` writes `(cache_key, embedding)` on miss and increments `hit_count` + sets `last_hit_at` on hit. A nightly job evicts rows where `created_at < now() - interval '90 days' AND hit_count = 0` to bound the table size.

### 3.6 Constraints summary

- `score_data.version === "v2"` is the only value written by this feature; v1 remains valid for read.
- `weightedFinal` is computed in TypeScript from `llmScore` + `empiricalScore` + `weights`; the model never returns it.
- `passed` is `weightedFinal >= GATE_THRESHOLD`; computed in TypeScript, never trusted from any source.
- `corpusMatches.length <= 5`; the full top-20 neighbor list is **not** persisted in `score_data` (it would balloon the JSONB and we don't need it for replay — Feature #17 has its own table for that).
- `weights.llm + weights.empirical === 1.0` within float epsilon; runtime assertion.

---

## 4. API Endpoints

All routes are under `app/api/`. All require an authenticated session — middleware on the `(app)` route group rejects unauthenticated requests with `401 { code: "UNAUTHENTICATED" }`. RLS on `pipeline_runs` is enforced by the DB layer (SEC-2).

Field naming follows CLAUDE.md API-1: snake_case in DB and external APIs, camelCase in TypeScript code. Zod schemas perform the transform at the boundary.

### 4.1 `POST /api/pipeline/score` — extended (SSE)

**Auth:** required.

**Path:** unchanged from Phase 1 (`POST /api/pipeline/<stage>` per CLAUDE.md API-3).

**Request body:** unchanged.

```typescript
{ runId: string }
```

**Pre-flight checks:** identical to Phase 1 (Feature #05 §4.1) plus one addition.

7. Read `channels.niche` (already validated in pre-flight 5). Look up the niche in `tracked_niches` to get the canonical `niche_label`. If the niche has no canonical mapping (i.e. the user's free-text niche doesn't match any tracked niche), set `fallbackReason = 'niche_unmapped'` and short-circuit to LLM-only mode. The empirical path is skipped but the request still completes — this is **not** a `MISSING_PREREQUISITES` failure. (See §5.3 for the niche-resolution algorithm.)

**Response:** `text/event-stream`. The Phase 1 events are preserved. Three new events are interleaved:

```
event: progress
data: { "step": "loading_inputs", "status": "ok",
        "outlierPatternCount": 47, "lowConfidence": false,
        "nicheLabel": "AI tools / productivity",
        "corpusSize": 2184 }

event: progress
data: { "step": "embedding_idea", "status": "ok",
        "model": "text-embedding-3-small", "cached": false,
        "vectorDim": 1536, "durationMs": 412 }

event: progress
data: { "step": "knn_search", "status": "ok",
        "neighborsAboveFloor": 18, "topSim": 0.91, "medianSim": 0.83,
        "durationMs": 612 }

event: progress
data: { "step": "computing_empirical", "status": "ok",
        "empiricalScore": 91 }

event: progress
data: { "step": "scoring_dimensions_started", "status": "ok" }
   (... per-dimension events as Phase 1 ...)

event: progress
data: { "step": "computing_final_score", "status": "ok",
        "llmScore": 88, "empiricalScore": 91,
        "weights": { "llm": 0.4, "empirical": 0.6 },
        "weightedFinal": 90 }

event: progress
data: { "step": "evaluating_gate", "status": "ok",
        "passed": false, "threshold": 92 }

event: complete
data: <ScoreDataV2>
```

**Order of operations.** The empirical path (`embedding_idea` → `knn_search` → `computing_empirical`) runs in **parallel** with the LLM call (`scoring_dimensions_started` → ... ). Both are awaited before `computing_final_score`. The SSE stream serializes events in a deterministic order for UX clarity (mockup state 1: empirical events first, then LLM events) even when the LLM call returns earlier; events from the slower side of the parallel pair are buffered server-side and emitted after the faster side's events are fully flushed. The orchestrator does **not** simulate latency — it preserves real durations, just interleaves them in display order.

**Skipped-empirical path.** When the empirical step is skipped (cold start, niche unmapped, embedding failure, vector query failure, corpus thin), the SSE emits one event in place of the four parallel ones:

```
event: progress
data: { "step": "empirical_skipped", "status": "warn",
        "reason": "corpus_thin",
        "neighborsAboveFloor": 3 }
```

Then the run proceeds with LLM-only. The `computing_final_score` event reports `weights: { llm: 1.0, empirical: 0.0 }` and `weightedFinal === llmScore`.

**Error events.** All Phase 1 codes still apply. Two new fallback-only conditions exist that are **not** errors — they are warnings logged into `score_data.fallbackReason`:

- `cold_start` — corpus has < 100 total rows for this niche; expected during launch.
- `corpus_thin` — corpus has rows but < 5 neighbors above similarity floor for this idea.
- `embedding_failed` — OpenAI/Voyage call failed after retries.
- `vector_query_failed` — Postgres query timed out or errored.
- `niche_unmapped` — channel niche string doesn't match any tracked niche.

For `embedding_failed` and `vector_query_failed`, the SSE additionally emits:

```
event: progress
data: { "step": "empirical_degraded", "status": "warn",
        "reason": "embedding_failed", "fallbackTo": "llm_only" }
```

The UI renders mockup state 5 (auto-fallback engaged banner) when these specific reasons appear.

**Persistence.** On the `complete` event:

1. Validate the assembled `ScoreDataV2` against `ScoreDataV2Schema`.
2. Write `pipeline_runs.score_data = <ScoreDataV2>`. The `version` field on the row is `"v2"`.
3. Update `pipeline_runs.status` to `'scored'` (passing) or `'gated_failed'` (failing) — same as Phase 1.

If validation fails, the request errors with `INVALID_SCORE` and the row's `status` is set to `'errored'`. `score_data` remains `null`.

### 4.2 `POST /api/runs/[runId]/override-gate` — unchanged

The override flow from Feature #05 is unchanged. The override sets `gate_overridden_at` regardless of whether the underlying score was hybrid or LLM-only.

### 4.3 `DELETE /api/runs/[runId]/override-gate` — unchanged

### 4.4 `POST /api/runs/[runId]/apply-reframe` — unchanged

Reframe application proceeds as in Phase 1. The follow-up Stage 3 + Stage 4 run will produce a new v2 `score_data` against the reframed idea.

### 4.5 `GET /api/admin/corpus/health` — admin corpus health view

**Auth:** required + admin role check (the user's id must be in `public.admin_users`).

**Path:** `/api/admin/corpus/health`.

**Response:**

```typescript
// 200 OK
{
  totalOutliers:        number,                 // count(*) where is_active
  outliersAddedLast24h: number,                 // last cron's outliersAdded summed
  nichesCovered:        number,                 // count of tracked niches with > 0 active rows
  nichesTotal:          number,                 // count of enabled tracked niches
  thinNiches:           string[],               // niche_labels with 100..999 active rows
  emptyNiches:          string[],               // niche_labels with < 100 active rows
  lastCronRun: {
    id:                 string,
    startedAt:          string,                 // ISO 8601
    finishedAt:         string | null,
    status:             "running" | "success" | "partial" | "failed",
    durationMs:         number | null,
    outliersAdded:      number,
    youtubeQuotaUsed:   number,
    embeddingCalls:     number,
  },
  recentRuns:           CronRun[],              // last 10
  perNicheDensity: Array<{
    nicheLabel:         string,
    activeOutliers:     number,
    avgViewMultiple:    number | null,
    lastScrapedAt:      string | null,
    status:             "healthy" | "thin" | "empty",
  }>,
  calibrationDrift: {                           // optional in v2; present once Feature #17 lands
    currentDriftPts:    number | null,
    targetCeilingPts:   number,                 // 3.0
    sameIdeaVariancePts: number | null,
  },
  embeddingModel:       string,
}
```

**Errors:**

| Code | When | HTTP |
|---|---|---|
| `UNAUTHENTICATED` | no session | 401 |
| `FORBIDDEN` | session present but not in `admin_users` | 403 |
| `INTERNAL_ERROR` | DB query failed | 500 |

### 4.6 `POST /api/admin/corpus/cron` — manual cron trigger

**Auth:** required + admin role.

**Body:**
```typescript
{
  niches?: string[],     // optional; default = all enabled tracked niches
  budgetUnits?: number,  // optional; default = 5000 (the standard cron budget)
}
```

**Behavior:** Inserts a `corpus_cron_runs` row with `trigger_source = 'manual_admin'` and enqueues the cron job (the same job the schedule fires). The endpoint returns immediately — the cron itself runs in the background and updates the row when complete. Idempotency: only one cron run may be in `status = 'running'` at a time; a second trigger returns `409 { code: "CRON_ALREADY_RUNNING", currentRunId: "..." }`.

**Response:**
```typescript
// 202 Accepted
{ cronRunId: string }
```

### 4.7 `GET /api/admin/corpus/cron/[cronRunId]` — single cron run detail

**Auth:** required + admin role.

**Response:** the full `corpus_cron_runs` row plus a per-niche breakdown:

```typescript
{
  id: string,
  startedAt: string,
  finishedAt: string | null,
  status: "running" | "success" | "partial" | "failed",
  niches: Array<{
    nicheLabel: string,
    outliersAdded: number,
    quotaUsed: number,
    durationMs: number,
  }>,
  errors: Array<{ niche: string, message: string, at: string }>,
  youtubeQuotaUsed: number,
  embeddingCalls: number,
}
```

### 4.8 `POST /api/admin/corpus/reembed` — re-embed corpus (rare)

**Auth:** required + admin role.

**Body:**
```typescript
{
  newModel: string,   // e.g. "voyage-3" — must be in lib/embeddings/models.ts allowlist
  dryRun?: boolean,   // default false — when true, returns count + estimated cost without touching the table
}
```

**Behavior:** queues a background job that re-embeds every `is_active = true` row with the new model and updates `title_embedding`. The HNSW index is dropped and rebuilt at the end. **This endpoint is rate-limited to once per 24h per admin** to prevent accidental cost-explosion (re-embedding the full corpus is the most expensive single operation in the system).

**Response:**
```typescript
// 202 Accepted
{ jobId: string, estimatedRows: number, estimatedCostUsd: number }
```

### 4.9 Field naming summary

| Layer | Convention |
|---|---|
| HTTP request/response JSON | camelCase |
| SSE event payloads | camelCase |
| DB columns | snake_case (`title_embedding`, `view_multiple`) |
| Inside JSONB columns | camelCase (`empiricalScore`, `corpusMatches`) — same convention as v1 meta keys |

The v1 dimension keys remain snake_case (`hook_strength` etc.) to match the prompt's emitted JSON; this is a Phase 1 carry-over and not changed.

---

## 5. Business Logic

### 5.1 Embedding model decision (deferred until pgvector POC)

MVP default: **OpenAI `text-embedding-3-small`** (1536 dim, $0.020/1M tokens). Alternatives:

| Model | Dim | $/1M tok | Notes |
|---|---|---|---|
| `text-embedding-3-small` (OpenAI) | 1536 | $0.020 | **Default.** Cheap, sufficient for title-level similarity. |
| `text-embedding-3-large` (OpenAI) | 3072 | $0.130 | Title-level gain over -small is small at our scale. |
| `voyage-3` (Voyage AI) | 1024 | $0.060 | Strong benchmarks; smaller dim helps index size. |
| `embed-v3` (Anthropic, when GA) | TBD | TBD | Strategic alignment but not yet GA-priced. |

**Decision flagged in Appendix B (D-1).** Final choice gated on a 1-week POC measuring p95 latency, recall@20 against a 50-pair golden set, and per-month cost. The `embeddingModel` field in `score_data` and `outlier_corpus.embedding_model` make the choice swappable; a corpus re-embed (§4.8) migrates rows.

The pgvector index is dim-locked at 1536 in the launch migration. A non-1536-dim model later requires an additional column + HNSW index in a follow-up migration. `OPENAI_API_KEY` / `VOYAGE_API_KEY` join the env-var lock-in (validated by `lib/env.ts` at boot).

### 5.2 Inputs and pre-conditions (extends Feature #05 §5.1)

Stage 4 reads:

| Input | Source | Required | Notes |
|---|---|---|---|
| `idea_text` | `pipeline_runs.idea_text` | yes | Phase 1 contract |
| `competitor_data` | `pipeline_runs.competitor_data` | yes | Phase 1 contract |
| `niche` | `channels.niche` | yes | Phase 1 contract; resolved to canonical `tracked_niches.niche_label` per §5.3 |
| `channelTitle` | `channels.title` | yes | Phase 1 contract |
| `channelMedianViews` | `channels.median_views` | optional | Phase 1 contract |
| `embedding(idea_text, niche)` | `embedding_cache` or fresh call | yes | Phase 2 — required for empirical path |
| `tracked_niches` row matching `niche` | `tracked_niches` | optional | absent → `fallbackReason = 'niche_unmapped'` |

### 5.3 Niche resolution

The user's `channels.niche` is free text up to 200 characters. The cron's tracked niches are a finite enumerated set (initially 20). The empirical path needs to slice `outlier_corpus` by `niche_label`, so we resolve the user's niche to a canonical tracked niche.

Algorithm (`lib/services/niche-resolver.ts`):

1. **Exact-match shortcut.** If `channels.niche` (lowercased + trimmed) equals any `tracked_niches.niche_label` (lowercased + trimmed), return that row.
2. **Embedding-similarity match.** Embed the user's niche string (cached separately in `embedding_cache` keyed by the niche string + a synthetic prefix `niche::`). Compute cosine similarity against each tracked-niche embedding (also cached, populated by the cron when a niche is added). If the top match has similarity ≥ `0.82`, return it.
3. **No match.** Return `null`. The caller sets `fallbackReason = 'niche_unmapped'`.

The `0.82` threshold is a constant in `lib/config.ts.NICHE_RESOLUTION_THRESHOLD`. It is tuned against a hand-curated golden set during the POC.

**Why we don't fail.** `niche_unmapped` is a graceful degradation. The user keeps getting Phase 1 scoring; we log the unmapped niche to a `unmapped_niche_log` table for product review and possible inclusion in `tracked_niches`.

### 5.4 Embedding the idea

Embedded as `idea_text + " " + niche_label` (canonical niche, not free text) — concatenation gives a stable per-niche prior so identical ideas in different niches don't collide.

**Cache key:** `sha256(ideaText + "|" + nicheLabel + "|" + embeddingModel)` — 64-char hex, matches `embedding_cache.cache_key` and `score_data.embeddingCacheKey`.

**Service wrapper** (`lib/embeddings/cached.ts`):

```typescript
async function embedIdea(input: {
  ideaText: string;
  nicheLabel: string;
  model: string;
}): Promise<{ vector: number[]; cached: boolean; durationMs: number }> {
  const cacheKey = sha256(`${input.ideaText}|${input.nicheLabel}|${input.model}`);
  const hit = await db.embeddingCache.findOne({ cache_key: cacheKey });
  if (hit) {
    await db.embeddingCache.update(cacheKey, {
      hit_count: hit.hit_count + 1,
      last_hit_at: new Date(),
    });
    return { vector: hit.embedding, cached: true, durationMs: 0 };
  }

  const start = Date.now();
  const vector = await callEmbeddingProvider(input.ideaText + " " + input.nicheLabel, input.model);
  const durationMs = Date.now() - start;

  await db.embeddingCache.upsert({
    cache_key: cacheKey,
    embedding: vector,
    embedding_model: input.model,
  });

  return { vector, cached: false, durationMs };
}
```

**Retries:** EXT-3 — exponential backoff on 429/529, max 3 retries. Final failure throws `EMBEDDING_FAILED`; score service records `fallbackReason = 'embedding_failed'` and proceeds LLM-only. **Cost:** ~$0.0000006 per fresh embed; expected ≥60% cache hit at steady state.

### 5.5 k-NN search and empirical scoring

#### 5.5.1 The query


```sql
-- lib/db/corpus.ts — buildKnnQuery
select
  oc.id,
  oc.video_id,
  oc.channel_id,
  oc.title_text,
  oc.view_multiple,
  oc.published_at,
  oc.title_embedding <=> $1 as cosine_distance     -- pgvector operator
from public.outlier_corpus oc
where oc.is_active = true
  and oc.niche_label = $2
  and oc.published_at >= now() - interval '180 days'
order by oc.title_embedding <=> $1
limit 20;
```

Cosine *distance* = 1 - cosine *similarity*. We compute similarity as `1 - distance` in the application layer.

**Index tuning.** `set local hnsw.ef_search = 80;` (vs default 40) widens the beam — empirically near the knee of recall-vs-latency at our scale. `set local statement_timeout = '5s';` bounds the worst case; on timeout → `vector_query_failed`.

**Channel-fetch enrichment.** The SQL doesn't return channel titles. After the query the service issues one batched `lib/youtube/cached.ts` `channels.list` (1 unit, 24h TTL, CRIT-1 compliant) — the **only** YouTube call in the hybrid hot path.

#### 5.5.2 Confidence determination

```typescript
const aboveFloor = neighbors.filter(n => n.similarity >= 0.75);
const medianSim = median(aboveFloor.map(n => n.similarity));

const confidence: ConfidenceLevel =
    aboveFloor.length >= 30 && medianSim >= 0.80 ? "high"
  : aboveFloor.length >= 5  && medianSim >= 0.75 ? "medium"
  : "low";
```

When `confidence === "low"`, the empirical path is **skipped** for scoring purposes (`empiricalScore = null`, `weights.llm = 1.0`), but the matches array is still populated (so the UI can show "available matches for transparency, not used for scoring" — mockup state 3).

When `confidence === "high"` or `"medium"`, the empirical score is computed and blended.

**Threshold rationale.** The 30-neighbor threshold is the MVP default — it's the floor below which the empirical signal becomes too noisy to be trustworthy. The 5-neighbor threshold is the absolute minimum below which we don't bother computing an empirical number at all (matches are shown for transparency only). Both numbers are constants in `lib/config.ts` and Feature #17 may tune them per niche; this spec ships static defaults.

#### 5.5.3 The empirical score formula

The empirical score is a **0–100 number derived from the k-NN distribution**. It is **not** a base rate alone; it composites three signals:

```typescript
// lib/services/empirical-score.ts

type Neighbor = {
  similarity: number;        // 0..1
  viewMultiple: number;      // ≥ 5
  publishedAt: Date;
};

export function computeEmpiricalScore(
  aboveFloor: Neighbor[],
  full: Neighbor[],
): { empiricalScore: number; baseRate: number; medianMultiple: number; recencyBonus: number } {
  // Signal 1 — base rate: fraction of top-20 that are above the strong-similarity threshold (0.80).
  // Approximates "of similar-pattern ideas, what fraction broke out?"
  const strongSim = full.filter(n => n.similarity >= 0.80);
  const baseRate = strongSim.length / full.length;       // 0..1
  const baseRateScore = Math.round(baseRate * 100);      // 0..100

  // Signal 2 — magnitude: median view_multiple of the 5 nearest neighbors.
  // Scaled: 5× → 50, 10× → 80, 15× → 95, capped at 100.
  const top5 = aboveFloor.slice(0, 5);
  const medianMultiple = median(top5.map(n => n.viewMultiple));
  const magnitudeScore = Math.min(100, Math.round(50 + (medianMultiple - 5) * 6));

  // Signal 3 — recency bonus: are recent neighbors (last 30d) more dense than older?
  // Compares neighbor density in the last 30d vs. the full 180d window.
  // Returns a multiplier in [0.95, 1.05].
  const recent = aboveFloor.filter(n =>
    n.publishedAt >= new Date(Date.now() - 30 * 24 * 3600 * 1000));
  const recentDensity = recent.length / Math.max(1, aboveFloor.length);
  const baselineDensity = 30 / 180;                      // expected fraction if uniform
  const recencyBonus = Math.max(0.95, Math.min(1.05, recentDensity / baselineDensity));

  // Composite — weighted blend of base rate and magnitude, scaled by recency.
  const composite = Math.round((0.6 * baseRateScore + 0.4 * magnitudeScore) * recencyBonus);
  const empiricalScore = Math.max(0, Math.min(100, composite));

  return { empiricalScore, baseRate, medianMultiple, recencyBonus };
}
```

The 0.6/0.4 sub-weights are chosen so a niche with ~30 strong-sim neighbors at median 7× lands ~89 (matches the mockup state 2 "passes" example); a thin-but-extreme outlier (1 match at 50×) caps composite ~43 (well below gate); a dying-pattern niche gets a ~5% penalty.

Constants in `lib/config.ts`:

```typescript
export const EMPIRICAL_SUBWEIGHTS = { baseRate: 0.6, magnitude: 0.4 } as const;
export const SIM_FLOOR = 0.75 as const;
export const SIM_STRONG = 0.80 as const;
export const HIGH_CONFIDENCE_NEIGHBOR_MIN = 30 as const;
export const MEDIUM_CONFIDENCE_NEIGHBOR_MIN = 5 as const;
export const HIGH_CONFIDENCE_MEDIAN_SIM = 0.80 as const;
export const MEDIUM_CONFIDENCE_MEDIAN_SIM = 0.75 as const;
export const RECENCY_WINDOW_DAYS = 30 as const;
```

#### 5.5.4 The "why match" string

For the top 5 neighbors persisted in `score_data.corpusMatches`, we render a one-line `why` string. Generation is **template-based**, not LLM-based, to keep the path fast and deterministic.

```typescript
function generateWhyMatch(
  idea: string, niche: string, neighbor: Neighbor & { title: string },
): string {
  // Template: "{archetype-cue from idea-vs-neighbor lexical overlap} + {time/quantity anchor} + {niche framing}"
  const overlap = jaccardTokens(idea, neighbor.title, { stopwords: NICHE_STOPWORDS });
  if (overlap.size === 0) {
    return `Embedding match — semantic similarity ${neighbor.similarity.toFixed(2)}.`;
  }
  // ... pick top-3 overlapping content tokens, format as "X + Y + Z"
}
```

Implementation detail; the contract is "≤ 200 chars, deterministic, doesn't hit the LLM." Future enhancement (Feature #18) may upgrade this to a niche-vocabulary-aware string.

### 5.6 Blending — the hybrid weighted final

```typescript
// lib/services/score.ts — hybrid extension

export const HYBRID_WEIGHTS = { llm: 0.4, empirical: 0.6 } as const;
export const FALLBACK_WEIGHTS = { llm: 1.0, empirical: 0.0 } as const;

function computeWeightedFinal(
  llmScore: number,
  empiricalScore: number | null,
  confidence: ConfidenceLevel,
): { weightedFinal: number; weights: ScoreWeights } {
  if (empiricalScore === null || confidence === "low") {
    return { weightedFinal: llmScore, weights: FALLBACK_WEIGHTS };
  }
  const raw =
    HYBRID_WEIGHTS.llm * llmScore +
    HYBRID_WEIGHTS.empirical * empiricalScore;
  return { weightedFinal: Math.round(raw), weights: HYBRID_WEIGHTS };
}
```

Why empirical gets the larger weight: it's the defensibility signal and is calibrated by construction (a 91 means "91-out-of-100 along the niche's actual distribution"). LLM keeps material weight (0.4) because it sees signals the embedding can't isolate — title cleverness, structural features, on-niche-vs-adjacent fit. Feature #17 may shift these per niche; static defaults are the contract this spec ships.

### 5.7 Nightly cron architecture

#### 5.7.1 Runtime choice

The cron runs as a **Supabase Edge Function** scheduled via `pg_cron` at four times daily: `00:30 UTC`, `06:30 UTC`, `12:30 UTC`, `18:30 UTC` (off-hour offsets to avoid noisy YouTube quota windows). Edge Functions co-locate with the DB, run independently of Next.js cold-starts, and use the service-role client directly. Vercel Cron is the fallback if Edge Functions hit a 60s execution limit; both options sit behind `lib/cron/scheduler.ts`. **Decision flagged in Appendix B.**

#### 5.7.2 Cron configuration in code

```typescript
// supabase/functions/corpus-cron/index.ts (Edge Function entrypoint)
// Adapted from no third-party reference — original to this codebase.

import { runCorpusCron } from "@/lib/services/corpus-cron";

Deno.serve(async (req) => {
  // Verify the call comes from Supabase's cron infrastructure (HMAC header).
  if (!verifyCronSignature(req)) return new Response("Forbidden", { status: 403 });

  const result = await runCorpusCron({
    triggerSource: "schedule",
    budgetUnits: 5_000,         // 50% of daily quota; further capped to 70% by §5.7.5
    batchSize: 200,             // videos per run
  });

  return new Response(JSON.stringify(result), {
    headers: { "content-type": "application/json" },
  });
});
```

#### 5.7.3 Per-run flow

`lib/services/corpus-cron.ts`:

1. **Insert `corpus_cron_runs` row** with `status = 'running'`, `trigger_source`.
2. **Read tracked niches** ordered by `last_scraped_at asc nulls first` (round-robin: niches that haven't been scraped recently go first).
3. **For each niche**, until budget exhausted:
   - Run the niche's seeded `search_queries` via the cached YouTube wrapper (`lib/youtube/cached.ts`). One `search.list` call per query — 100 units each.
   - For each candidate videoId returned, batch-`videos.list` (1 unit per batch of 50) to fetch view counts and published timestamps.
   - For each candidate's channel, fetch channel median views (cached 24h per CRIT-1's existing wrapper).
   - Compute `view_multiple = view_count / channel_median_views`.
   - Apply filters (§5.7.4).
   - Embed surviving titles in batch (`POST /v1/embeddings` with up to 256 inputs per request — single call when batch fits).
   - Insert into `outlier_corpus` (idempotent on `video_id`; on conflict do nothing).
   - Update `tracked_niches.last_scraped_at = now()`.
4. **Soft-archive** rows where `published_at < now() - interval '180 days'` if any (this is cheap and runs every cron, not nightly separately).
5. **Update `corpus_cron_runs`** with totals + `status = 'success' | 'partial' | 'failed'` and `finished_at`.

Expected duration: 3–5 min for 20 niches × 200 candidates.

#### 5.7.4 Filters (the "is this really an outlier" gate)

Before insertion, each candidate must pass:

| Filter | Reject when | Reason |
|---|---|---|
| **Multiplier** | `view_multiple < 5.0` | Not an outlier by definition |
| **Recency** | `published_at < now() - 180d` | Out of window |
| **Duration** | `duration < 60s` | Skip Shorts (different algorithm cluster) |
| **Inflated** | `view_count > 1000 * channel_median_views` | Likely livestream replay or accidental algorithm boost; logged as `filter_reason = 'inflated'` |
| **Livestream** | `liveBroadcastContent != 'none'` (from videos.list) | Not regular content |
| **Language** | title not detected as English (Phase 2 ships English-only corpus) | Out of scope; logged `filter_reason = 'language'` |
| **Duplicate** | `video_id` already in `outlier_corpus` with `is_active = true` | Idempotency |

Filtered candidates are counted in `corpus_cron_runs.outliers_skipped`. The `filter_reason` column on `outlier_corpus` stores the reason for non-active rows the cron decides to keep for audit (currently only `'inflated'`; others are dropped without a row).

#### 5.7.5 Quota enforcement (CRIT-1 / never-compete-with-hot-path)

Before each YouTube call, the cron checks its per-consumer daily total:

```typescript
const used = await db.youtubeQuotaUsage.sumForToday({ consumer: 'corpus_cron' });
if (used + estimatedUnits > CORPUS_CRON_DAILY_BUDGET) {
  // CORPUS_CRON_DAILY_BUDGET = 5000 (per-consumer cap; hot path's 8K cap is shared)
  await markCronPartial(cronRunId, "budget_exhausted");
  return;
}
```

The PRD's "stops at 70%" and our 5K cron cap are equivalent under bounded hot-path usage. We encode the cron cap as a hard ceiling because it's testable. The hot path's existing 8K total cap (sum across all consumers) is unchanged. Cron + hot path together remain bounded by the 10K daily quota.

#### 5.7.6 Embedding batching

Batched up to 256 inputs/call (OpenAI hard limit is 2048; 256 for predictable latency). One batch per niche typically. On failure: retry once, drop the batch, continue. Cost: ~$0.20/run × 4 = $0.80/day = ~$292/year — negligible.

#### 5.7.7 Failure modes

| Failure | Behavior |
|---|---|
| Single niche errors | Logged in `corpus_cron_runs.error_message` (appended), cron continues with next niche, final `status = 'partial'` |
| Embedding service down | Niches that haven't been processed are skipped; final `status = 'partial'` if any niche succeeded, `'failed'` if none did |
| YouTube quota exhausted mid-run | Cron stops, marks `status = 'partial'`, sets `error_message = 'quota_exhausted'` |
| Cron times out (Edge Function 60s limit) | Cron writes `status = 'partial'` from a `try/finally` block; resumes on next schedule |
| Cron crashes hard | The `corpus_cron_runs` row remains in `status = 'running'` past the expected window. The next scheduled run sees a stale `'running'` row > 30 minutes old, marks it `'failed'`, and proceeds. |

### 5.8 Opportunistic side-write from Stage 3

When Stage 3 finds outliers in the user's niche that aren't yet in `outlier_corpus`, the service writes them. Zero additional YouTube quota (Stage 3 already has the data); accelerates corpus growth in active niches.

```typescript
// In lib/services/competitor.ts — after persisting competitor_data
if (FEATURE_FLAGS.HYBRID_SCORING_ENABLED) {
  await sideWriteOutliers({
    runId, nicheLabel: resolvedNicheLabel,  // null → skip
    outliers: stageThreeOutputs.outliers,
  });
}
```

`sideWriteOutliers` filters `view_multiple >= 5` and last 180d, embeds in batch (one call), inserts with `scrape_source = 'pipeline_side_write'` and `source_run_id = runId`. On conflict: skip. Side-write runs after `competitor_data` is persisted but before orchestrator advances to Stage 4. Failures are logged, never block the run.

### 5.9 Anthropic call extension (LLM component, Phase 2 form)

The Stage 4 system prompt **does not change** (cache hit preserved). Only the user-prompt builder gains a conditional section.

```
<run_context>...</run_context>

<idea_text>...</idea_text>

<outlier_corpus count="...">
  ... (Phase 1 content from competitor_data)
</outlier_corpus>

{when empirical signals are available — confidence ∈ {high, medium}:}
<empirical_signals>
  Top {N} corpus matches in your niche by similarity. These come from a
  nightly-built dataset of real YouTube outliers (≥5× channel median in last
  180 days). Do NOT compute the empirical score yourself — the engine does
  that deterministically. Use these as additional context for your reasoning
  paragraph.

  {for each of top 5 corpus matches:}
  <match similarity="0.91" view_multiple="8.4">
    <title>{title_text}</title>
    <channel>{channel_title}</channel>
    <published_days_ago>{days}</published_days_ago>
  </match>

  <empirical_summary>
    base_rate={baseRate}    median_multiple={medianMultiple}
    neighbors_above_floor={count}  median_similarity={medianSim}
  </empirical_summary>
</empirical_signals>

<task>
  ...
</task>
```

**Why pass empirical signals to Opus.** (1) The `reasoning` paragraph cites matched neighbors ("this idea echoes the 'X built Y in Z hours' archetype that's hit 5× three times in your niche"). (2) Reframes pull from empirical archetypes, dramatically improving usability.

**What we don't do.** Opus does **not** compute the empirical score, choose weights, or override the blend. TS does all numeric work; Opus reads, reasons, generates dimensions + reframes.

The existing prompt-injection defense is augmented with one line about `<empirical_signals>` — same treatment as `<idea_text>`. Single-line edit; cache_control preserved.

### 5.10 Final assembly

`lib/services/score.ts` (Phase 2 extension):

```typescript
async function scoreV2(runId: string): Promise<ScoreDataV2> {
  const inputs = await loadInputs(runId);
  const niche = await resolveNiche(inputs.channelNiche);
  // niche is null if unmapped → fallbackReason = 'niche_unmapped'

  // Run empirical and LLM in parallel.
  const [empirical, llm] = await Promise.all([
    runEmpiricalPath(inputs, niche).catch(toFallback),
    runLlmCall(inputs),
  ]);

  // empirical = { empiricalScore, corpusMatches, neighborsAboveFloor, confidence, fallbackReason } | null

  const llmScore = computeFinalScore(llm.dimensions);
  const { weightedFinal, weights } = computeWeightedFinal(
    llmScore,
    empirical?.empiricalScore ?? null,
    empirical?.confidence ?? "low",
  );

  const passed = weightedFinal >= GATE_THRESHOLD;

  // Reframes: if not passed, ensure 3 (one follow-up call if the first didn't include them).
  const reframes = passed ? null : await ensureReframes(llm, llmScore, /* hint: */ empirical?.corpusMatches);

  const scoreData: ScoreDataV2 = {
    version: "v2",
    finalScore: weightedFinal,
    weightedFinal,
    llmScore,
    empiricalScore: empirical?.empiricalScore ?? null,
    weights,
    dimensions: llm.dimensions,
    reasoning: llm.reasoning,
    passed,
    outlierPatternCount: inputs.competitorData.outlierCount,
    lowConfidence: (empirical?.confidence ?? "low") === "low",
    confidence: empirical?.confidence ?? "low",
    corpusMatches: empirical?.corpusMatches ?? [],
    neighborsAboveFloor: empirical?.neighborsAboveFloor ?? 0,
    fallbackReason: empirical?.fallbackReason ?? null,
    embeddingModel: inputs.embeddingModel,
    embeddingCacheKey: inputs.embeddingCacheKey,
    reframes,
    reframeShortfall: !passed && (reframes?.length ?? 0) < 3,
    scoredAt: new Date().toISOString(),
    model: "claude-opus-4-7",
    durationMs: Date.now() - inputs.startedAt,
  };

  await db.runs.writeScoreData(runId, scoreData, passed);
  if (passed) await orchestrator.advanceFrom(runId, 4, { gateOverridden: false });

  return scoreData;
}
```

Notes: `Promise.all` runs both paths concurrently — total wall-clock is `max(empirical, llm)`, typically ~12s (LLM-dominated). `runEmpiricalPath(...).catch(toFallback)` downgrades embedding/query failures to LLM-only without breaking the run. `ensureReframes` (Feature #05 §5.5.4) is unchanged; the hint argument lets the follow-up reframe call cite empirical archetypes when present.

### 5.11 Gate evaluation and orchestrator handoff (unchanged)

`weightedFinal >= GATE_THRESHOLD` is the same condition Feature #05 documents (v2 sets `finalScore = weightedFinal`). Orchestrator code is unchanged — it reads `score_data.passed` as before.

### 5.12 Re-scoring an existing run

Same UX as Phase 1. Embedding cache hits → no fresh embed; k-NN re-runs (corpus may have grown); Opus call runs at full cost. Net re-score cost: ~$0.10 (Opus) + ~$0.001 (occasional channel-fetch miss) + 0 (embedding hit).

### 5.13 Cold start strategy

When a niche has < 100 active corpus rows, the empirical path is skipped (`fallbackReason = 'cold_start'`); UI shows mockup state 4. **Backfill plan:** trigger the manual cron 2–3× pre-launch to populate each launch niche with ~5K outliers. Edge-case niches outside the launch 20 see cold-start; admins backfill targeted niches via `POST /api/admin/corpus/cron` with `niches: [...]`.

---

## 6. State Management

### 6.1 Server state

Authoritative for: `outlier_corpus`, `tracked_niches`, `corpus_cron_runs`, `embedding_cache`, and v2 fields in `pipeline_runs.score_data`. Corpus writes are cron + Stage 3 side-write (both service-role); end users read-only via RLS. Score-service request handlers are stateless — no in-memory state survives a request.

### 6.2 Client state

Same as Feature #05: `pipeline_runs` row drives the UI; v2 fields (`corpusMatches`, `confidence`, `weights`, `weightedFinal`) are rendered by `StageScoreCard.tsx`. The admin view polls `/api/admin/corpus/health` every 30s via TanStack Query.

### 6.3 Optimistic updates

- **"Trigger cron now"** (admin): UI shows a `'running'` row immediately, replaced when API responds. 409 → snap back + toast.
- **"Re-score"**: same pattern as Phase 1.
- **Score-card rendering**: no optimistic state — waits for SSE `complete`.

---

## 7. UI/UX Behavior

### 7.1 Routes

| Route | Auth | Purpose |
|---|---|---|
| `/runs/[runId]` | required | Renders the v2 score card states from the mockup. |
| `/admin/corpus` | required + admin | Mockup state 6: corpus health view. |
| `/admin/corpus/runs/[cronRunId]` | required + admin | Per-cron-run drilldown. |

### 7.2 Score card states (mockup mapping)

The `StageScoreCard.tsx` component is extended to handle six v2 states in addition to the Phase 1 nine states. Total state count for v2 mode: nine Phase 1 states + six new ones, but most overlap — the rendering logic is a single switch on `(status, confidence, fallbackReason)`.

| Mockup state | Trigger | Notes |
|---|---|---|
| **State 1** — Loading | `status === 'scoring'` | Mockup state 1 — adds the "Matching against N outliers" scanning bar; subscribes to SSE; renders streaming neighbors as they arrive. |
| **State 2** — Hybrid pass | `status === 'scored' && confidence !== 'low' && passed` | Mockup state 2 — three-card breakdown (LLM / Empirical / Weighted). Reference outliers section with top 5 matches. |
| **State 3** — Corpus thin | `confidence === 'low' && fallbackReason === 'corpus_thin'` | Mockup state 3 — "Limited reference data" amber banner. Empirical card grayed out with "Insufficient corpus density." Falls back to LLM-only score. Available matches (the < 5 we did find) shown for transparency. |
| **State 4** — Cold start | `confidence === 'low' && fallbackReason === 'cold_start'` | Mockup state 4 — "Outlier corpus is initializing" + niche-build progress bar. Two CTAs: "Score with LLM-only for now" + "Notify me when ready." Notify-me adds the user to a per-niche notification list (out of scope for this spec to implement; CTA is a stub that toasts "we'll email you" — full impl is Feature #17 follow-on). |
| **State 5** — Service error fallback | `fallbackReason === 'embedding_failed' \|\| fallbackReason === 'vector_query_failed'` | Mockup state 5 — rose error banner ("Empirical scoring temporarily unavailable") + auto-fallback ribbon. Retry hybrid scoring CTA re-calls `/api/pipeline/score`. |
| **State 6** — Admin corpus health | `/admin/corpus` route | Mockup state 6 — the full admin dashboard. Top metrics, per-niche density table, cron history, calibration drift. |
| **(Phase 1 carry-overs)** | gated, overridden, low-confidence, errors, partial reframes | Reuse Feature #05 §7 behavior. The "low confidence" Phase 1 state and the "corpus thin" Phase 2 state are **distinct** — the former is about Stage 3 outlier sparsity, the latter about corpus density. UI shows different copy for each but same visual treatment. |

### 7.3 Loading + progress (mockup state 1)

The streaming neighbors list ("→ I cloned Notion in 4 hours...") is fed by the SSE `knn_search` event's progressive payloads. The server emits one `knn_match` sub-event per discovered neighbor (up to top-20) at ~80ms intervals after the SQL query completes — server-side simulation, same pattern as Feature #05's dimension streaming. The full list is held in memory and committed at `complete`.

The "scanning bar" animation is purely CSS — not driven by server progress.

### 7.4 Hybrid pass card (mockup state 2)

Three-column layout: (1) **LLM card** — purple-themed; `llmScore`, `40%` weight badge, three reasoning bullets from `score_data.reasoning`. (2) **Empirical card** — emerald-themed; `empiricalScore`, `60%` weight badge, three stat bullets (base rate, median multiple, recency trend). (3) **Weighted final card** — yt-red-themed; `weightedFinal`, "0.4 × LLM + 0.6 × Empirical" caption, PASS pill, gate/variance stats.

Below: confidence strip (high → 3 emerald dots, medium → 2 amber, low → 1 amber) with base-rate pill. Reference outliers section renders `score_data.corpusMatches` (top 5) with `viewMultiple` block, title + channel + age, "Why match" line, similarity badge, YouTube "Open ↗" link.

CTAs: same as Phase 1 (Re-score / Continue to titles).

### 7.5 Corpus-thin card (mockup state 3)

Amber banner: "Limited reference data for this niche / Only N strong matches above sim 0.75. We need ≥5 for calibrated empirical scoring." `LLM-ONLY FALLBACK` + `CONFIDENCE: LOW` pills, amber score badge. Empirical card greyed out with insufficient-density message. "Available matches (N)" section — "Shown for transparency, not used for scoring." CTAs: "Try adjacent niche" + "Continue with LLM-only score."

### 7.6 Cold-start card (mockup state 4)

Centered card with clock icon, `CORPUS` + `COLD START` + `FIRST CRON IN ~Xh` pills, heading "Outlier corpus is initializing." Progress block: `0 / 20 niches`, fills as each niche gains ≥100 active rows. Sub-stats: first-cron timestamp, coverage target. CTAs: "Score with LLM-only for now" (primary) + "Notify me when ready" (stub). Launch-niches pill grid below.

### 7.7 Service-error fallback card (mockup state 5)

Rose error banner ("Empirical scoring temporarily unavailable / `529 — overloaded` after 3 retries"). "Auto-fallback engaged" card with three-item checklist: LLM-only score will be produced; confidence dropped to low; service health stats (from `lib/embeddings/health.ts` — in-memory ring buffer, reset on deploy). "Error trace" block — admin-only render. CTAs: "Continue with LLM-only score" + "Retry hybrid scoring."

### 7.8 Admin corpus health view (mockup state 6, `/admin/corpus`)

App-nav with `ADMIN` pill (Runs / Users / Corpus active / Calibration). Header right: "Trigger cron now" + "Re-embed corpus" buttons. Page header: title + status pill.

**Top metrics (4 cards):** total outliers, niches covered (N/20), last cron run, calibration drift.
**Per-niche density table:** Niche / density bar / outliers / avg multiple / Status (OK / THIN / EMPTY).
**Cron history:** last 5 runs (dots, timestamp, +outliers, duration).
**Calibration drift:** Hybrid current / LLM-only baseline / target ceiling bars + same-idea variance + hit rate + embedding model.

Behavior: clicking a niche row → `/admin/corpus/niches/[label]` (stub); clicking a cron run → `/admin/corpus/runs/[cronRunId]` (§4.7); "Trigger cron now" → `POST /api/admin/corpus/cron`, polls 5s for status; "Re-embed corpus" → confirmation modal with cost estimate, confirms via `POST /api/admin/corpus/reembed`.

### 7.9 Non-admin error visibility

Non-admin users see only the friendly banner / state when something goes wrong. They do **not** see the trace or service-health stats. The trace block in mockup state 5 is conditionally rendered behind an `isAdmin` check on the user.

### 7.10 SEO / metadata changes

`/admin/corpus` is `noindex, nofollow` and behind auth. No change to public-page metadata.

---

## 8. Edge Cases

| Case | Behavior |
|---|---|
| Cold start — corpus has 0 rows | All runs use LLM-only. UI shows mockup state 4. `fallbackReason = 'cold_start'`. |
| Cold start — corpus has < 100 rows for the niche but > 0 globally | Same: `fallbackReason = 'cold_start'`. State 4 still applies because the user's niche is what matters. |
| Niche unmapped (free-text doesn't match any tracked niche) | `fallbackReason = 'niche_unmapped'`. UI shows state 3 variant with copy: "Your niche '<X>' isn't in our tracked set yet — falling back to LLM-only." Niche logged to `unmapped_niche_log`. |
| User edits niche between runs | The new niche is re-resolved per call. Cached embedding for the old (idea, niche) tuple is preserved but unused; the new tuple gets a fresh embedding. |
| Stage 3 returned 0 outliers | `MISSING_PREREQUISITES` per Phase 1. Hybrid path doesn't help — Stage 3 is upstream. |
| Stage 3 returned ≥ 1 outlier but corpus is thin | Hybrid path falls back to LLM-only with `fallbackReason = 'corpus_thin'`. Stage 3's grounding is still used by Opus. |
| Embedding cache hit / miss | `cached: true / false` in the SSE event; `durationMs: 0` on hit. |
| Embedding service 429 / 5xx | Retried per EXT-3 (3 retries). On final fail: `fallbackReason = 'embedding_failed'`. |
| Embedding service returns wrong-dim vector | `INVALID_SCORE` (defensive). |
| pgvector query exceeds 5s timeout | `fallbackReason = 'vector_query_failed'`. |
| k-NN returns 0-4 rows above sim floor | `confidence: 'low'`, `corpus_thin`; available matches shown for transparency only. |
| k-NN returns 5-29 rows above sim floor | `confidence: 'medium'`; hybrid blend applied; 2-dot confidence pill. |
| k-NN returns 30+ rows above sim floor | `confidence: 'high'`; 3-dot pill. |
| User re-scores moments after first score | Embedding + system-prompt cache hit; corpus query re-runs. Latency ~6-8s vs ~12-14s fresh. |
| Cron running while user calls /score | No interaction; cron runs as service role and doesn't block hot-path queries. |
| Cron failing 48h+ | Admin view shows red "Cron unhealthy" pill. Hot path still scores against stale corpus. |
| Cron writes duplicate video_id | `on conflict do nothing`; counted in `outliers_skipped`. |
| Cron exceeds Edge Function 60s timeout | Run marked `'partial'` in `try/finally`; next scheduled run resumes via round-robin. |
| Re-embed mid-day | Hot-path queries see a transient mix of old- and new-model vectors. Full re-embed completes < 30 min for 50K rows. |
| Embedding model change without re-embedding corpus | `outlier_corpus.embedding_model` checked at query time; mismatch logs warning and forces fallback. |
| Non-admin hits /admin/corpus | `403 FORBIDDEN`; generic page (no route-existence leak). |
| Admin triggers cron while one is running | `409 CRON_ALREADY_RUNNING`. |
| Two admins trigger cron simultaneously | Advisory lock on `corpus_cron_runs` insert; second returns `CRON_ALREADY_RUNNING`. |
| User's idea is non-Latin script | Embed succeeds (multilingual model); corpus English-only → low-similarity → fallback. |
| Idea contains XML-tag text like `</idea_text>` | Phase 1 prompt-injection defense applies; embedding is text-agnostic. |
| Corpus contains a since-deleted YouTube video | Not validated in real-time. "Open ↗" links to YouTube's "unavailable" page. Acceptable. |
| YouTube renames a channel referenced in `corpusMatches` | Cached `channel_title` from scoring time is shown; slight staleness acceptable. |
| Idea matches the user's own video in corpus | Not filtered out — feature, not bug ("you're already on this archetype"). |
| Embedding cache exceeds 1M rows | Eviction job (§3.5) runs nightly on the 90-day-no-hit threshold. |
| RLS misconfiguration leaks corpus to anonymous | Prevented by the `select_authenticated` policy + service-role-only writes. End-to-end test required. |

---

## 9. Security Considerations

- **Auth-gated:** middleware on `(app)` and `(admin)` route groups enforces session presence; `401 UNAUTHENTICATED` otherwise.
- **Admin-gated:** `/admin/corpus` and `/api/admin/corpus/*` additionally check `auth.uid() in (select id from admin_users)`. Non-admin → `403 FORBIDDEN` (no route-existence leak).
- **RLS (SEC-2):** `outlier_corpus` and `tracked_niches` are read-only for authenticated users; writes service-role only. `corpus_cron_runs` and `embedding_cache` have no user-facing read policies (admin endpoints use service role). `pipeline_runs.score_data` inherits the per-user RLS from Tier 0.
- **IDOR protection:** every `runId`-taking endpoint reads with `where user_id = auth.uid() and deleted_at is null`. `cronRunId` is admin-gated.
- **Prompt-injection defense:** `<empirical_signals>` contains user-controlled `title_text` / `channel_title`. The system prompt's existing untrusted-input clause is augmented with one line covering `<match>` / `<empirical_summary>`; cache hit preserved.
- **CRIT-1 (YouTube quota):** cron hard-capped at 5K/day via `consumer = 'corpus_cron'`. Hot-path's 8K total-cap (sums across all consumers) prevents joint overflow.
- **CRIT-2 (model lock):** Opus 4.7 required for the LLM component; unchanged.
- **CRIT-3 (prompt cache):** system prompt unchanged; user-prompt extension preserves the cache.
- **CRIT-4 (attribution):** no new ports; no change.
- **Embedding service auth:** `OPENAI_API_KEY` / `VOYAGE_API_KEY` from `lib/env.ts`; never logged or returned to client.
- **Cost-shape attack:** Phase 1 rate limit (10 stage-4 calls/user/min) caps Opus + embedding burn. Embedding cache absorbs duplicates across users.
- **Vector poisoning:** corpus writes service-role only; end users cannot inject vectors. Cron filters (§5.7.4) catch obvious spam (livestreams, inflated views).
- **PII:** `idea_text` is stored in `pipeline_runs` (per-user RLS) and hashed into `embedding_cache.cache_key`; the vector is not practically invertible. We log idea length, not text.
- **CSRF:** same-origin POSTs CSRF-protected by default; admin POSTs verify `Origin`.
- **DoS via expensive query:** 5s statement timeout + HNSW p99 < 100ms at our scale.
- **Embedding-cache timing leak:** cache-hit vs miss timing is observable; we accept this (no high-value info leaks). Reconsider in Phase 3 if a security-sensitive use case emerges.

---

## 10. Future Considerations (Out of Scope for Phase 2)

The following are intentionally deferred. Each is tracked elsewhere — do not implement as part of this feature.

- **Feature #17 — Calibration loop.** Tracks which scored ideas actually hit predicted virality after publish; recalibrates per-niche weights and gate thresholds. Replaces the static `HYBRID_WEIGHTS` and `GATE_THRESHOLD` with learned per-niche maps.
- **Feature #18 — Niche vocabulary library.** Reads `outlier_corpus` (specifically the `niche_embedding` column this spec lazily writes) to build per-niche tag clouds, archetype summaries, and Stage 5 title scaffolds.
- **Live corpus refresh on user action.** Phase 3 may add a "refresh corpus for my niche now" admin action with a per-user rate limit.
- **Cross-niche similarity routing** when a user's niche is unmapped (instead of LLM-only fallback). Phase 3.
- **Multi-language corpus.** Phase 2 is English-only.
- **Surface the corpus to users for browsing.** PRD explicitly excludes this in v1.
- **Trend prediction** — detecting which niches/archetypes are heating up over time. Phase 3.
- **Per-creator personalization** — Feature #17 territory.
- **Confidence intervals on the score itself** — Phase 3 may emit `[low, high]` ranges based on bootstrapped sampling of the neighbor set.
- **Score history table.** Still deferred from Phase 1.
- **Vector-store alternatives** (Supabase Vector managed, Pinecone, Qdrant) if pgvector hits scaling limits at 1M+ corpus rows.
- **Real-time corpus updates** via WebSockets.
- **Public corpus health page** (non-admin).
- **Live cron progress in the admin view via WebSockets** (Phase 2 polls every 5s).
- **A/B test of weights** — belongs to Feature #17.
- **Per-niche weight tuning during this spec's lifetime.** Forbidden — static defaults ship as documented; tuning belongs to Feature #17.

---

## Appendix A — File map

This spec implies the following files exist by the end of implementation:

```
app/
  (admin)/admin/corpus/
    page.tsx                              # /admin/corpus — health view (mockup state 6)
    runs/[cronRunId]/page.tsx             # cron run drilldown
  api/
    pipeline/score/route.ts               # extended SSE handler (v1 → v2)
    admin/corpus/health/route.ts          # GET — corpus health
    admin/corpus/cron/route.ts            # POST — manual trigger
    admin/corpus/cron/[cronRunId]/route.ts # GET — cron detail
    admin/corpus/reembed/route.ts         # POST — re-embed corpus
lib/
  config.ts                               # adds HYBRID_WEIGHTS, FALLBACK_WEIGHTS, SIM_FLOOR/STRONG,
                                          # confidence thresholds, EMBEDDING_MODEL, NICHE_RESOLUTION_THRESHOLD,
                                          # CORPUS_CRON_DAILY_BUDGET (=5000), CORPUS_RETENTION_DAYS (=180)
  services/
    score.ts                              # extended — orchestrates parallel paths
    empirical-score.ts                    # NEW — k-NN + composite scoring
    niche-resolver.ts                     # NEW — free-text → tracked_niches
    corpus-cron.ts                        # NEW — cron orchestrator
  embeddings/
    cached.ts                             # NEW — embedIdea() with embedding_cache
    providers.ts                          # NEW — model dispatcher
    health.ts                             # NEW — in-memory health ring buffer
    models.ts                             # NEW — allowlist
  prompts/score.ts                        # extended additively — empirical_signals user-prompt block
  validation/
    score-v1.ts                           # NEW — extracted from Phase 1
    score.ts                              # extended — discriminated union (v1 | v2)
    corpus.ts                             # NEW
    cron.ts                               # NEW
  db/
    runs.ts                               # extended — writes v2 score_data
    corpus.ts                             # NEW — knnSearch, insertOutlier, archiveOldRows
    embedding-cache.ts                    # NEW
    cron-runs.ts                          # NEW
    tracked-niches.ts                     # NEW
  youtube/
    cached.ts                             # extended — `consumer` tag for quota tracking
    cron-fetcher.ts                       # NEW — outlier discovery helpers (cron only)
  cron/scheduler.ts                       # NEW — Edge Functions / Vercel Cron abstraction
components/
  runs/
    StageScoreCard.tsx                    # extended — six new states
    HybridScoreBreakdown.tsx              # NEW — three-card layout
    CorpusMatchList.tsx                   # NEW — top-5 reference outliers
    ConfidenceStrip.tsx                   # NEW
    CorpusThinBanner.tsx                  # NEW — mockup state 3
    ColdStartCard.tsx                     # NEW — mockup state 4
    EmpiricalErrorCard.tsx                # NEW — mockup state 5
  admin/
    CorpusHealthDashboard.tsx             # NEW — mockup state 6
    CronRunRow.tsx                        # NEW
    PerNicheDensityTable.tsx              # NEW
    CalibrationDriftCard.tsx              # NEW
supabase/
  migrations/
    {ts}_enable_pgvector.sql
    {ts}_create_outlier_corpus.sql
    {ts}_create_tracked_niches.sql        # + seeds 20 launch niches
    {ts}_create_corpus_cron_runs.sql
    {ts}_create_embedding_cache.sql
    {ts}_alter_youtube_quota_add_consumer.sql
  functions/corpus-cron/index.ts          # Edge Function entrypoint
```

Files this spec touches but does not own:
- `lib/services/pipeline.ts` — orchestrator. No changes in v2 (gate semantics unchanged).
- `lib/services/competitor.ts` — Stage 3 service. Adds `sideWriteOutliers` call gated behind `FEATURE_FLAGS.HYBRID_SCORING_ENABLED`.
- `lib/anthropic/cache.ts`, `lib/anthropic/retry.ts` — Tier 0 §0.5; no changes.
- `app/(app)/runs/[runId]/page.tsx` — Feature #03 owns; rendering of `StageScoreCard` is unchanged.

---

## Appendix B — CLAUDE.md updates required + decisions flagged

When this spec is implemented, the following CLAUDE.md sections must be updated:

1. **CRIT-1 (YouTube quota):** add: "The corpus cron is a separate quota consumer (`consumer = 'corpus_cron'`) capped at 5,000 units/day. The 8K soft cap is shared across all consumers and remains the trigger for `QUOTA_EXCEEDED`."
2. **CRIT-2 (model assignments):** no change. Add a footnote: "Embeddings: `text-embedding-3-small` (OpenAI) — used by Feature #14 for k-NN, not LLM reasoning."
3. **CRIT-3 (prompt cache):** add: "Edits to the *user prompt* preserve the cache; edits to the *system prompt* invalidate it. Feature #14 takes the user-prompt path."
4. **CRIT-4 (attribution):** no change.
5. **Stack lock-in:** add three lines:
   - Vector store: pgvector on Supabase Postgres (HNSW indexes).
   - Embedding model: OpenAI `text-embedding-3-small` (default; `voyage-3` and Anthropic `embed-v3` allowlisted).
   - Background jobs: Supabase Edge Functions scheduled via pg_cron (default); Vercel Cron fallback.
6. **Common Mistakes section** — populate as bugs surface. Likely watch-list:
   - Forgot `consumer = 'corpus_cron'` on a YouTube call inside the cron.
   - Wrote a v1 `score_data` from a v2 code path because the `version` literal wasn't bumped.
   - Computed `weightedFinal` in the model instead of in TypeScript.
   - Skipped the niche resolver and queried `outlier_corpus` with the user's free-text niche.
   - Embedded the idea without including the niche label (cross-niche neighbor leakage).
7. **File length limits:** `lib/services/score.ts` will likely exceed 300 lines after v2 — extract `lib/services/hybrid-score.ts` and delegate. `components/admin/CorpusHealthDashboard.tsx` close to the 200-line cap; split into the four cards if it grows.

### Decisions flagged for explicit follow-up

- **D-1: Embedding model.** Default `text-embedding-3-small`; final choice after 1-week POC (p95 latency, recall@20, monthly cost). Decision by Phase 2 sprint week 1.
- **D-2: Cron runtime.** Default Supabase Edge Functions; switch to Vercel Cron if p99 batch-run > 50s. Decision by Phase 2 sprint week 1.
- **D-3: HNSW vs. IVFFlat.** HNSW; revisit if corpus exceeds 500K rows or re-embed build > 30 min.
- **D-4: 30-neighbor confidence threshold.** Default; calibrate after two weeks of cron data. Change requires `Common Mistakes` rationale.
- **D-5: Hybrid weights 0.4 / 0.6.** Default; Feature #17 owns per-niche tuning. Do not change until #17 ships.
- **D-6: 180-day retention window.** Default; may tighten to 90 days once cron has run 90 days.
- **D-7: `admin_users` table provenance.** Assumed to exist from earlier infrastructure. If missing, migration must add it. Confirm with Tier 0 before implementing.
- **D-8: Side-write feature-flag rollout.** `FEATURE_FLAGS.HYBRID_SCORING_ENABLED` defaults true post-launch; consider an independent side-write flag for the first week so cron + side-write don't double-write while conflict handling is bedded in.
- **D-9: "Notify me when ready" CTA.** Stubbed (toast). Full impl requires a niche-subscription table — defer to Phase 2 polish if demand emerges.

---

*End of spec.*
