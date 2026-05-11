# Phase 3.4 — Compound-effect forecast

**Parent:** Phase 3 — Phase 2 Enhancements
**Status:** Not Started
**Estimated:** 6-8 hours
**Depends on:** Phase 2 (pipeline_runs.score_data + AVD data optional)
**Spec:** `Documentation/Overviews and Summaries/16-compound-forecast/spec.md`

## Goal

Channel-level 12-month subscriber + view trajectory projection. Pure-TS deterministic compute (no LLM, no Monte Carlo despite mockup theatrics). Input sliders (cadence, avgQuality, elasticity), confidence bands (best/expected/worst), milestone detection (monetization threshold, 10K, 100K, 1M subs), comparison vs last-90d-actual + niche peers. Snapshot save for time-series tracking.

## What to Build

### Step 1 — Data layer
- `forecasts` table (snapshots): id, user_id, channel_id, inputs jsonb, outputs jsonb, generated_at, generator_version. RLS auth.uid().
- `forecast_cache` table (TTL'd): cache_key (hash of inputs + channel state), payload, expires_at. Server-only, no RLS policies. Can be replaced by Redis.
- Zod schemas `lib/validation/forecast.ts`: `ForecastInputsSchema = {cadence (1-30 videos/mo), avgQualityScore (60-100), elasticity (0.5-2.0)}`. `ForecastOutputsSchema = {projection: [{monthIndex 0-12, subscribers: {best,expected,worst}, totalViews: {best,expected,worst}, monetizationStatus}], milestones, delta, baselineSource, generatorVersion}`.
- `lib/db/forecasts.ts` typed accessors. Snapshots immutable (no UPDATE policy).

### Step 2 — Projection engine
- `lib/services/forecast/inputs.ts`: `deriveDefaultInputs(channel, recentRuns)` reads channel cadence from `pipeline_runs.completed_at` history, avg quality from `score_data.finalScore` (graceful fallback to `niche_average=89`), elasticity from `outlier_corpus` (fallback 1.0).
- `lib/services/forecast/projection.ts`: recurrence `monthN_subs = monthN-1 × (1 + cadenceFactor × scoreFactor × elasticity) - churn`. Hardcoded churn `0.5%/month` (Decision D-3).
- `lib/services/forecast/bands.ts`: confidence bands `σ_M = 0.30 + 0.04 × M` (widening with horizon). Asymmetric `worst = expected − σ × 0.7` (empirically motivated — Decision D-4).
- `lib/services/forecast/monetization.ts`: derive monetization status (1K + 4K watch-hours, 10K, 100K, 1M thresholds).
- `GENERATOR_VERSION = "v1.0.0"` constant.

### Step 3 — Milestones + delta
- `lib/services/forecast/milestones.ts`: 7-name catalog with band crossing detection per `expected/best/worst` trajectory.
- `lib/services/forecast/delta.ts`: `computeVsLast90DaysActual` reads `channel_history` table (owned by adjacent feature — graceful fallback `null` if missing). `computeVsNichePeers` reads outlier_corpus aggregates (fallback to niche-average constants).

### Step 4 — API endpoints
- `GET /api/channels/[channelId]/forecast?cadence=N&avgScore=X&elasticity=Y` — main endpoint. 6h cache keyed by `(channelId, inputs, recent_runs_hash, generatorVersion)`. Pure JSON response (NOT SSE — compute <500ms).
- `POST /api/channels/[channelId]/forecast/snapshot` — server-side recompute + persist immutable snapshot. 12-pin limit per channel.
- `GET /api/channels/[channelId]/forecast/snapshots` — list.
- `DELETE /api/forecasts/[snapshotId]` — soft-delete user's own snapshots.
- `INSUFFICIENT_HISTORY` error when <5 pipeline_runs in last 90d.

### Step 5 — UI
- `/forecast/[channelId]` route + composition root + `useForecast` hook (300ms slider debounce + AbortController).
- `<HeadlineProjection>`: "If you ship 4 videos/month at avg score 89, you'll hit 100K subs in 8 months."
- `<TrajectoryChart>`: SVG area chart with confidence bands (shaded), red/yt-600 expected line, milestone markers.
- `<InputsPanel>`: cadence/avgScore/elasticity sliders (server-side recompute on each — single source of truth).
- `<MilestoneStrip>`: monetization → 10K → 100K → 1M with predicted dates per band.
- `<ComparisonChart>`: this trajectory vs last-90d-actual vs niche peers.
- `<SnapshotDrawer>`: save/load/delete pinned snapshots.
- Empty + reduced-confidence + insufficient-history states.

### Step 6 — Integration & testing
- Compute time <500ms for 12-month projection.
- Second GET with same params returns cached output (verified by inspecting compute timestamp in payload).
- <5 pipeline_runs returns `INSUFFICIENT_HISTORY` without computing.
- `generatorVersion` bump invalidates all `forecast_cache` rows.
- 12-month horizon fixed (not user-configurable).
- No SSE: response Content-Type `application/json`.
- 12 pinned snapshots/channel max.
- Asymmetric bands: `worst = expected − σ × 0.7` (not symmetric `±σ`).
- CLAUDE.md updates: stack lock-in unchanged; flagged decisions documented in Appendix B.

## Cross-feature contracts

- Reads `pipeline_runs.score_data.finalScore` to derive avgQuality (Phase 2.2).
- Reads `channels.subscriber_count, median_views` (Phase 1.5).
- Reads `outlier_corpus` for nicheElasticity (Phase 3.1 — graceful fallback 1.0).
- Reads optional Feature #15 AVD data + Feature #17 calibration for trajectory accuracy (graceful fallback).
- Writes `forecasts` table for time-series snapshots; reads back to render snapshot drawer.

## Verification

- [ ] Compute time <500ms for 12-month projection (p95 budget)
- [ ] Second GET with same params returns cached output (compute timestamp matches first call)
- [ ] <5 pipeline_runs returns 422 INSUFFICIENT_HISTORY without computing
- [ ] `generatorVersion` bump invalidates all `forecast_cache` rows
- [ ] Forecast horizon fixed at 12 months (rejected `?months=24` query param)
- [ ] Response Content-Type is `application/json` (NOT `text/event-stream`)
- [ ] 12 pinned snapshots per channel max; 13th save returns 409 SNAPSHOT_LIMIT
- [ ] Asymmetric bands: `worst_M = expected_M - σ_M × 0.7` (not `± σ_M`)
- [ ] Hardcoded churn `0.5%/month` documented in Appendix B
- [ ] `delta.vsLast90DaysActual = null` when `channel_history` table absent (graceful fallback)
- [ ] No LLM calls in forecast service (verified by grep: no `callClaude` / `anthropic.messages`)
- [ ] No Monte Carlo despite mockup copy (deterministic formula only)

## Out of scope

- Per-video forecast (Phase 3)
- Per-channel churn tuning (Feature #17 future)
- User-tunable horizon (12-month locked)
- Slider client-side recompute (server-only for source of truth)
- `channel_history` table (adjacent feature dependency; graceful fallback when absent)
