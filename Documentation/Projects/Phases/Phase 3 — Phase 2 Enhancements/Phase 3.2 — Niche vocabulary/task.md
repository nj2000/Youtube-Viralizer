# Phase 3.2 — Niche vocabulary library

**Parent:** Phase 3 — Phase 2 Enhancements
**Status:** Not Started
**Estimated:** 10-14 hours
**Depends on:** Phase 3.1 (outlier_corpus)
**Spec:** `Documentation/Overviews and Summaries/18-niche-vocabulary-library/spec.md`

## Goal

Tier 3.2 — per-channel curated vocabulary library mined nightly from outlier corpus. Categories: power_phrases (high-CTR), forbidden_phrases (cliches/AI-tells), niche_jargon, hook_patterns, trigger_words. Extends Stage 5 (titles) prompt to ground generation in proven phrases + block forbidden ones.

## What to Build

### Step 1 — Data layer
- `niche_vocabulary` table with 4 closed enums: `vocab_category` (power_phrases/forbidden_phrases/niche_jargon/hook_patterns/trigger_words), `vocab_trigger` (curiosity/fear/result + null), `vocab_policy` (allow/block/neutral), `vocab_source` (mined/manual/imported). Columns: id, channel_id, niche_label, term, term_lower (generated column), category, trigger (nullable, enum), usage_count, source_video_ids (uuid[]), ctr_delta_avg float, allow_or_block, source_type, archived_at, created_at, updated_at.
- Partial unique index `(channel_id, term_lower, category) WHERE archived_at IS NULL`.
- Check constraints linking trigger/category and forbidden→block.
- `vocab_cron_runs` audit table; GIN index on `titles_data.vocabRefs` for reverse lookup.
- New columns on `channels`: `vocabulary_grounding_enabled bool default true`, `vocabulary_last_mined_at`, `vocabulary_voice_priority`.

### Step 2 — Mining cron (Haiku 4.5 per CRIT-2)
- `lib/prompts/vocab-mining.ts` with ephemeral `cache_control`. Daily cron at 04:00 UTC (after Feature #14 corpus refresh).
- `lib/services/vocab-mining.ts`: extracts terms from `outlier_corpus` matched to user's niche → computes `ctr_delta_avg` vs niche baseline → sanity clamps. 7-day cache per niche.
- `bulkUpsertFromMining` with `WHERE source_type='mined'` guard (Decision D-8 strong stance: manual policy always wins; cron never overwrites manual rows).
- Edge Function or Vercel Cron (Decision D-3).

### Step 3 — CRUD API + CSV
- `GET /api/channels/[channelId]/vocabulary` — paginated keyset, filterable.
- `GET /api/channels/[channelId]/vocabulary/[vocabId]` — phrase detail (usage history, source videos, CTR delta).
- `POST` — manual add. `PATCH` — toggle policy. `DELETE` — manual entries only; mined entries can be policy-blocked but not deleted (returns 422 MINED_NOT_DELETABLE).
- `POST /api/channels/[channelId]/vocabulary/import` — CSV streaming up to 5000 rows; >5000 returns 413 IMPORT_LIMIT_EXCEEDED.
- `GET .../export` — CSV streaming with snake_case headers (boundary inconsistency intentional — CSV is external interchange).
- Admin endpoint for niche-level overrides.

### Step 4 — Stage 5 prompt extension
- `lib/services/vocab-load.ts` `loadActiveLibrary(channelId)` — 5 parallel queries, p95 <30ms. Returns top-20 power_phrases + entire forbidden_phrases list + jargon + hook patterns + trigger words.
- Stage 5 (Phase 2.3) titles service: extends USER prompt (NOT system — preserves CRIT-3 cache) with vocab injection in XML block. Token-budget trim if injection >2000 tokens.
- Matcher: `vocabRefs` array on each title (exact + fuzzy for power/jargon; exact-only for forbidden).
- 1-retry-then-accept on forbidden-phrase violation in generated output.
- `titles_data` v2 schema bump adding `vocabRefs` field.

### Step 5 — UI
- `/settings/vocabulary/<channelId>` page: route + header + stat strip (counts per category) + filter bar (category, trigger, policy).
- Main two-column grid with optimistic updates (toggle policy → optimistic → API call).
- Phrase-detail drawer with URL hash `#vocab/[vocabId]` (deep-linkable).
- Stage 5 card additions: "vocabulary used" toggle + chip strips showing which vocab terms appeared in generated titles.
- Opt-out toggle per channel (disables grounding entirely).
- CSV import/export flows + cold-start state + admin niche-level views.

### Step 6 — Integration & testing
- Stage 5 reads vocab automatically when `channels.vocabulary_grounding_enabled = true`.
- DELETE on `source_type='mined'` returns 422 MINED_NOT_DELETABLE.
- CSV import with 5001 rows returns 413 IMPORT_LIMIT_EXCEEDED.
- Stage 5 generated title containing forbidden phrase triggers 1 retry visible in logs.
- Cold-start (<50 corpus entries for niche) keeps library empty; user can manually populate.
- Opt-out flag disables grounding entirely (no vocab in prompt).
- Forward-read stub for Feature #9 (lint future: extends forbidden_phrases list).
- CLAUDE.md updates per spec Appendix C: new Haiku usage row in CRIT-2 table.

## Cross-feature contracts

- Reads `outlier_corpus` from Phase 3.1 (graceful fallback when sparse).
- Read by Stage 5 (Phase 2.3) — extends titles prompt with niche vocabulary (additive, no schema change to titles_data shape, only `vocabRefs` field added).
- Future Feature #9 (lint) reads `forbidden_phrases` to extend lint rules.
- `channels.niche` → niche_label resolver shared with Feature #14.

## Verification

- [ ] `niche_vocabulary` table has 4 closed enums; partial unique on `(channel_id, term_lower, category) WHERE archived_at IS NULL`
- [ ] DELETE on a row with `source_type='mined'` returns 422 MINED_NOT_DELETABLE
- [ ] CSV import with 5001 rows returns 413 IMPORT_LIMIT_EXCEEDED
- [ ] Stage 5 generated title containing forbidden phrase triggers exactly 1 retry visible in logs
- [ ] Cron mining `WHERE source_type='mined'` guard preserves manual rows on upsert
- [ ] `loadActiveLibrary` 5 parallel queries complete in <30ms p95
- [ ] Stage 5 prompt extension goes in USER prompt (not system) — CRIT-3 cache hit rate unchanged
- [ ] `vocabRefs` field added to `titles_data` v2 schema; v1 still parses
- [ ] Opt-out flag `vocabulary_grounding_enabled=false` skips library load entirely
- [ ] Cold-start (<50 corpus entries) returns empty library; UI shows "we're still learning" banner
- [ ] CSV headers are snake_case (`term, category, trigger, allow_or_block`)
- [ ] Cron schedule = `04:00 UTC daily`; ~$0.40/night Anthropic cost; zero YouTube quota
- [ ] CRIT-2 table has Haiku row for vocab mining

## Out of scope

- Per-niche shared vocab + per-channel overlay (per-channel storage with mined dupes for now)
- Hook-pattern matcher firing vocabRefs (templates rarely match exactly)
- Embedding-based fuzzy match (Jaccard for MVP)
- Multi-language vocab
