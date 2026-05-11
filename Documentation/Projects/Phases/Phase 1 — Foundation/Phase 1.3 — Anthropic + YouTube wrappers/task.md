# Phase 1.3 — Anthropic + YouTube wrappers + SSE + orchestrator skeleton

**Parent:** Phase 1 — Foundation
**Status:** Not Started
**Estimated:** 6-8 hours
**Depends on:** Phase 1.1 (env), Phase 1.2 (cache + quota tables, pipeline_runs schema)
**Reference:** Build-Order.md §0.5–§0.8; CLAUDE.md CRIT-1, CRIT-2, CRIT-3, EXT-2, EXT-3, SEC-1, TS-2, A-1, A-2.

## Goal

Build the four foundational `lib/` modules every downstream stage will depend on. CRIT-1 (quota cache), CRIT-2 (model assignment), CRIT-3 (prompt caching), EXT-2 (quota cap), EXT-3 (retry), SEC-1 (URL allowlist), TS-2 (SSE) are all enforced **once at the wrapper layer**. By end of 1.3 no application-level code calls the Anthropic or YouTube SDKs directly.

## What to Build

### Step 1 — `lib/anthropic/` SDK wrapper
- `client.ts` — singleton `@anthropic-ai/sdk` client from `env.ANTHROPIC_API_KEY`.
- `models.ts` — typed model IDs: `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`. Stage-to-model mapping per CRIT-2 (Opus for competitor/score/script + audit synthesis + calendar; Haiku for everything else; Sonnet for onboarding niche/competitors).
- `cache.ts` — `buildSystem(prompt, estTokens)` wraps system blocks ≥1024 tokens with `cache_control: { type: "ephemeral" }`. Per CRIT-3.
- `retry.ts` — `withRetry(fn)` exponential backoff (1s/2s/4s) on 429+529 only, max 3 attempts. No retry on other 4xx. Per EXT-3.
- `callClaude({ stage, system, messages, maxTokens })` reads model from registry, applies cache helper, delegates to retry.

### Step 2 — `lib/youtube/` cached wrapper
- `client.ts` — googleapis Data API v3 client. Not exported outside `lib/youtube/`.
- `cached.ts` — the **only** YouTube call site in the app. Cache-first wrappers for `channels.list` (24h), `search.list` (1h), `videos.list` (6h). Cache key = stable hash of params; payload stored in `youtube_api_cache`. Misses call `quota.assertHeadroom(cost)` → real API → write cache → `quota.increment(cost)`.
- `quota.ts` — `assertHeadroom(units)` throws `QuotaExceededError` (→ `code: QUOTA_EXCEEDED`) when today's `units_used + units > 8000` (EXT-2). `incrementUsage`, `getUsageToday` helpers.
- `validate.ts` — URL allowlist regex per SEC-1: accepts `@handle`, `/channel/UC…`, `/c/<name>`, video URLs, `youtu.be` short links. Rejects all else with `InvalidChannelError`.

### Step 3 — `lib/streaming/` SSE pattern
- `sse.ts` — `createSSEStream<TProgress, TComplete>()` returns `{ response, emitProgress, emitComplete, emitError, close }`. Response has `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`.
- Event framing: `event: progress\ndata: <json>\n\n`, `event: complete\ndata: <json>\n\n`, `event: error\ndata: <json>\n\n`.
- `lib/hooks/useStageStream.ts` — `"use client"` hook using `fetch` + `ReadableStream` reader (POST endpoints, can't use `EventSource`). Auto-aborts on unmount.

### Step 4 — `lib/services/pipeline.ts` orchestrator skeleton
- Stage union: `competitor | score | titles | hook | script | lint | thumbnails | seo | ab | engagement`.
- Stage registry: per-stage `{ dependsOn: Stage[], outputColumn: keyof PipelineRunsRow }`. Maps Stage 4 gate behavior (halt on score<92).
- `runStage(runId, stage)`: loads row (RLS-scoped), verifies dependencies populated → `MissingDependencyError`, calls registered handler, atomic UPDATE on one column. Per A-2: no in-memory state across stages.
- `runFullPipeline(runId)`: topological walk, halt on gate or error.
- `registerStageHandler(stage, handler)` — Tier 2 stages register here. Stub handlers in 1.3 that throw "not yet implemented".

## Cross-feature contracts

- **Every Tier 2 stage calls `callClaude({ stage, system, messages, maxTokens })`** — no direct SDK imports. Enforces CRIT-2 + CRIT-3 once.
- **Every YouTube call goes through `lib/youtube/cached.ts`** — no other code imports `lib/youtube/client.ts`. Enforces CRIT-1 + EXT-2.
- **SSE protocol fixed:** `progress` events (free-form per stage) → exactly one `complete` event with stage output → close.
- **Orchestrator DB-only state contract:** stage handlers signature `(runId) => Promise<TOutput>`. Read from `pipeline_runs.<dependency_columns>`, return value writes to `pipeline_runs.<output_column>`. Enables per-stage re-run.
- **Error envelope:** wrappers throw typed errors (`QuotaExceededError`, `InvalidChannelError`, `MissingDependencyError`, `UpstreamError`) mapped to API-2 codes by route layer. Raw upstream messages never leak.

## Verification

- [ ] `lib/anthropic/models.ts` rejects non-enum model strings at compile time (negative TS test)
- [ ] `lib/anthropic/cache.ts` `buildSystem` adds `cache_control: { type: "ephemeral" }` at 1024 tokens, omits at 1023 (snapshot test)
- [ ] `lib/anthropic/retry.ts` retries on `{status: 429}` twice then succeeds; does NOT retry on `{status: 400}` (unit test)
- [ ] `lib/youtube/cached.ts` `channels.list` second call within 24h hits cache, increments `youtube_quota_usage` once not twice (integration test)
- [ ] `lib/youtube/cached.ts` `search.list` records exactly 100 units per fresh call
- [ ] `lib/youtube/quota.ts` `assertHeadroom(100)` throws when `units_used=7950` (seeded test)
- [ ] `lib/youtube/validate.ts` accepts `https://youtube.com/@mkbhd`, `https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ`; rejects `https://example.com/@mkbhd`, `http://youtube.com/@mkbhd`, empty string
- [ ] `lib/streaming/sse.ts` returns Response with `Content-Type: text/event-stream`; body framing matches `event: progress\ndata: ...\n\n` pattern
- [ ] `lib/hooks/useStageStream.ts` transitions state `idle → running → done` on successful stream; `running → error` on `event: error`
- [ ] `lib/services/pipeline.ts` `runStage` writes its output to exactly one column via `UPDATE ... WHERE id=$runId AND user_id=auth.uid()`
- [ ] `lib/services/pipeline.ts` `runStage` throws `MissingDependencyError` when a `dependsOn` column is null
- [ ] No file outside `lib/anthropic/` imports from `@anthropic-ai/sdk` (CI grep check); no file outside `lib/youtube/` imports from `googleapis`

## Out of scope

- Real pipeline stage handlers (Phase 2 — Specs 04–13)
- Real API routes `app/api/pipeline/<stage>` (per stage)
- Channel onboarding logic (Phase 1.5)
- Workspace UI (Phase 1.6)
- Auth middleware (Phase 1.4)
- Outlier corpus / hybrid scoring (Phase 2 / Feature #14)
- Anthropic streaming responses (added when first streaming stage builds)
- Stripe / per-user quota tiering (Phase 2)
- Image-gen client (Phase 3 / Feature #23)
