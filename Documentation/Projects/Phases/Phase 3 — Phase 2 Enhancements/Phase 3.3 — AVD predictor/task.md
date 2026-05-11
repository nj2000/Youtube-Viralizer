# Phase 3.3 — AVD predictor

**Parent:** Phase 3 — Phase 2 Enhancements
**Status:** Not Started
**Estimated:** 8-10 hours
**Depends on:** Phase 2.5 (script_data); optional Phase 3.1 (corpus for baseline)
**Spec:** `Documentation/Overviews and Summaries/15-avd-predictor/spec.md`

## Goal

Predict Average View Duration before publish using a heuristic over script structural features + niche corpus baseline. Auto-triggers after Stage 7 in parallel with Stage 8 (lint), neither blocks pipeline progression. Generates retention curve + risk points + suggestion text. Calibration placeholder reserved for Feature #17.

## What to Build

### Step 1 — Data layer
- Migration `0015_add_avd_data.sql`: add `pipeline_runs.avd_data` JSONB column.
- `lib/validation/avd.ts`: `AvdDataSchema = {predictedAvdSec, predictedAvdRatio (TS-clamped to ≥25%), confidenceInterval: {lowerSec, upperSec}, retentionCurve: [{timeSec, predictedRetention}], riskPoints: [{timeSec, retention, suggestion}], comparison: {thisScript, channelMedian, nicheTopQuartile}, calibration: {state: 'pending'|'calibrated', ...} placeholder for Feature #17, multiplierBreakdown (SSE-only, NOT persisted), schemaVersion: 1}` with cross-field invariants.

### Step 2 — Heuristic predictor (pure TS, no LLM)
- `lib/services/avd/script-features.ts`: deterministic feature extraction from `script_data` — section count, rehook count, B-roll density, [PERSONALITY] zone count, open loops, demonstration time %, word density per section, monologue walker.
- `lib/services/avd/baselines.ts`: `computeNicheBaseline(niche)` from `outlier_corpus.estimated_avd_ratio` field (graceful fallback to constant `NICHE_BASELINE_FALLBACK = 48` when sparse). `computeNicheTopQuartile` similar (fallback 65). `computeChannelBaseline(channel)` proxy from view-to-subscriber with 10K-sub floor.
- `lib/services/avd/heuristic.ts`: formula `(nicheBase × 0.6 + channelBase × 0.4) × multipliers` with 7 documented multipliers (rehook bonus 1.05, open-loop bonus 1.08, B-roll density 0.95-1.10, anti-pattern penalty -0.05/detected, personality bonus, drift penalty, length penalty). Clamped [25, 92].
- `computeConfidenceInterval` widens with horizon; lower bound clamped at 25%.

### Step 3 — Retention curve + risk points
- `lib/services/avd/retention-curve.ts`: 30s-stride decay-to-baseline computation.
- `lib/services/avd/risk-points.ts`: detector flags drops ≥10pp within 60s window OR structural classifier flags (monologue, demo_density). 90s dedup window.
- `lib/prompts/avd-suggestions.ts`: Haiku 4.5 with `cache_control` for suggestion text only (~$0.005 per run). Deterministic fallback when LLM degraded.
- Config constants in `lib/config/avd.ts`.

### Step 4 — API endpoints
- `POST /api/pipeline/avd-predict { runId }` SSE — auto-trigger off Stage 7's `'scripted'` event in parallel with Stage 8. Neither blocks; `'avd_predicted'` event does NOT advance pipeline (Stage 9 keys off `'lint_done'`).
- `POST /api/pipeline/avd-predict/apply-suggestions { runId, suggestionIds[] }` SSE — sequential Stage 7 section regenerate on selected risk points (destructive, confirmation modal).
- `GET /api/runs/[runId]/avd` — hydration endpoint.
- Per-run dedup on auto-trigger.

### Step 5 — UI
- `<AvdPredictorCard>` parent state machine + 6 subviews:
  - `AvdPredictingView` (mockup State 1)
  - `AvdRetentionCurveSvg` (gradient under line, dotted benchmarks, marker dots at risk points)
  - `AvdMainView` (big predicted AVD + ratio + CI display, risk-points list, comparison panel, calibration sub-card "pending")
  - `AvdApplySuggestionsModal` (lists affected sections, sequential Stage 7 regen with confirmation)
  - `AvdMethodologySidePanel` (Phase 2.1 polish; Phase 2 minimum is tooltip)
- Low-AVD warning state when `predictedAvdRatio < 50%`.

### Step 6 — Integration & testing
- Parallel with Stage 8: both run off `'scripted'` event; neither serializes the other.
- `SCRIPT_TOO_SHORT` graceful fallback to niche baseline (not error).
- `avd_data.calibration.state === 'pending'` until Feature #17 populates.
- `multiplierBreakdown` exposed via SSE only — NOT persisted (allows heuristic replacement without migration).
- Feature #15 reads `predictedAvdRatio` for Feature #16 (compound forecast).
- `apply-suggestions` triggers Stage 7 regenerate-section sequentially, not parallel (avoids racing on `script_data`).

## Cross-feature contracts

- Reads `pipeline_runs.script_data` (Phase 2.5), `channels.niche/median_views/subscriber_count/top_videos_json` (Phase 1.5), `outlier_corpus.estimated_avd_ratio` (Phase 3.1 — graceful fallback).
- Writes `pipeline_runs.avd_data` — Feature #17 (calibration) writes only `calibration` subfield via typed accessor `setRunAvdCalibration`. Feature #16 (compound forecast) reads `predictedAvdRatio`.
- Auto-triggers off `'scripted'` event in parallel with Stage 8 lint; both write to different columns.

## Verification

- [ ] `POST /api/pipeline/avd-predict` completes in parallel with `/lint` without serializing (test: both running concurrently, both write to their column independently)
- [ ] `retentionCurve` has data points every 30s of script duration (verified by stride check)
- [ ] `apply-suggestions` triggers Stage 7 regenerate-section sequentially (not parallel) on selected sectionIds
- [ ] `SCRIPT_TOO_SHORT` (<2min) flags and predicts at niche baseline; does NOT error
- [ ] `predictedAvdRatio` clamped to ≥25%
- [ ] `confidenceInterval.lowerSec` clamped at 25% of `predictedAvdSec`
- [ ] `avd_data.calibration.state === 'pending'` initially; Feature #17 transition tested via fixture
- [ ] `multiplierBreakdown` exposed via SSE `complete` payload but NOT persisted in DB
- [ ] No CRIT-1/2/3/4 violation in test grep
- [ ] Auto-trigger off `'scripted'` event does NOT cause Stage 9 to wait on `'avd_predicted'`
- [ ] Heuristic formula matches `nicheBase × 0.6 + channelBase × 0.4 × multipliers` (snapshot test against fixtures)
- [ ] Risk-point detector flags ≥10pp drops within 60s windows

## Out of scope

- Apply-suggestions diff preview UX (Phase 3 candidate)
- Apply-suggestions parallel regen (would race on script_data)
- Real YouTube Analytics OAuth (Phase 3)
- Per-channel real personality calibration (Feature #19)
- Trained ML predictor (heuristic Phase 2; trained Phase 3+)
- Auto-invalidate predictor on niche edits (manual re-run only)
