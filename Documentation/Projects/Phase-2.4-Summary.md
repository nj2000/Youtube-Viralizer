# Phase 2.4 — Cold-Open Hook (Stage 6)

**Status:** Complete · **Date:** 2026-05-20 · **Branch:** `main`
**Detail:** `Phases/Phase 2 — 12-Stage Pipeline/Phase 2.4 — Hook (Stage 6)/summary.md`

## What was built
Haiku 4.5 writes three cold-open hooks in a single call (one per title), each ≤30s spoken with timestamped beats and B-roll cues. Every retention/risk metric is computed in TypeScript — the model only self-grades opener strength. **Hook is the pipeline's second checkpoint:** the run pauses until the user locks a variant, which becomes the script's first section.

- Five archetypes (shock / curiosity-gap / story / problem-agitation / social-proof — from the spec, shared with Stage 7).
- TS metrics (`hook-metrics.ts`, unit-tested): wordCount (spoken lines only), speakTimeSec (ceil(words/150·60)), retention30sPredict (archetype prior + opener strength + word penalty + concrete-anchor bonus + anti-pattern penalty + setup-transition bonus), dropoffRiskRating with a killer-combo override.
- `linkedTitleIndex` must form the set {0,1,2}: one re-prompt, then force-distinct + `ARCHETYPE_DUPLICATE` warning. `ALL_HIGH_RISK` is a non-blocking flag.

## Key decisions
- **Spec archetype enum over task.md's** (`shock/question/demonstration/...`) — CLAUDE.md says the spec supersedes, and the enum is shared with Stage 7.
- **Second checkpoint:** `PAUSE_AFTER` now `{titles, hook}`; the `/continue` route is state-driven (hook after a title lock, thumbnails after a hook lock). `canRunStage` gates Stage 7 on a locked hook. Fixed `stageDependencies.hook` to include `titles`.

## Headline files
`lib/validation/hook.ts`, `lib/services/hook-metrics.ts` (pure, tested), `lib/prompts/hook.ts`, `lib/services/{hook,hook-llm}.ts`, `lib/db/hook.ts`, `app/api/pipeline/hook/{route,regenerate,lock}`, `Stage6Card.tsx` + `stage6/*`.

## How to verify
```bash
pnpm typecheck && pnpm lint && pnpm test
```
All 8 task.md boxes pass (set-equality re-prompt, TS-computed metrics, lock, ALL_HIGH_RISK 200, prompt cache, Haiku literal, attribution, Stage 7 reads locked hook).

## Issues / deviations
- Used the spec's archetype enum (documented so Stage 7 inherits the right set).
- Per-variant regenerate reuses the full 3-variant call and splices the matching one; regenerating the locked variant clears the lock.
