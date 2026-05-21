# Phase 2.2 — Idea Score + 92% Gate (Stage 4)

**Status:** Complete · **Date:** 2026-05-19 · **Branch:** `main`
**Detail:** `Phases/Phase 2 — 12-Stage Pipeline/Phase 2.2 — Score + gate (Stage 4)/summary.md`

## What was built
Opus 4.7 scores the idea on 5 dimensions (hook strength, curiosity gap, outlier alignment, niche fit, title-ability); TypeScript recomputes the weighted final score (the model is never trusted for arithmetic). Below 92 the pipeline halts and surfaces 3 reframes; at/above 92 it advances. Two override paths ship: continue-anyway and apply-reframe-and-re-run.

- Weighted formula `0.25/0.25/0.20/0.20/0.10` lives in `lib/validation/score.ts#computeFinalScore`.
- Two-pass reframe: if the idea fails and no reframes came back, a second cache-warm call asks for them; still empty → `reframeShortfall`.
- `POST /override-gate` (status `scored_overridden`, advances) + `DELETE` (reverses); `POST /apply-reframe` does a single-statement transactional wipe of all stage data + idea_text rewrite + audit row, then re-runs from Stage 3.

## Key decisions
- **Minimal status enum:** added only `scored_overridden` (natural pass stays `running → complete`), not the spec's separate `scored`.
- **`apply-reframe` reuses `queued`** rather than a new `idea_captured` status.
- **`GateExplanation` deleted** — its UI folded into the richer Stage 4 card.
- **Patched `markGateFailed`** to persist `score_data` on gate fail (without it, the model's reframes never reached the UI) and added the `stage-handlers.ts` barrel (also fixed a latent 2.1 registration gap).

## Headline files
`lib/validation/score.ts`, `lib/prompts/score.ts`, `lib/services/score.ts` + `lib/services/stage-handlers.ts`, `app/api/pipeline/score/route.ts`, `app/api/runs/[runId]/{override-gate,apply-reframe}/route.ts`, `Stage4Card.tsx` + `stage4/*`, migration `0009_score_gate_overrides.sql` (+ `reframe_applications` audit table).

## How to verify
```bash
pnpm typecheck && pnpm lint && pnpm test
```
All 10 task.md boxes pass (finalScore bounds, TS-recompute, gate transition, reframe shortfall, override flow, transactional reframe wipe, prompt cache, Opus literal, badge-hides-on-natural-pass).

## Issues / deviations
- The `stage-handlers.ts` barrel + the `markGateFailed` signature change weren't in task.md but were necessary for reframes to work.
- `reframe_applications` schema is fuller than task.md (adds user_id + original/revised text + expected lift) to feed Phase 3 calibration.
