# PRD — AVD Predictor

## Feature Name
Average View Duration (AVD) Predictor

## Overview
Predicts the likely AVD percentage of the generated script before the user films it, based on script structure (rehook density, open-loop closures, section pacing, length, topic complexity). Flags dead zones and suggests structural fixes.

**Problem solved:** Stage 7 produces a structurally engineered script, but creators have no way to know whether the structure will actually hold viewers. AVD predictor closes the gap between "we engineered it" and "will it work."

## User Stories
- As a creator, I want a predicted AVD percentage before I film, so I know whether to ship or revise.
- As a creator, I want dead zones flagged with timestamps, so I know exactly where to tighten the script.
- As a creator, I want the predictor calibrated to my channel's historical retention, so the prediction is realistic for me, not generic.
- As a creator, I want suggestions for fixing dead zones, so the predictor adds value beyond a number.

## Functional Requirements
- Input: full script (Stage 7), section breakdown, niche, target length, channel's historical AVD if available
- Output:
  - Predicted AVD: percentage (e.g., "estimated 62%")
  - Confidence interval (±N percentage points)
  - Retention curve graph: predicted retention by minute, similar to YouTube Studio's retention graph
  - Dead-zone list: timestamps + 1-sentence problem description + suggested fix
  - Comparison: vs. "solid" (50–60%), "viral zone" (70%+) thresholds
- Persists to a new `avd_data` JSON field on `pipeline_runs`
- Runs after Stage 7 (script) and Stage 8 (lint) complete
- Re-runs automatically if script is regenerated

## User Interface

### Screens
New card within `/runs/[runId]`, between Stage 8 (lint) and Stage 9 (thumbnails) in the visual order.

### Card layout
- Header: "AVD Prediction" + status + "Re-run"
- Top-line predicted AVD percentage with classification badge (solid / viral zone / risky)
- Retention curve graph (small inline chart)
- Dead zones list with timestamps, problem, suggested fix
- Compare-to-channel-baseline note if channel AVD history is available

### Key interactions
- Click a dead zone to scroll to its location in the script card and highlight the affected segment
- Suggested fix is copyable

## States to Handle

### Happy path
Script complete → predictor runs → AVD computed → curve and dead zones rendered.

### Error states
- Script missing or empty → error
- Channel history unavailable → run with niche-baseline only; flag lower confidence
- LLM upstream error → retry per CLAUDE.md EXT-3

### Empty states
- Script is shorter than 3 minutes → prediction less reliable; flag confidence

### Loading states
- Card shows spinner with text "Predicting retention curve…"

## Edge Cases
- Script has no clear sections (single long monologue) → predictor flags it as a structural risk regardless of topic
- Script is highly informational / educational → audience expects information density; predictor weights structure differently than entertainment
- Channel's historical AVD is dramatically high or low (e.g., 90% on 1-min Shorts) → use only long-form historicals
- Topic is one viewers actively seek (high-intent search) → AVD prediction skews higher; predictor accounts for traffic-source mix
- User edits script manually after generation → predictor must re-run; flag if stale

## Out of Scope
- Predicting CTR (separate signal)
- Predicting traffic-source mix
- Predicting subscriber conversion
- Predicting final view count
- Per-second prediction granularity (per-minute is sufficient)
- Auto-rewriting dead zones (Phase 3 candidate)
- Comparing to anonymized peer-channel AVD distributions
