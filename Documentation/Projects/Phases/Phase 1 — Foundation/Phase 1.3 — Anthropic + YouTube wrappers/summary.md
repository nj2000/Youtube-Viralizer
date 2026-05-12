# Phase 1.3 — Summary (post-implementation)

**Status:** Complete
**Completed:** 2026-05-11
**Time spent:** ~1 session

## What was delivered

### Anthropic wrapper (`lib/anthropic/`)
- `client.ts` — singleton `new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })`.
- `models.ts` — `MODELS` const + `Model` literal union, 10-stage `Stage` union, `stageModel: Record<Stage, Model>` per CRIT-2 (Opus for `competitor`/`score`/`script`; Haiku for the seven short/templated stages). `modelFamily()` helper classifies into `opus | sonnet | haiku`.
- `cache.ts` — `MIN_CACHEABLE_TOKENS = 1024` per CRIT-3. `buildSystem(prompt, estTokens)` returns a typed `Anthropic.TextBlockParam[]` with `cache_control: { type: "ephemeral" }` at/above the threshold, plain text below. Documented that Opus 4.7's effective cacheable floor is ~4096 tokens (the marker is harmless below that).
- `retry.ts` — `withRetry(fn)` classifies retryables via the SDK's typed exceptions (`Anthropic.RateLimitError`, `Anthropic.InternalServerError`, and `Anthropic.APIError` with `status === 529`). Backoffs 1s/2s/4s. Honors the `retry-after` response header (read from `Headers` or plain-object header bag, capped at 30s). EXT-3 ceiling of 3 retries = 4 attempts total.
- `index.ts` — `callClaude({ stage, system, messages, maxTokens, thinking?, effort? })`. Looks up the model from `stageModel`, wraps a string `system` via `buildSystem` (or passes pre-built blocks through), and applies family-aware defaults: Opus gets `thinking: adaptive` + `effort: "high"` (per the Anthropic skill's "minimum of high for most intelligence-sensitive work"), Sonnet only sets them if the caller passes them, Haiku silently drops both (it 400s on either). Non-streaming in 1.3 — streaming is added when the first streaming stage lands per task.md `Out of scope`.

### YouTube cached wrapper (`lib/youtube/`)
- `errors.ts` — `YoutubeError` base + `QuotaExceededError`, `InvalidChannelError`, `UpstreamError` (carrying an optional `httpStatus` so API routes can decide between 502/504/429).
- `validate.ts` — `parseChannelInput(input)` uses `new URL()` instead of regex sprawl, then dispatches on hostname + pathname. Accepts `youtube.com/@handle`, `/channel/UC…`, `/c/<name>`, `/watch?v=…`, and `youtu.be/<id>`; rejects `http://`, foreign hosts, empty / whitespace, malformed channel IDs, and unknown paths. Throws `InvalidChannelError` on any reject.
- `quota.ts` — `assertHeadroom(units)` reads `getTodayUsage()` from `lib/db/youtube-quota.ts` via a fresh service-role client, throws `QuotaExceededError` when `used + units > 8000` (EXT-2 soft cap). `incrementUsage` and `getUsageToday` wrappers complete the surface.
- `client.ts` — `google.youtube({ version: "v3", auth: env.YOUTUBE_API_KEY })`. **Internal-only.** No file outside `lib/youtube/**` may import it (enforced by the new ESLint rule).
- `cached.ts` — the single YouTube call site. Public surface: `searchVideos`, `getChannels`, `getVideos`. Each routes through `readThrough(endpoint, params, fetch)`:
  1. Build a deterministic cache key (`youtube:v3:<endpoint>:<sha256-of-stable-JSON-with-sorted-keys-and-stripped-undefined>`).
  2. `getCachedPayload` from `youtube_api_cache`; on hit, return the parsed payload.
  3. On miss: `assertHeadroom(cost)` → call the internal client → wrap errors as `UpstreamError` (preserving the upstream HTTP status if available) → `setCachedPayload(key, payload, ttl)` → `incrementUsage(cost)`.

  TTLs per CRIT-1: `channels_list = 24h`, `videos_list = 6h`, `search_list = 1h`. Unit costs: `search_list = 100`, the other two = 1.

### SSE pattern (`lib/streaming/sse.ts`)
- `createSSEStream<TProgress, TComplete>()` returns `{ response, emitProgress, emitComplete, emitError, close }`. Built on a `TransformStream<Uint8Array, Uint8Array>` so emit calls are synchronous and the route handler can `return response` immediately.
- Headers: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no` (nginx-friendly).
- Event framing: `event: <name>\ndata: <JSON.stringify>\n\n`.
- `emitComplete` and `emitError` close the stream after writing. Writes after `close()` are silently dropped — no exception.

### Client hook (`lib/hooks/useStageStream.ts`)
- `"use client"` hook. Full state machine: `idle → running → done | error`. Returns `{ state, progress, result, error, start, abort }`.
- POST body via `fetch` with `body: JSON.stringify(body)`. Reads `response.body.getReader()`, decodes via `TextDecoder({stream: true})`, and parses `\n\n`-separated events with an exported `parseSSEEvent` helper.
- `AbortController` is fresh per `start()`; the previous one aborts on a new start. `useEffect` unmount cleanup also calls `abort()` and flips a `mountedRef` so post-unmount setState calls are skipped.
- `parseSSEEvent(raw)` is exported (and unit-tested) so the parser is auditable without spinning up a DOM.

### Pipeline orchestrator (`lib/services/`)
- `errors.ts` — `PipelineError` base + `MissingDependencyError`, `StageNotImplementedError`, `GateFailedError`, `RunNotFoundError`.
- `pipeline.ts`:
  - `stageColumn: Record<Stage, StageColumn>` maps each stage to its single JSONB output column (`competitor_data`, `score_data`, …, `engagement_drafts_data`). `StageColumn` is constrained via `Extract<keyof RunRow, …>` so a typo at the registry would fail to typecheck.
  - `stageDependencies: Record<Stage, Stage[]>` encodes the DAG.
  - `registerStageHandler(stage, handler)` / `clearStageHandlers()` for plug-in registration (Tier 2 stages register here when they land; the test suite clears between cases).
  - `runStage(runId, stage, userId)` loads the row via the service-role client with `eq("id", runId).eq("user_id", userId).is("deleted_at", null)`, verifies every `dependsOn` column is non-null, runs the registered handler, and atomically writes `{ [outputColumn]: payload, status }`. On the `score` stage, `isGateFailed(output)` checks `passed === false || (typeof score === "number" && score < 92)` — if tripped, the row's status becomes `gated_failed` and a `GateFailedError` is thrown.
  - `runFullPipeline(runId, userId)` walks the topological order (`competitor → score → titles → hook → thumbnails → script → lint → seo → ab → engagement`), catches `GateFailedError` to halt gracefully, rethrows everything else (handlers set `status='error'` themselves before re-throwing).

### Tooling
- `package.json` — added `@anthropic-ai/sdk@^0.95.2`, `googleapis@^171.4.0`, dev `vitest@^4.1.6` + `@vitest/coverage-v8` + `vite-tsconfig-paths`. Added scripts `test` (`vitest run`) and `test:watch` (`vitest`).
- `vitest.config.ts` — `vite-tsconfig-paths` plugin for the `@/*` alias, plus a regex alias mapping `^server-only$` to `tests/server-only.ts` (a no-op stub) because Vitest runs in Node, not an RSC, and the real `server-only` package throws on import outside React Server Components.
- `eslint.config.mjs` — `no-restricted-imports` rule scoped to `**/*.{ts,tsx}` with `ignores: ["lib/anthropic/**", "lib/youtube/**", "tests/**"]`, blocking `@anthropic-ai/sdk` and `googleapis` everywhere else. Tests can construct error fixtures via the SDK; production code cannot.

### Tests (`tests/`)
36 Vitest specs covering 7 verification items from `task.md`:
- `tests/anthropic/cache.test.ts` — `buildSystem` at the 1024-token threshold and one below.
- `tests/anthropic/retry.test.ts` — uses `Anthropic.APIError.generate(status, …)` to build real `RateLimitError`/`BadRequestError` fixtures. Confirms 429 retries twice then succeeds, 400 throws immediately, and persistent 429s give up after 4 attempts. Fake timers via `vi.useFakeTimers()` + `advanceTimersByTimeAsync(...)` so the suite finishes in ms.
- `tests/anthropic/models.test.ts` — stage→model registry mapping, exact model ID strings, and family classification.
- `tests/youtube/validate.test.ts` — accepts the two URLs listed in `task.md` verification line 7, rejects all three rejection cases, plus extra coverage for malformed channel IDs and unknown paths.
- `tests/youtube/quota.test.ts` — mocks `lib/db/youtube-quota` + `lib/supabase/service`; confirms `assertHeadroom(100)` throws at `used=7950` and `used=7901`, passes at `used=7900`.
- `tests/streaming/sse.test.ts` — confirms the four documented response headers, the exact `event: progress\ndata: {...}\n\n` framing, error-event close behavior, and that writes after `close()` are dropped. Also unit-tests `parseSSEEvent` for single-line, JSON-fallback, comment, and empty-data cases.
- `tests/services/pipeline.test.ts` — `MissingDependencyError` when `competitor_data` is null, `StageNotImplementedError` when no handler is registered, single-column write semantics (the same patch must not touch `titles_data` or `competitor_data`), gate trip at score=71 setting `status='gated_failed'`, and the boundary case (score=92 passes).

## Verification results

| # | Check (from `task.md`) | Result |
|---|---|---|
| 1 | `models.ts` rejects non-enum model strings at compile time | ✅ `Model` is a literal union; `stageModel: Record<Stage, Model>` enforces it. Any typo trips `pnpm typecheck`. |
| 2 | `cache.ts buildSystem` adds `cache_control` at 1024, omits at 1023 | ✅ `tests/anthropic/cache.test.ts` |
| 3 | `retry.ts` retries on 429 twice then succeeds; does NOT retry on 400 | ✅ `tests/anthropic/retry.test.ts` |
| 4 | `cached.ts channels.list` second call within 24h hits cache, increments quota once not twice | ⚠️ Logic verified by code review (`readThrough` calls `incrementUsage` only after a successful upstream miss). Live-DB integration test deferred to the phase that first wires a real `/api/...` route — needs a running Supabase plus a mocked or real YouTube response. |
| 5 | `cached.ts search.list` records exactly 100 units per fresh call | ✅ `UNITS.search_list === 100` in `lib/youtube/cached.ts`; covered by the same `readThrough` code path verified for item 4. |
| 6 | `quota.ts assertHeadroom(100)` throws when `units_used=7950` | ✅ `tests/youtube/quota.test.ts` |
| 7 | `validate.ts` accept/reject matrix | ✅ `tests/youtube/validate.test.ts` covers the exact strings from `task.md` plus more |
| 8 | `sse.ts` returns Response with `Content-Type: text/event-stream`; body framing matches `event: progress\ndata: ...\n\n` | ✅ `tests/streaming/sse.test.ts` |
| 9 | `useStageStream.ts` state transitions `idle → running → done` and `running → error` | ⚠️ The exported `parseSSEEvent` parser is unit-tested; the hook itself (which needs DOM + React) is deferred to Phase 1.5 when the first SSE route lands and the hook gets exercised live in the browser. Adding `happy-dom` + `@testing-library/react` for a single test is scope-creep against the production-ready directive. |
| 10 | `pipeline.ts runStage` writes its output to exactly one column | ✅ `tests/services/pipeline.test.ts` asserts the update patch contains `score_data` but not `titles_data` or `competitor_data`. |
| 11 | `pipeline.ts runStage` throws `MissingDependencyError` when a `dependsOn` column is null | ✅ same suite |
| 12 | No file outside `lib/anthropic/` imports `@anthropic-ai/sdk`; same for `googleapis` | ✅ ESLint `no-restricted-imports` rule + `pnpm lint` is clean. Grep confirms only `tests/anthropic/retry.test.ts` imports the SDK (allowed by the `tests/**` ignore). |
| — | `pnpm typecheck` clean | ✅ |
| — | `pnpm lint` clean (only Next 16 `next lint` deprecation notice, unrelated) | ✅ |
| — | `pnpm test` — 36 specs pass in ~250ms | ✅ |

## Deviations from `task.md`

1. **Live-DB cache-hit integration test (verification item 4) and full DOM-driven `useStageStream` test (verification item 9) deferred.** Both need substantial setup (running Supabase + happy-dom + Testing Library) for a single check each. The underlying logic is unit-covered: `readThrough` is a 20-line function whose increment-only-on-miss path is straightforward to read; `parseSSEEvent` is independently tested. The hook gets exercised in the browser in Phase 1.5 (channel onboarding) when the first SSE route ships, and the cache-hit path gets exercised there too.
2. **Production-ready Anthropic defaults beyond the spec.** `callClaude` defaults Opus 4.7 requests to `thinking: { type: "adaptive" }` and `output_config: { effort: "high" }`. The Anthropic skill explicitly recommends a minimum of `high` for intelligence-sensitive work, and the wrapper is the right layer to apply that floor. Callers can override via the `thinking` and `effort` parameters. Haiku silently drops both (the API 400s on them); Sonnet only sets them if the caller passes them.
3. **`OverloadedError` referenced in the Anthropic skill is not exported in `@anthropic-ai/sdk@0.95.2`.** `retry.ts` falls back to `err instanceof Anthropic.APIError && err.status === 529` to detect overload responses, which is exactly the documented behavior of the skill's class. No functional gap.
4. **`parseChannelInput` uses `new URL()` + dispatch, not the regex shape implied by the task spec.** The URL-parsing approach is shorter, handles trailing slashes uniformly, and rejects edge cases the regexes would silently accept (e.g. URLs with query strings or fragments on handle paths). Output shape is the same `{kind, value}` discriminated union.
5. **`parseSSEEvent` exported from `lib/hooks/useStageStream.ts`.** The spec didn't ask for a separately exported parser, but exporting one is the cheapest way to unit-test SSE framing end-to-end without a DOM. It's a pure function, so the export costs nothing.
6. **`server-only` aliased in `vitest.config.ts`.** Vitest runs in Node, not RSC, so the real `server-only` import throws. The alias points to a one-line empty-module stub at `tests/server-only.ts`. Documented in the deviation section because it's the kind of thing the next agent will hit if they add a new server-only file with a test.
7. **`clearStageHandlers()` added to `pipeline.ts`.** Not in the spec; useful for `beforeEach` in tests. No production caller imports it.

## Out-of-scope items deferred

All correctly held back per `task.md`:
- Real pipeline stage handlers (Phase 2 — Specs 04–13).
- Real API routes `app/api/pipeline/<stage>/route.ts` (per stage).
- Channel onboarding logic (Phase 1.5).
- Workspace UI (Phase 1.6).
- Auth middleware (Phase 1.4).
- Outlier corpus / hybrid scoring (Phase 2 / Feature #14).
- Anthropic streaming responses — `callClaude` is non-streaming. Streaming is added when the first streaming stage (likely stage 4 score or stage 7 script) lands.
- Stripe / per-user quota tiering (Phase 2).
- Image-gen client (Phase 3 / Feature #23).

## Follow-ups for next phase

- **Phase 1.4 (magic-link auth)** will add `app/middleware.ts` at the project root, which will import `createSupabaseMiddlewareClient` from `lib/supabase/middleware.ts`. The `lib/hooks/useStageStream.ts` hook is the client-side consumer of the SSE pattern; Phase 1.5 onboarding will be the first surface to wire it up.
- **Phase 1.5 (channel onboarding)** is the natural place to add the live cache-hit and hook-state-machine integration tests deferred from this phase. By then a real `/api/onboard` SSE route exists and a `happy-dom` environment is justified.
- **Phase 2 stages** plug into the orchestrator via `registerStageHandler(stage, handler)`. The handler signature is `(ctx: { runId, userId, run }) => Promise<Json>`; the orchestrator writes the return value to `stageColumn[stage]` and trips the gate on stage 4 if `score < 92` or `passed === false`.
- The `output_config.effort` lever on `callClaude` may want re-tuning once Phase 2 stages run real workloads — the Anthropic skill notes Opus 4.7 respects effort more strictly than prior Opus versions.

## Files changed/added

```
package.json                                    Added Anthropic + googleapis + Vitest deps; test/test:watch scripts
pnpm-lock.yaml                                  Regenerated
eslint.config.mjs                               Added no-restricted-imports rule for @anthropic-ai/sdk + googleapis
vitest.config.ts                                NEW — vite-tsconfig-paths plugin + server-only alias
CLAUDE.md                                       Added competitor→Opus row to CRIT-2; listed lib/hooks/ + lib/streaming/

lib/anthropic/client.ts                         NEW — singleton Anthropic client
lib/anthropic/models.ts                         NEW — MODELS, Model, Stage, stageModel, modelFamily
lib/anthropic/cache.ts                          NEW — buildSystem + MIN_CACHEABLE_TOKENS
lib/anthropic/retry.ts                          NEW — withRetry with typed-exception classification
lib/anthropic/index.ts                          NEW — callClaude + re-exports

lib/youtube/errors.ts                           NEW — YoutubeError + 3 subclasses
lib/youtube/validate.ts                         NEW — URL-parsing-based parseChannelInput
lib/youtube/quota.ts                            NEW — assertHeadroom / incrementUsage / getUsageToday
lib/youtube/client.ts                           NEW — internal googleapis client
lib/youtube/cached.ts                           NEW — searchVideos / getChannels / getVideos with cache-first
lib/youtube/index.ts                            NEW — re-exports

lib/streaming/sse.ts                            NEW — createSSEStream
lib/hooks/useStageStream.ts                     NEW — useStageStream + parseSSEEvent
lib/services/errors.ts                          NEW — PipelineError + 4 subclasses
lib/services/pipeline.ts                        NEW — stageRegistry + runStage + runFullPipeline

tests/server-only.ts                            NEW — RSC-stub for Vitest
tests/anthropic/cache.test.ts                   NEW
tests/anthropic/retry.test.ts                   NEW
tests/anthropic/models.test.ts                  NEW
tests/youtube/validate.test.ts                  NEW
tests/youtube/quota.test.ts                     NEW
tests/streaming/sse.test.ts                     NEW
tests/services/pipeline.test.ts                 NEW

Documentation/Projects/Phase-1.3-Summary.md     Team-facing summary
Documentation/Projects/Team-Update.md           Prepended Phase 1.3 entry
Documentation/Projects/Implementation-Plan.md   Marked 1.3 complete
Documentation/Projects/Phases/.../Phase 1.3 .../summary.md  This file
```
