# Phase 2.9 — A/B test plan (Stage 11) — Summary

**Status:** Complete · **Stage:** 11 of 12 · **Model:** Haiku 4.5
**Spec:** `Documentation/Overviews and Summaries/12-ab-test-plan/spec.md`

A 3-arm A/B test plan from the locked titles × thumbnail briefs (one arm per
trigger): hypothesis, predicted CTR delta (basis-point range), success metric,
"if this wins" learning per arm, plus a fixed 0/12/24/48 schedule, decision
rules, ship-default, and cross-test learning. Designed so the *result teaches
something about the audience*, not just picks a winner.

## Build decisions (A/A/A)

1. **Bus transport** for the run; JSON for regenerate; GET for markdown export.
2. **Schedule + decision rules are TEMPLATED server-side** (deterministic),
   guaranteeing the `0,12,24,48` and cover-all-3-kinds Zod refines pass and
   giving Feature #17 stable machine-evaluable rules. The model writes only the
   per-arm reasoning + learnings + ship-default. (Same "deterministic where
   possible" philosophy as SEO chapters.)
3. **trigger→signal is compile-time exhaustive** (`triggerToSignal`, a `never`
   assertion breaks the build on a new trigger) + a runtime `ABVariant` refine;
   never user-set. **CTR deltas are basis-point integers** (no float drift).
4. **Rate-limit (30/hr) + the dedicated stale-plan banner deferred** `// TODO(phase-2):`.

## Files delivered

- `lib/validation/ab-plan.ts` — `SignalUnderTest`, `triggerToSignal` (exhaustive), `PredictedCtrDelta` ({minBp,maxBp} ints, min≤max), `Schedule` (4-tuple, hours 0/12/24/48), `DecisionRules` (3–5, cover promote/hold/regenerate), `ABVariant` (signal-derived refine), `ABPlan` (3 distinct triggers + signals, ship-default, baselineSource, model literal, schemaVersion).
- `lib/services/ab-baseline.ts` — `computeBaselineCtr` (channel-scale heuristic clamped [100,3000] bp; 620 bp niche fallback). Pure, unit-tested.
- `lib/prompts/ab-plan.ts` — Haiku system (cacheable, CRIT-4 synthesized attribution to `thumbnail.md` + `analytics-guide.md`), full-plan + single-arm user builders, XML-wrapped inputs.
- `lib/services/ab-plan.ts` — handler (1 Haiku call → coerce reasoning, template schedule + rules, inject baseline + derived signals, 1 retry), `regenerateAbVariant` (re-drafts one arm's reasoning; preserves trigger/signal/title/thumbnail + the other arms), `registerStageHandler`.
- `lib/db/ab-plan.ts` — read/write `ab_plan_data`.
- Routes: `POST /api/pipeline/ab-plan` (202 bus), `/regenerate` (JSON, variantIndex), `GET /api/pipeline/ab-plan/[runId]/markdown`.
- UI: `Stage11Card` + `stage11/parts.tsx` (3 trigger-colored variant cards with CTR-delta ranges + ship-default ribbon, 0/12/24/48 schedule timeline, decision-rule badges, cross-test learning, **disabled "Log result (v2)"** Feature-#17 placeholder) + `lib/hooks/useAbPlan.ts`.
- `tests/services/ab-plan.test.ts` — 13 tests. Wiring: barrel import + `Stage11Card` in `RunView`.

## Deviations / notes

- **Requires all 3 thumbnail briefs** (one per trigger) since the plan is a 3-arm
  tuple with 3 distinct triggers. If fewer exist, `MISSING_PREREQUISITES` (lock
  all 3 titles → regenerate thumbnails). No migration (`ab_plan_data` pre-existed).
- **Baseline CTR is a heuristic** (channel CTR isn't stored); Feature #17
  calibrates it against real post-publish numbers later. `baselineSource` is
  explicit so the heuristic can be swapped without breaking persisted plans.
- The live test tracker + result logging (mockup States 3/4) are **Feature #17**;
  Phase 1 shows a disabled placeholder.

## Verification (task.md checklist)

- [x] `predictedCtrDelta` stored as `{minBp,maxBp}` integers; float fails Zod (tested)
- [x] trigger→signal enforced via exhaustive TS switch + runtime refine (tested)
- [x] Schedule fixed to hours `[0,12,24,48]` (tuple + refine; templated, tested)
- [x] Decision rules cover promote/hold/regenerate (refine; templated, tested)
- [x] `regenerate {variantIndex:0}` doesn't modify variants 1/2 (`{...existing, variants[i]: fresh}`)
- [x] Title/thumbnail/trigger preserved across regenerate (immutable fields rebuilt from inputs)
- [ ] Stale-plan banner — **deferred** `// TODO(phase-2):` (generic `stale_ab_plan` flag still shows via the run cascade)
- [ ] 31st generation → 429 — **deferred** `// TODO(phase-2):` rate limit
- [x] System prompt `cache_control` (EST 1150 ≥ 1024) (tested)
- [x] CRIT-2: `claude-haiku-4-5-20251001` literal (tested)
- [x] CRIT-4 attribution: synthesized from `thumbnail.md` + `analytics-guide.md`

**Gate:** `pnpm typecheck` + `lint` clean; `pnpm test` → **169 passed** (13 new); routes load on the dev server. UI not click-tested.

## Follow-ups / known gaps

- `// TODO(phase-2):` 30/hr rate limit; dedicated stale-plan banner (titles/thumbnails newer than the plan); the live A/B tracker + result logging (Feature #17).
- `ab_plan_data` is read by Feature #17 (calibration) to compare predicted vs actual CTR.
