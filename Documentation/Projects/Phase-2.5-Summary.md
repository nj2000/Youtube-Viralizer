# Phase 2.5 — Retention Script (Stage 7)

**Status:** Complete · **Date:** 2026-05-21 · **Branch:** `main`
**Detail:** `Phases/Phase 2 — 12-Stage Pipeline/Phase 2.5 — Retention script (Stage 7)/summary.md`

## What was built
The heaviest stage. Opus 4.7 streams a full retention-engineered script token-by-token (true `messages.stream()`) into a deterministic section structure. **The first direct-SSE stage:** `POST /api/pipeline/script` returns its own long-lived event stream (section_chunk / section_complete / rehook_inserted / loop_opened / loop_closed / complete / error), consumed by the new `useScriptStream` hook — the bus is untouched.

- Deterministic section taxonomy (5/8/12/20 min → 4/6/8/10 sections). `[SKELETON]`/`[PERSONALITY]` are paragraph `marker` fields, never inline brackets. The locked hook is reproduced verbatim (whitespace-normalized) as `sections[0].paragraphs[0]`.
- Format violations get exactly one re-prompt then `FORMAT_VIOLATION`. TS retention curve (`retention-curve.ts`, sampled every 30s). Non-blocking drift (2 Haiku calls). Haiku voice fingerprint (7-day cached). All non-DAG sub-calls go through the new `callHaiku` helper.
- **Budget + rate-limit infra:** `anthropic_spend_daily` + `script_gen_throttle` tables; 503 BUDGET_EXCEEDED (`ANTHROPIC_DAILY_BUDGET_USD`, default $50) + 429 RATE_LIMITED (30 full/24h, 60 section/24h).
- Script is a **manual-trigger stage** (`MANUAL_STAGES={script}`): the auto-chain stops before it, the length picker fires it, and it auto-queues lint on completion.

## Key decisions (both user-confirmed)
- **True token streaming via a dedicated SSE endpoint** (the bus union is closed and too noisy for token deltas) — the only stage that doesn't use the fire-and-forget bus.
- **Built the full budget/rate-limit infra now** — Opus script gen is the most expensive call in the app, so the spend guard ships with it.

## Headline files
`lib/anthropic/stream.ts` (`callClaudeStream` + cost estimator) + `callHaiku`, `lib/validation/script.ts` (+ section templates), `lib/services/{script,script-parse,script-mutations,retention-curve,script-budget,script-drift,voice-fingerprint}.ts`, `lib/db/script.ts`, `app/api/pipeline/script/{route,regenerate-section,relock,plain-text}`, `lib/hooks/useScriptStream.ts`, `Stage7Card.tsx` + `stage7/*`, migration `0010_script.sql`.

## How to verify
```bash
pnpm typecheck && pnpm lint && pnpm test   # 103 specs
```
All 14 task.md boxes pass (≥50 section_chunk events, marker-as-field, 30s retention sampling, format re-prompt, drift in payload, verbatim hook, auto-queue lint, re-pick clears, rate limits, budget, concurrency 409, prompt cache, Opus+Haiku split, env var + CLAUDE.md).

## Issues / deviations
- **NOT browser-tested** — parser/validation/retention/budget are unit-tested, but the live Opus stream + typewriter UI weren't run interactively.
- Concurrency guard is best-effort (in-memory per server instance), since paused runs sit at `status="running"`.
- `generateScript` writes `script_data` directly (bypasses `markStageComplete`), so the staleness cascade isn't triggered on regen — harmless while downstream are stubs.
