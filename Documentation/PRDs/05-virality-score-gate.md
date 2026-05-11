# PRD — Virality Score + 92% Gate (Stage 4)

## Feature Name
Virality Score + 92% Gate

## Overview
Scores the user's idea on a 0–100 virality scale grounded in the competitor outlier patterns from Stage 3. If the score is below 92, the pipeline halts and the user receives concrete reframes that would push the idea above threshold. Above 92, the full pipeline proceeds.

**Problem solved:** Most creators pour effort into ideas that statistically have no chance, then blame the algorithm. The gate forces a hard "is this worth filming" decision *before* spending time on titles, scripts, and thumbnails.

## User Stories
- As a creator, I want a single number that tells me whether my idea has viral potential, so I can decide whether to film it.
- As a creator, I want the score to be grounded in real outlier patterns from my niche, so it's not generic vibes.
- As a creator, I want concrete reframes when my idea fails the gate, so I can iterate to a better idea instead of guessing.
- As a creator, I want to see *why* my idea scored what it did, so I can build intuition for my niche over time.
- As a creator, I want the option to override the gate and force the pipeline to continue, so the system doesn't paternalistically block me.

## Functional Requirements
- Input: idea text + Stage 3 competitor outlier data + channel niche
- Score on 0–100 scale, rounded to integer
- Score must include a breakdown by sub-dimension: trend alignment, hook strength, audience-cluster match, novelty, specificity
- Gate threshold: 92 (constant in v1, configurable in `lib/config.ts` for tuning)
- If gated: return 3 reframe suggestions, each predicted to score above 92 with brief rationale
- If passing: return rationale paragraph explaining the strongest signals
- Persist `score_data` JSON to `pipeline_runs` row
- Pipeline orchestrator halts downstream stages when `score_data.passed === false`
- "Override gate" action available on the run view; when invoked, downstream stages run with a flag indicating the gate was overridden
- Score and gate decision must be deterministic enough that re-running the same idea twice produces scores within ±3 points

## User Interface

### Screens
Renders as a card within `/runs/[runId]`. Critical card visually — sets pipeline outcome.

### Card layout (passing)
- Large score number (e.g., "94 / 100") with green pass indicator
- Sub-dimension breakdown as small bar chart: trend alignment, hook strength, audience-cluster match, novelty, specificity
- Short rationale paragraph
- "Regenerate" button

### Card layout (gated)
- Large score number (e.g., "78 / 100") with yellow gate indicator
- Sub-dimension breakdown
- "Why this didn't pass" explanation
- 3 reframe suggestions, each as a clickable card showing predicted score
- Clicking a reframe opens a confirmation: "Replace your idea with this reframe and re-run?"
- "Override gate and continue" button (secondary, less prominent)

### Key interactions
- Clicking a reframe replaces the idea text and re-runs from Stage 3
- Override gate triggers downstream stages with a UI flag throughout the run view

## States to Handle

### Happy path (passing)
Score computed → ≥92 → rationale rendered → pipeline continues to Stage 5.

### Happy path (gated)
Score computed → <92 → reframes rendered → pipeline halts → user picks a reframe or overrides.

### Error states
- Stage 3 outlier data missing → error: "Score requires competitor data. Re-run Stage 3 first."
- LLM upstream error → retry per CLAUDE.md EXT-3
- LLM returns malformed score (non-integer, out of range) → re-prompt once with explicit format instruction; if second attempt fails, error
- LLM returns fewer than 3 reframes when gated → render what was returned; warn user

### Empty states
- Stage 3 returned zero outliers → score still runs but with reduced confidence; render "Low confidence — competitor data was sparse"

### Loading states
- Card shows spinner with text "Scoring against N outlier patterns…"

## Edge Cases
- Idea is highly speculative or conceptual (no clear comparable in outlier data) → flag low confidence, don't refuse
- Idea matches an outlier pattern that's already saturated (everyone is making this video) → score should reflect saturation; reframes should suggest novelty angles
- Idea is on-niche but seasonal (e.g., New Year resolutions in July) → score should reflect timing; reframes may suggest evergreen angle
- User overrides gate, downstream stages run and produce weak output → run view shows persistent "gate-overridden" badge so user can interpret results
- Idea is a follow-up to a previous video (sequel logic) → no special handling in v1; treat as standalone
- Re-running the score on the same idea produces a different result → expected within ±3 points; if larger drift, flag as instability for tuning

## Out of Scope
- Hybrid scoring grounded in real outlier corpus (Feature #14, Phase 2 — improves this stage but the contract stays the same)
- Tracking how often the user overrides the gate
- Score history per channel (which ideas scored what over time)
- Adjusting threshold per user or per niche
- Confidence intervals on the score itself
- Calibration against published outcomes (Feature #17, Phase 2)
