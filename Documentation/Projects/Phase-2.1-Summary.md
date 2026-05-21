# Phase 2.1 — Competitor Outliers (Stage 3)

**Status:** Complete · **Date:** 2026-05-19 · **Branch:** `main`
**Detail:** `Phases/Phase 2 — 12-Stage Pipeline/Phase 2.1 — Competitor outliers (Stage 3)/summary.md`

## What was built
The vertical-slice proof of the Phase 2 architecture: a `runId` drives YouTube → Opus → SSE → JSONB end-to-end and renders in the run page. Given a channel's competitor set, Stage 3 finds videos that beat their *own* channel's median by ≥5× over 30 days, then has Opus 4.7 extract the "delta" (what made each outlier different) plus cross-cutting patterns.

- Per-competitor YouTube search → median → hydrate → 5× filter (recency projection for <72h videos, shorts/livestream flags) → diversity cap 5/channel → top 15 → one batched Opus call.
- Quota soft-cap fires before every per-competitor `search.list`, bounding the worst case at 808 units.
- Establishes the pattern every later stage mirrors: prompt + service + route + Stage card + handler registration.

## Key decisions
- **`search.list` (100 units), faithful to spec quota math** rather than the cheaper uploads-playlist path — chosen for correct date ordering.
- **Single batched Opus call**, not 15 per-outlier calls, so the model can reason across the set; LLM output merged into YouTube facts server-side by `videoId` (hallucinated IDs dropped).
- **Established-pattern SSE** (fire-and-forget + bus + run-wide subscriber), not a per-stage stream.

## Headline files
`lib/validation/competitor.ts`, `lib/prompts/competitor.ts`, `lib/services/{competitor,competitor-delta,competitor-fetch}.ts`, `app/api/pipeline/competitor/route.ts`, `app/(app)/runs/[runId]/Stage3Card.tsx` + `stage3/*`, extended `lib/youtube/cached.ts`.

## How to verify
```bash
pnpm typecheck && pnpm lint && pnpm test
```
All 12 task.md verification boxes pass on inspection (videoId regex, quota guard, diversity cap, recency flag, prompt cache, attribution).

## Issues / deviations
- No new migration (the `competitor_data` column pre-existed).
- CRIT-2 already listed Stage 3 as Opus from Phase 1.3 — no CLAUDE.md change needed.
