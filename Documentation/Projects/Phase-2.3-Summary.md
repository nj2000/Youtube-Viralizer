# Phase 2.3 — Titles (Stage 5)

**Status:** Complete · **Date:** 2026-05-20 · **Branch:** `main`
**Detail:** `Phases/Phase 2 — 12-Stage Pipeline/Phase 2.3 — Titles (Stage 5)/summary.md`

## What was built
Haiku 4.5 writes three titles, one per psychological trigger (curiosity / fear / result), via three sequential calls sharing one cached system prompt plus a fourth intent-rewrite call. **Stage 5 is the pipeline's first user checkpoint:** the run pauses after generating until the user locks at least one title, which unblocks the downstream fan-out.

- Voice samples pulled from the channel's last-20 video titles (niche fallback under 3).
- Jaccard diversity check (>0.6 between any two → one retry → `diversityWarning`); per-trigger char-limit truncate + re-prompt (2nd over-limit → `CHAR_LIMIT_VIOLATION`).
- Lock / unlock / regenerate-single-trigger endpoints (other triggers preserved byte-for-byte).

## Key decisions
- **Pause-after-titles checkpoint:** `PAUSE_AFTER={titles}`; `POST /api/runs/[runId]/continue` resumes the chain. `canRunStage`/`hasLockedTitle` gate the fan-out on a locked title.
- **Hybrid schema:** flat trigger keys (so `titles_data.<trigger>.lockedIn` holds) + the spec's rich per-variant fields (charCount, voiceMatch, truncated, userEdited).
- **`MISSING_PREREQUISITES` before any token spend** when the gate hasn't passed/been overridden.

## Headline files
`lib/validation/titles.ts`, `lib/prompts/titles.ts`, `lib/services/{titles,titles-llm,titles-mutations}.ts`, `lib/db/titles.ts`, `app/api/pipeline/titles/{route,regenerate,lock,unlock}`, `app/api/runs/[runId]/continue/route.ts`, `Stage5Card.tsx` + `stage5/*`.

## How to verify
```bash
pnpm typecheck && pnpm lint && pnpm test
```
All 10 task.md boxes pass (3 trigger events, model literal, prompt cache, char-limit, Jaccard retry, prereq gate, voice fallback, lock overwrite, single-trigger preservation, fan-out gating).

## Issues / deviations
- **Fixed a latent Phase 2.2 test break:** the orchestrator now transitively loads the Anthropic client, so the Vitest suite needs env vars — added `test.env` dummy keys to `vitest.config.ts`. (Caught because I ran `pnpm test`, not just typecheck/lint, this phase.)
- Paused runs sit at `status="running"` (no `awaiting_input` enum value); dedicated endpoints bypass the rerun guard.
