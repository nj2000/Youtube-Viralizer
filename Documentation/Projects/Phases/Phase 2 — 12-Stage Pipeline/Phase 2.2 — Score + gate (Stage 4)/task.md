# Phase 2.2 — Score + gate (Stage 4)

**Parent:** Phase 2 — 12-Stage Pipeline
**Status:** Complete
**Estimated:** 6-8 hours
**Depends on:** Phase 2.1 (competitor_data)
**Spec:** `Documentation/Overviews and Summaries/05-virality-score-gate/spec.md`

## Goal

Opus 4.7 scores the idea on 5 dimensions; weighted average gives `finalScore`. Below 92, status flips to `gated_failed`, pipeline halts, and reframe suggestions render. Above 92, orchestrator advances to Stage 5. Override path persists with audit row for Feature #17 calibration.

## What to Build

### Step 1 — Data layer
- `ScoreDataSchema`: `finalScore` (0-100 number, TS-recomputed not model-supplied), `dimensions: { hook_strength, curiosity_gap, outlier_alignment, niche_fit, title_ability }` each 0-100, `reasoning: string`, `passed: boolean`, `reframes: ReframeSchema[] | null`, `reframeShortfall: boolean`, `gateOverriddenAt: timestamp | null`. Schema version literal.
- ReframeSchema: `{revisedIdeaText, hypothesis, expectedScoreLift}`.
- Migration: extend `pipeline_run_status` enum to add `scored_overridden` (separates passed-naturally from passed-via-override).
- New `reframe_applications` audit table: `{id, run_id FK, reframe_index, applied_at}`. RLS auth.uid().
- `lib/db/score.ts`: typed CRUD with on-read Zod parse.

### Step 2 — Service + prompt
- `lib/prompts/score.ts`: Opus 4.7 system prompt with `cache_control`. Attribution `// Adapted from AgriciDaniel/claude-youtube (MIT) — sub-skills/ideate.md`. ~5-section structure: 5 dimensions defined with rubric anchors + outlier-pattern criteria + 92-gate rule.
- `lib/services/score.ts`: single Anthropic call returns structured JSON with dimensions only (model is NOT trusted for arithmetic). TS recomputes `finalScore = hook×0.25 + curiosity×0.25 + outlier×0.20 + niche×0.20 + title×0.10`. `passed = finalScore >= 92`. Two-pass reframe: first call includes reframe ask; if missing/empty when `passed=false`, second cheap follow-up call (cache hit). Mark `reframeShortfall: true` if 2nd call still <3 reframes.

### Step 3 — API endpoints
- `app/api/pipeline/score/route.ts`: POST `{runId}` SSE. Simulated per-dimension streaming at ~250ms intervals for UX parity with mockup (single underlying call, theatrical streaming).
- `app/api/runs/[runId]/override-gate/route.ts`: POST sets `score_data.gateOverriddenAt = now()`, transitions status to `scored_overridden`, allows orchestrator to advance. DELETE clears override (re-locks gate).
- `app/api/runs/[runId]/apply-reframe/route.ts`: POST `{reframeIndex}` — transactional wipe of `competitor_data` AND `score_data` (must re-run Stage 3 against new idea), updates `idea_text` to `reframes[index].revisedIdeaText`, inserts `reframe_applications` row, kicks off Stage 3.

### Step 4 — UI
- StageScoreCard variants: scoring (Opus reasoning, simulated streaming progress), passed (big green score, dimension bars, expandable reasoning, "Continue to titles" CTA), failed (amber score, what's-missing panel, 3 reframe cards, "Use this angle and re-run" + "Override and continue" buttons).
- ReframeConfirmModal: warns "applying reframe wipes Stage 3 + Stage 4 outputs and re-runs from Stage 3".
- GateOverriddenRibbon: persistent badge when `gateOverriddenAt` set.
- Low-confidence state: <10 outliers in competitor_data + `passed=false` shows warning that score may be noisy.

### Step 5 — Integration & testing
- Gate transition tests: running → complete (≥92), running → gated_failed (<92), running → scored_overridden (manual).
- Reframe apply wipes both columns in single transaction (verified by mid-transaction interruption test).
- Override persists across re-scores (if re-score now passes naturally, `gateOverriddenAt` preserved for audit but UI stops rendering badge).
- TS arithmetic test: model returns dimensions, TS-computed finalScore matches weighted formula within 0.01.
- Prompt-cache hit verification.

## Cross-feature contracts

- Reads `pipeline_runs.idea_text`, `competitor_data` (Phase 2.1), `channels.niche` (Phase 1.5).
- Writes `pipeline_runs.score_data` — consumed by Stages 5-12 + Feature #14 (hybrid scoring) + Feature #17 (calibration).
- `pipeline_runs.status` adds `scored_overridden` value.
- `reframe_applications` table read by Feature #17 in Phase 2.

## Verification

- [ ] `ScoreDataSchema` rejects finalScore not in 0-100
- [ ] TS-recomputed `finalScore === weighted_sum(dimensions)` within 0.01 (model arithmetic not trusted)
- [ ] Score <92 → `pipeline_runs.status = 'gated_failed'`; ≥92 → `complete` (this stage) → next stage queues
- [ ] When `passed=false` and no reframes returned, second call fires; if still empty, `reframeShortfall: true`
- [ ] POST `/override-gate` sets `gateOverriddenAt`, status→`scored_overridden`, orchestrator advances
- [ ] POST `/apply-reframe { reframeIndex: 0 }` wipes `competitor_data` AND `score_data` in single transaction; inserts `reframe_applications` row; `idea_text` updated
- [ ] System prompt has `cache_control: ephemeral`; 2nd score call shows `cache_read_input_tokens > 0`
- [ ] CRIT-2 confirms `claude-opus-4-7` model literal in code
- [ ] No CLAUDE.md updates required (existing CRIT-2 row covers Stage 4)
- [ ] Override persists across re-scores; badge hides when natural pass occurs

## Out of scope

- Hybrid scoring with empirical corpus (Feature #14)
- Per-niche calibration multipliers (Feature #17)
- Score caching across calls (every score call re-runs Anthropic; only system-prompt cache shared)
