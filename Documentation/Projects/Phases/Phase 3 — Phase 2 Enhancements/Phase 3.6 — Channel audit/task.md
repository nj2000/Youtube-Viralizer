# Phase 3.6 — Channel audit

**Parent:** Phase 3 — Phase 2 Enhancements
**Status:** Not Started
**Estimated:** 8-12 hours
**Depends on:** Phase 1.5 (channels)
**Spec:** `Documentation/Overviews and Summaries/19-channel-audit/spec.md`

## Goal

Standalone diagnostic (NOT a pipeline stage). Multi-pass Haiku (SEO/performance/content/monetization scans) + Opus synthesis produces a 90-day audit report: overall score + grade, strengths, issues with severity, underperformer diagnosis, hidden winners, cadence heatmap, format mix, prioritized recommendations. 7-day per-channel throttle. Eligible for parallel build with 3.7/3.8/3.9 (all lifted subskills, no shared code).

## What to Build

### Step 1 — Data layer
- `channel_audits` table (immutable, no UPDATE policy): id, channel_id FK, audit_data jsonb, generated_at, expires_at (+90d), prev_audit_id (linkage). RLS auth.uid().
- `channel_audit_deletions` audit-survival log (no DELETE/UPDATE policies) for the 3-deletes-per-30-days throttle.
- Zod schemas in `lib/validation/audit.ts`: `ChannelAuditPayloadSchema` with 10 sub-schemas (overall, dimensions, strengths, issues, underperformers, hidden_winners, cadence, format_mix, recommendations, breakdown) + `schemaVersion: 1`.
- `lib/db/audits.ts` accessors with on-read parse + transactional delete (writes deletion log row before delete).

### Step 2 — Multi-pass services
- `computeChannelFeatures(channelId)` — deterministic feature extraction (last 50 videos from `channels.top_videos_json`, view distribution, cadence patterns, day-of-week heatmap, format mix).
- `seoScan` (Haiku 4.5) — keyword stuffing, intent match, description quality, tag balance.
- `performanceScan` (Haiku 4.5) — AVD heuristic from runtime + view-count outliers, `estimatedFromRuntime: true` invariant (no Analytics OAuth in v1).
- `contentScan` (Haiku 4.5) — thumbnail style consistency (text-only judgment from titles + descriptions, no vision in v1), content arc patterns.
- `monetizationScan` (Haiku 4.5) — subscriber-to-view ratio, monetization eligibility, sponsorship potential.
- `synthesize` (Opus 4.7) — multi-pass synthesis with `cache_control`. Attribution `// Adapted from AgriciDaniel/claude-youtube (MIT) — sub-skills/audit.md`.
- Postgres advisory lock on `(channelId, "audit")` prevents two concurrent audit runs.

### Step 3 — Underperformer + hidden winner
- Single-cause diagnosis enum (6 causes: weak_hook, poor_thumbnail, off_niche, wrong_title_pattern, structural_drift, length_mismatch). Soft fallback to `weak_hook` if model returns none.
- Deterministic pre-filter (bottom 5 by view multiple) + post-synthesis enrichment.
- Recommendation prioritization with `expectedImpact` from fixed vocabulary (`"+~40% CTR"`, `"ALGO LIFT"`, etc. — not calibrated, qualitative tags).

### Step 4 — API endpoints
- `POST /api/channels/[channelId]/audit` SSE (30-90s total). Emits progress events per pass.
- `GET /api/channels/[channelId]/audit/latest`.
- `GET /api/channels/[channelId]/audits` (paginated history).
- `DELETE /api/channel_audits/[auditId]` — writes to deletions log before delete (3-per-30-days hard cap).
- `GET /api/channels/[channelId]/audit/[auditId]/export?format=markdown` — Appendix B template.
- 7-day throttle: 8th-day request allowed; 7-days-and-less returns 429 with retryAfterSec.

### Step 5 — UI
- `/audit/<channelId>` route + `useAuditStream` hook.
- Header + health score (overall + grade A-F) + 4 dimension cards (SEO/performance/content/monetization breakdown).
- Strengths + issues with severity rings (high=rose / medium=amber / low=blue).
- Underperformers + hidden winners with single-cause diagnosis badges.
- Cadence heatmap SVG (day-of-week × hour-of-day cells) + format mix bars.
- Recommendations list with `expectedImpact` pills.
- History sidebar; markdown export button.

### Step 6 — Integration & testing
- 7-day throttle (with 3-per-30-days hard cap via deletions log).
- Audit immutability: UPDATE policy missing; runtime UPDATE attempt fails RLS.
- Single-cause diagnosis enforced (6 values + weak_hook fallback).
- Thumbnail style judged text-only (vision deferred to Phase 3 with Feature #23).
- Advisory lock on (channelId, "audit") prevents two concurrent runs.
- `force=true` reserved but ignored in v1 (always honors throttle).
- CLAUDE.md updates: CRIT-2 row for synthesis Opus + audit Haiku passes.

## Cross-feature contracts

- Reads `channels.top_videos_json`, niche, subscriber_count, median_views (Phase 1.5).
- Optional read `outlier_corpus` (Feature #14) for niche-baseline grounding.
- Writes `channel_audits` table (this feature only).
- Independent of `pipeline_runs` — runs against channel data not against a specific kit.
- Future-read by Feature #20 (content calendar) for "optimal post slots" sidebar.

## Verification

- [ ] Advisory lock on `(channelId, "audit")` prevents two concurrent audit runs in same channel
- [ ] `channel_audits` UPDATE attempt fails RLS (no UPDATE policy)
- [ ] Underperformer diagnosis is one of 6 enum values + soft `weak_hook` fallback
- [ ] `performanceScan` AVD heuristic marks `estimatedFromRuntime: true` invariant
- [ ] Thumbnail style judged text-only (no vision API call — verified by grep)
- [ ] 8th-day audit request succeeds; 7-day-and-less returns 429 with retryAfterSec
- [ ] 3-deletes-per-30-days hard cap survives via `channel_audit_deletions` log
- [ ] `force=true` query param ignored in v1 (audit still throttled)
- [ ] CRIT-2: Opus only for synthesis pass; Haiku for 4 dimensional scans
- [ ] CRIT-3: synthesis prompt has `cache_control`; 2nd audit shows cache hit
- [ ] CRIT-4 attribution to `sub-skills/audit.md`
- [ ] Cost envelope ~$0.37 cold / ~$0.20 cached recorded in `pass_metrics.costUsd`

## Out of scope

- Vision-based thumbnail analysis (Phase 3 with Feature #23)
- Real YouTube Analytics OAuth for true AVD (Phase 3)
- Multi-cause diagnosis (single-cause for UI clarity)
- Calibrated `expectedImpact` (qualitative tags Phase 2; Feature #17 future)
- Tier-aware score weighting (fixed 0.30/0.25/0.25/0.20 weighting Phase 2)
