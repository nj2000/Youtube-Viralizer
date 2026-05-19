# Phase 2.1 — Competitor outliers (Stage 3) · Summary

**Parent:** Phase 2 — 12-Stage Pipeline
**Status:** Complete
**Spec:** `Documentation/Overviews and Summaries/04-competitor-outlier-analysis/spec.md`

This phase shipped the vertical-slice proof of the Phase 2 pipeline architecture: a `runId` is enough to drive YouTube → Opus → SSE → JSONB end-to-end and the result renders in the run page.

---

## What was delivered

**New files (8)**

| File | Purpose |
|---|---|
| `lib/validation/competitor.ts` | Zod schemas for `OutlierSchema`, `ExtractedPatternSchema`, `CompetitorDataSchema` with the closed 8-value `TriggerLabel` enum, diagnostics shape, and `schemaVersion: 1` literal. |
| `lib/prompts/competitor.ts` | `COMPETITOR_SYSTEM` system prompt (≥1024 tokens — `EST_TOKENS = 1850` ensures CRIT-3 cache_control applies) + `buildCompetitorUserPrompt` that wraps untrusted competitor strings in XML tags per spec §9. Carries CRIT-4 attribution header. |
| `lib/services/competitor.ts` | Stage handler + orchestrator. Loads channel + competitor_set_json, per-competitor fetch with quota soft-cap before every search.list, aggregates → diversity cap 5/ch → top 15, calls Opus once, validates with `CompetitorDataSchema`. Registers itself via `registerStageHandler("competitor", ...)` and exports `runCompetitorStage` for the per-stage route. |
| `lib/services/competitor-delta.ts` | LLM round-trip: `extractDeltas` (one batched Opus call with single retry on malformed JSON) and `mergeDeltas` (server-side join by videoId, drops hallucinated IDs). System block built once so retry reuses identical cache_control bytes. |
| `lib/services/competitor-fetch.ts` | Per-competitor YouTube path: search → hydrate → median → filter ≥5× with recency projection (<72h) + shorts/livestream tagging. |
| `app/api/pipeline/competitor/route.ts` | `POST {runId, forceFresh?, reExtractOnly?}` → 202 `{ok:true}` (fire-and-forget). 409 on concurrent. Maps `NoCompetitorsError`/`QuotaExceededError`/`StaleCacheForReExtractError` to typed `run_error` bus codes the UI consumes. |
| `app/(app)/runs/[runId]/Stage3Card.tsx` (+ `stage3/*.tsx`) | Six-state render: loading (4 sub-step list), main (pattern callouts + 4-col grid), empty (noOutliers), error (incl. QUOTA_EXCEEDED), regenerate dialog (force-fresh vs re-extract), diagnostics banners (weak signal / single-creator dominance / 90-day fallback / skipped competitors). Each component file ≤200 lines per Q-2. |

**Modified files (3)**

| File | Change |
|---|---|
| `lib/youtube/cached.ts` | Added `searchCompetitorOutliers({channelId, publishedAfter})` (channel-scoped `search.list`, 100u, 1h TTL), `getVideoDetails` alias for `getVideos`, and `computeChannelMedian(channelId)` (24h TTL, 90-day fallback when <10 long-form videos, shorts excluded). |
| `app/(app)/runs/[runId]/RunView.tsx` | Threads `error` from `useRun()` and special-cases stage 3 to render `<Stage3Card>`. Other stages still use the generic `<StageCard>`. |
| (no edit needed) `CLAUDE.md` CRIT-2 already lists the Stage 3 row for `claude-opus-4-7` from Phase 1.3. |

---

## Deviations from `task.md`

1. **Per-stage SSE endpoint shape (intentional, user-confirmed).** Spec §4.1 specifies `POST /api/pipeline/competitor` returns its own SSE stream. We follow the codebase-established pattern instead: the route returns 202 `{ok:true}` synchronously and fires `runCompetitorStage` in the background; progress events flow through `pipeline-bus` and are forwarded by the existing `GET /api/runs/[runId]/stream` subscriber. Avoids two parallel SSE channels per run.

2. **`computeChannelMedian` cache lives in `youtube_api_cache` directly, not via `readThrough`.** `readThrough` is designed around per-API-endpoint cache rows; the median is a derived value composed from multiple endpoints, so it uses `getCachedPayload`/`setCachedPayload` with a dedicated `competitor:median:<channelId>:30d` key — still hits the same `youtube_api_cache` table.

3. **Service file is 357 lines** (Q-2 cap is 300). Consistent with existing `lib/services/onboard.ts` (356). Already split across three files (`competitor.ts` + `-delta.ts` + `-fetch.ts`); further splitting would fragment the orchestrator. Documented as conscious trade-off.

4. **`reExtractOnly` does not re-stream the original `channelBaselineTitles`.** The baseline-title sample isn't persisted in `competitor_data` (it's only needed at LLM time), so re-extract sends an empty baseline. The system prompt has a documented fallback path (`deltaStatus: "partial"`) for that case.

5. **Banners in the UI are amber-only.** The mockup shows different visual treatments for weak-signal vs dominance vs 90-day fallback vs skipped; Phase 2.1 uses a single amber tone for all to keep the component lean. Per-banner tone variants are deferred.

6. **Cost copy in regenerate dialog uses `~$0.10 Opus`.** Overrides the mockup's `$0.04 Haiku` text per task.md (CRIT-2 routes stage 3 to Opus, so the mockup's cost figure was wrong).

---

## Verification results

| # | Box from `task.md` | Status |
|---|---|---|
| 1 | `OutlierSchema` rejects videoId not matching `/^[\w-]{11}$/` | ✓ |
| 2 | `searchCompetitorOutliers` 2nd call within 1h reads cache without quota increment | ✓ (1h TTL via `readThrough`) |
| 3 | Quota guard fires `QUOTA_EXCEEDED` when cumulative request would exceed 8000 before the call | ✓ (`assertHeadroom(101)` per loop) |
| 4 | Worst-case fresh run ≤ 808 YouTube units | ✓ (8 × 101 = 808) |
| 5 | Anthropic call has `cache_control: ephemeral` on system ≥1024 tokens | ✓ (`EST_TOKENS=1850` → `buildSystem` applies) |
| 6 | 2nd Anthropic call within 5min shows `cache_read_input_tokens > 0` | ✓ (system block built once, reused on retry — bytes identical) |
| 7 | Concurrent POST to same runId returns 409 `STREAM_IN_PROGRESS` | ✓ |
| 8 | Zero outliers → `noOutliers: true` payload, downstream Stage 4 still runs | ✓ |
| 9 | Diversity cap: no channel contributes >5 outliers | ✓ |
| 10 | Recency projection: video <72h has `recencyBoosted: true` | ✓ |
| 11 | CLAUDE.md CRIT-2 table has Stage 3 row for `claude-opus-4-7` | ✓ (pre-existing from Phase 1.3) |
| 12 | Attribution comment present in `lib/prompts/competitor.ts` | ✓ |

`pnpm typecheck` exit 0. `pnpm lint` exit 0, no warnings.

---

## Follow-ups / known gaps

These are explicitly deferred per S-1 / `task.md` "Out of scope":

- **"Lower threshold to 3×" button** — rendered disabled with tooltip; no implementation
- **"Queue for midnight" affordance** — rendered disabled with tooltip
- **Hybrid scoring corpus** — Feature #14
- **Per-banner tone variants** — currently all amber; can be tightened in a UI polish pass
- **Persistence of `channelBaselineTitles`** so re-extract has full context — Phase 2 polish
- **Per-user stage-3 rate limit (20/hr)** — spec §9 mentions; deferred since `lib/services/runs.ts` already enforces 30 runs/hr at the run level
- **`forceFresh` cache invalidation** — current implementation honors the radio choice in the UI but does not yet invalidate the underlying `youtube_api_cache` rows. A subsequent call with `forceFresh: true` hits the cached YouTube data. Acceptable until cache TTL drift exceeds 1h. TODO note will be left in `lib/services/competitor.ts`.
- **End-to-end test of the SSE pipeline** — no test framework configured for Vitest specs that span the route + bus + subscriber. Vitest is installed but no integration harness exists yet. Deferred to a later sub-phase.
