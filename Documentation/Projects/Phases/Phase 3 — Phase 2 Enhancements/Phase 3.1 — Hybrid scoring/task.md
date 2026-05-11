# Phase 3.1 — Hybrid scoring engine

**Parent:** Phase 3 — Phase 2 Enhancements
**Status:** Not Started
**Estimated:** 14-20 hours (the defensibility unlock)
**Depends on:** Phase 2.2 (Stage 4 scoring shipped)
**Spec:** `Documentation/Overviews and Summaries/14-hybrid-scoring-engine/spec.md`

## Goal

Tier 3.1 — extend Stage 4 score from LLM-only opinion into hybrid: 0.4 × LLM + 0.6 × Empirical via pgvector k-NN against a nightly-built outlier corpus. Cold-start fallback to 1.0 LLM when corpus has <30 niche matches. Without this, the product is a thin Claude wrapper.

## What to Build

### Step 1 — Database + pgvector
- Enable `pgvector` extension. Create `outlier_corpus` table with HNSW indexes on `title_embedding` (1536 dim) + `niche_embedding`. Columns: `id, video_id, channel_id, niche_label, title_text, title_embedding, thumbnail_brief jsonb, view_count, channel_median_views, view_multiple, published_at, indexed_at, source_run_id (nullable), niche_embedding`.
- `corpus_cron_runs` table (audit), `tracked_niches` table (seed 20 launch niches), `embedding_cache` (titles embedded once), `youtube_quota_usage.consumer` column (corpus cron is a distinct consumer from hot-path), `unmapped_niche_log`.
- RLS policies (outlier_corpus is service-role only — admin clients).

### Step 2 — Embedding pipeline
- `lib/embeddings/openai.ts` wrapper for `text-embedding-3-small` (1536 dim) — default; allowlist of approved providers.
- `embedding_cache` helpers: kv with sha256(text) → vector.
- Niche resolver: maps `channels.niche` to canonical `tracked_niches.niche_label` via exact match → cosine-nearest fallback → log to `unmapped_niche_log`.

### Step 3 — Nightly cron
- Provider: Supabase Edge Functions or Vercel Cron (deferred per spec D-2 — feature flag picks one in week 1).
- 4×/day schedule. Each run scrapes top videos in tracked niches where `view_multiple ≥ 5×`. Cron consumer quota cap: 5K daily YouTube units (CRIT-1; never compete with hot-path 8K cap).
- Batched embedding writes; ring-buffer health metrics.
- Side-write feature flag: Stage 3 outliers optionally side-feed corpus (Feature #17 calibration will exercise this).
- Failure-mode coverage: provider down, quota exhausted, embedding cap reached.

### Step 4 — Hybrid scoring integration
- Extend `lib/services/score.ts` (Phase 2.2): after LLM dimensions returned, perform k-NN query on `outlier_corpus` with `ef_search=80`, statement timeout 250ms. Empirical component = formula over neighbor `view_multiple` + similarity scores. Weighted blend `0.4 LLM + 0.6 Empirical` when neighbor count ≥30; fallback to `1.0 LLM` otherwise.
- `score_data` schema v1→v2 discriminated union: v1 (LLM-only) still parses; v2 adds `empiricalScore, weightedFinal, corpusMatches: [{corpusId, similarity, viewMultiple, why}], confidence: 'high'|'medium'|'low', neighborCount, fallbackReason?`.
- Prompt extension: include top-5 corpus matches in user prompt for Opus context (no system-prompt change preserves cache).

### Step 5 — Admin + UI
- `GET /api/admin/corpus/health` (admin auth) — corpus size, niche coverage, last refresh, p95 k-NN latency.
- Manual cron trigger endpoint (admin), re-embed endpoint.
- Stage 4 score card extension: show LLM/Empirical/Weighted breakdown + nearest-neighbors panel (5 thumbnails + similarity scores + why-match rationale) + confidence badge.
- Admin corpus health dashboard.

### Step 6 — Cold-start + low-confidence
- UI: corpus-thin/cold-start/service-error card variants (mockup #14 states 3/4/5). "Notify me when ready" CTA (stubbed toast for Phase 2).
- Stage 3 side-write under feature flag.
- Fallback weighting matrix verification.

### Step 7 — Integration & testing
- v1 score_data still parses with Zod after schema bump to v2 discriminated union (backward compat).
- k-NN query <100ms p95 with `ef_search=80` on 100K rows.
- Cold-start (corpus<30) sets `confidence: low` and `weight: 1.0 LLM` (verified by seeding 29 vs 30 rows).
- Prompt-cache verified after corpus-match injection (corpus matches go in user prompt only, not system prompt).
- CRIT-3 compliance on the prompt.
- 5K cron consumer cap enforced separately from 8K hot-path cap (CRIT-1).
- Side-write feature flag respected.
- CLAUDE.md updates: stack lock-in adds pgvector + OpenAI embeddings; new env vars `OPENAI_API_KEY` (or chosen provider).

## Cross-feature contracts

- Reads `channels.niche` (Phase 1.5) — niche resolver maps to canonical labels.
- Extends `pipeline_runs.score_data` shape from Phase 2.2 — v1 readers still work (discriminated union with `schemaVersion`).
- Side-writes corpus from Stage 3 outliers (Phase 2.1) under feature flag.
- Feature #17 (calibration) reads `outlier_corpus` to recalibrate weights per niche; writes back to corpus from user's published runs.
- Feature #18 (niche vocabulary) reads same corpus for phrase mining.

## Verification

- [ ] `outlier_corpus` has HNSW index on `title_embedding` column
- [ ] k-NN query returns top 30 neighbors in <100ms with `ef_search=80` (1K+ rows seeded)
- [ ] v1 score_data (LLM-only, no `weightedFinal`) still parses with Zod after v2 schema introduced
- [ ] Cold-start (corpus rows <30 for niche) sets `confidence: 'low'` and `weight: 1.0 LLM`
- [ ] Hybrid weight applies as `0.4 × LLM + 0.6 × Empirical` when neighbors ≥30
- [ ] Nightly cron uses separate quota consumer; never causes hot-path to exceed 8K
- [ ] 5K daily cap enforced at cron level (verified by seeded `youtube_quota_usage.consumer = 'corpus_cron'` row)
- [ ] CRIT-3 prompt cache hits with corpus matches in user prompt (not system)
- [ ] CRIT-1: outlier_corpus reads/writes go through cached YouTube wrappers
- [ ] Admin endpoints require admin auth (separate `admin_users` table)
- [ ] CLAUDE.md updated: stack lock-in (pgvector, OpenAI embeddings), new env vars
- [ ] Embedding model decision (D-1) documented in CRIT-2 table additions

## Out of scope

- Real-time corpus updates (nightly cron only)
- Embedding model swap (deferred 1-week POC)
- Per-niche custom weights (0.4/0.6 frozen until Feature #17 ships)
- Cross-language corpus support
- Public corpus access / data export
