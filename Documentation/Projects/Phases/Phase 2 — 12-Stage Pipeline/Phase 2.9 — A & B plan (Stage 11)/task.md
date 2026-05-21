# Phase 2.9 — A/B test plan (Stage 11)

**Parent:** Phase 2 — 12-Stage Pipeline
**Status:** Complete
**Estimated:** 4-6 hours
**Depends on:** Phase 2.3 (3 locked titles), Phase 2.7 (3 thumbnail briefs)
**Spec:** `Documentation/Overviews and Summaries/12-ab-test-plan/spec.md`

## Goal

Haiku 4.5 synthesizes a structured A/B test plan: 3 variants (title × thumbnail brief paired by trigger), hypothesis per variant, predicted CTR delta as basis-point integer range, success metric per signal-under-test, schedule timeline, decision rules. Phase 1 ships the plan; Feature #17 calibration loop reads outcomes post-publish.

## What to Build

### Step 1 — Data layer
- `lib/validation/ab-plan.ts`: closed enums `TriggerKey = 'curiosity'|'fear'|'result'`, `SignalUnderTestEnum = 'information_seeking'|'loss_aversion'|'practicality'`. Compile-time exhaustive switch `triggerToSignal(trigger)` mapping curiosity→information_seeking, fear→loss_aversion, result→practicality (forces all triggers covered via `const _exhaustive: never = t`). Runtime `validateTriggerSignalMapping` re-check.
- `PredictedCtrDeltaSchema = {minBp: int, maxBp: int}` with refine `minBp <= maxBp` (basis-point integers, not floats — avoids drift).
- `ABVariantSchema = {trigger, signalUnderTest (derived), titleText, thumbnailBriefRef (trigger key), hypothesis (string, NOT numeric), predictedCtrDelta, successMetric, ifThisWinsLearning}`. `ScheduleStepSchema = {hour: 0|12|24|48, label, description}` tuple of literal hour values.
- `DecisionRuleSchema = {kind: 'promote'|'hold'|'regenerate', condition, action}`. `ABPlanSchema = {variants: ABVariant[3] (tuple), schedule: ScheduleStep[4] (tuple), decisionRules: DecisionRule[] covering all 3 kinds, expectedLearning, baselineCtr, baselineSource: 'channel_actual'|'niche_average_fallback', shipDefault: 0|1|2, generatedAt, schemaVersion: 1}` with `validateDecisionRulesCoverAllKinds` cross-validator.

### Step 2 — Service + prompt
- `lib/services/ab-plan/baseline.ts`: `computeBaselineCtr(channel)` — `channel_actual` derived from `subscriber_count` + `median_views` clamped [1%, 30%] (return basis points). `niche_average_fallback = 620 bp` for new channels.
- `lib/prompts/abPlan.ts`: Haiku 4.5 system prompt ≥1024 tokens with `cache_control`. Attribution `// Synthesized from claude-youtube/sub-skills/seo.md + thumbnail.md (MIT — Daniel Agrici)` per Build Order §2.9 (no direct equivalent subskill). User prompt wraps title × thumbnail pairs + niche in XML trust-boundary blocks. Includes ship-default re-prompt instruction.
- `lib/services/ab-plan.ts`: single Haiku call returns variants + schedule + rules + shipDefault. 1-retry validation feedback loop on Zod failure. `regenerateVariant(runId, variantIndex)` rewrites only `hypothesis`/`predictedCtrDelta`/`successMetric`/`ifThisWinsLearning` — preserves `trigger`/`signalUnderTest`/`titleText`/`thumbnailBriefRef`.

### Step 3 — API endpoints
- `POST /api/pipeline/ab-plan { runId }` SSE.
- `POST /api/pipeline/ab-plan/regenerate { runId, variantIndex }` SSE — bounded scope (no title/thumbnail mutation).
- `GET /api/pipeline/ab-plan/[runId]/markdown` — deterministic markdown export with `escapeMarkdownCell`.
- Per-user 30 generations/hour throttle (shared with regenerate).

### Step 4 — UI
- ABPlanCard state machine: idle / streaming / ready / test-running-placeholder.
- 3 variant cards (one per trigger color), title × thumbnail side-by-side, hypothesis text, predicted CTR delta as range `"+8% to +14%"` (basis-point to percent at render), success metric, ship-default ribbon on best variant.
- ScheduleTimeline (h0/h12/h24/h48 with vertical connector).
- DecisionRules card with kind badges (promote/hold/regenerate).
- ExpectedLearning panel: cross-test learning paragraph.
- TestRunningPlaceholder feature-flagged `NEXT_PUBLIC_FEATURE_AB_TRACKER` (full live tracker is Feature #17 Phase 2). Hint banner: "After you publish, manually note hour-24 and hour-48 CTRs. Logging a result will become available in v2."

### Step 5 — Integration & testing
- Per-variant regenerate isolation: byte-identical `variants[1]` and `variants[2]` after regenerate of `variants[0]` (deep-diff verified).
- `predictedCtrDelta` stored as `{minBp, maxBp}` integers — negative test on float input fails Zod parse.
- Trigger→signal mapping enforced at compile time (TS error on `case 'unknown'`) + runtime cross-check.
- Schedule locked to `[0,12,24,48]` via Zod tuple of literal hour values.
- `validateDecisionRulesCoverAllKinds` ensures rules cover `{promote, hold, regenerate}`.
- Stale-plan banner when `titles_data.generatedAt > ab_plan_generated_at` or `thumbnails_data.generatedAt > ab_plan_generated_at`.
- 30 generations/hour throttle (markdown GET excluded).
- Prompt-cache verified.

## Cross-feature contracts

- Reads `pipeline_runs.titles_data` (locked), `thumbnails_data`, `channels.subscriber_count`, `channels.median_views`.
- Writes `pipeline_runs.ab_plan_data` — read by Feature #17 (calibration) to compare predicted CTR delta vs actual post-publish performance.
- `baselineSource` field is explicit so Feature #17 can replace heuristic without breaking persisted plans.
- Forward-compat: `ab_test_outcomes` table NOT created here (Feature #17 owns it).

## Verification

- [ ] `predictedCtrDelta` stored as `{minBp, maxBp}` integers; float input fails Zod parse
- [ ] Trigger→signal mapping enforced via exhaustive TS switch (compile-time)
- [ ] Schedule fixed to hours `[0,12,24,48]` (Zod tuple of literals)
- [ ] DecisionRules must cover all 3 kinds (`validateDecisionRulesCoverAllKinds` refine)
- [ ] `regenerate { variantIndex: 0 }` does NOT modify `variants[1]` or `variants[2]` (deep diff verified)
- [ ] Title/thumbnail-brief preserved across regenerate (cannot mutate via Stage 11)
- [ ] Stale-plan banner triggers when `titles_data.generatedAt > ab_plan_generated_at`
- [ ] 31st generation in rolling hour returns 429 RATE_LIMITED
- [ ] System prompt has `cache_control`; 2nd call shows `cache_read_input_tokens > 0`
- [ ] CRIT-2: `claude-haiku-4-5-20251001` literal
- [ ] CRIT-4 attribution: synthesized from seo.md + thumbnail.md

## Out of scope

- Live A/B test tracker (Feature #17 Phase 2)
- `ab_test_outcomes` table (Feature #17 owns)
- Auto-promote winner to YouTube (no YouTube write API)
- User-editable trigger/signal mapping (locked at code level)
