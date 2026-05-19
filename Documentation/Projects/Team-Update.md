# Team Update — YouTube Viralizer

Rolling changelog of what shipped, phase by phase. New entries are added at the top. For full detail on any phase, follow the link to `Phase-X.Y-Summary.md`.

---

## 2026-05-19 — Phase 1.6 shipped: idea workspace shell (closes Phase 1)

**Detail:** [`Phase-1.6-Summary.md`](./Phase-1.6-Summary.md) · [Phase folder](./Phases/Phase%201%20%E2%80%94%20Foundation/Phase%201.6%20%E2%80%94%20Idea%20workspace%20shell/)

**Headline:** A user can now drop a video idea and watch the 10-stage pipeline orchestrate live via SSE. Phase 2 stages plug in via `registerStageHandler` without touching any of this code. **Phase 1 (Foundation) is done.**

**What's new:**
- `POST /api/runs` — Origin CSRF + Zod `IdeaTextSchema` (preprocess trim + 10..500) + `NO_ACTIVE_CHANNEL` / `QUOTA_EXCEEDED` / 30-per-hour `RATE_LIMITED` gates + fire-and-forget orchestrator. Returns `{ runId }`.
- `GET /api/runs` — paginated (20/page) trigram search via `idea_text ilike %q%` against the pre-existing `pg_trgm` GIN index, with a status-histogram `counts` object so the filter chips render the full distribution regardless of which is selected.
- `GET /api/runs/[runId]/stream` — SSE proxy: emits `snapshot` within 200ms, subscribes to the Supabase Realtime broadcast channel `run:<id>`, forwards `progress` / `stage_complete` / `run_complete` / `run_gated` / `run_error` events, emits a `: keepalive\n\n` comment frame every 15s, and tears down the subscription cleanly on reader cancel.
- `DELETE /api/runs/[runId]` — soft-deletes terminal runs, atomically cancel-and-deletes in-flight runs (sets `failure_reason='cancelled_by_user'`, `status='error'`, `completed_at`, `deleted_at` in one UPDATE), publishes `run_error: RUN_DELETED` so any open `/runs/[runId]` tab redirects. Cross-user → 404, not 403.
- `POST /api/runs/[runId]/cancel` (204 no-op on terminal) and `POST /api/runs/[runId]/rerun-from?stage=<n>` (3..12) round out the API surface.
- The Phase 1.3 `lib/services/pipeline.ts` **split into four focused modules**: `pipeline-stages.ts` (registry + the `DOWNSTREAM` cascade map literally encoding the verification matrix + auto-registered stubs), `pipeline-state.ts` (the *only* file allowed to mutate `pipeline_runs` — `markStageStarted` / `Complete` / `Failed` / `GateFailed` / `RunComplete` / `RunCancelled`), `pipeline-bus.ts` (Supabase Realtime broadcast via the HTTP endpoint + WS subscribe), and the existing `pipeline.ts` reduced to a thin `runStage` / `runFullPipeline` / `runFromStage` delegator. The Phase 1.3 tests still pass unchanged.
- `lib/services/runs.ts` owns the workspace orchestration (`createRun`, `listRunsForActiveChannel`, `getRunForUser`, `softDeleteRunForUser`, `cancelRunForUser`, `rerunFromStageForUser`) and 5 typed errors that the API routes map to HTTP codes.
- UI: `/runs` list with search + 5 status chips + pagination + delete modal + 2 empty states; `/runs/new` with an active-channel summary card and idea form (live char counter, 10-500 trim-aware validation); `/runs/[runId]` live view consuming `useRun` — 12 stage cards (stages 1-2 synthetic, 3-12 mapped to JSONB columns), 5-variant `StageCard` (pending/running/complete/stale/error) plus a special `gated` style, optional `GateExplanation` and `StaleBanner` conditionals.
- 20 new Vitest specs (58 → 78 total, ~310ms): `IdeaTextSchema` trim-before-check + length bounds, `DOWNSTREAM` cascade for every verification row, `markStageComplete` patch shape (flips downstream stale only for populated columns), `markGateFailed` writes the exact literal "Score 71 / 100 — below 92 threshold", `markStageFailed` prefixes `^stage_<n>:` and strips newlines from raw error bodies.

**How to run it locally:**
```bash
pnpm install
pnpm typecheck             # tsc --noEmit
pnpm lint                  # ESLint — 0 warnings, 0 errors
pnpm test                  # Vitest — 78 specs in ~310ms
pnpm build                 # next build — 25 routes + middleware
pnpm dev                   # http://localhost:3000 — sign in, onboard, drop an idea
```

End-to-end smoke: sign in → `/onboard` → `/runs/new` → submit an idea → `/runs/[runId]` should walk through the 10 stages in ~1s under stubs and end at "Complete · 12 / 12".

**Heads up for the next contributor:**
- **The orchestrator now has four files, not one.** `lib/services/pipeline.ts` is a thin entry point; the real work lives in `pipeline-stages.ts` (registry + cascade map) and `pipeline-state.ts` (the four mutation helpers — these are the ONLY places that may write `pipeline_runs`, per spec §4.7). `pipeline-bus.ts` is replaceable (Realtime → Redis later) without touching state semantics.
- **Stage 3-12 handlers are stubs auto-registered at module load.** Phase 2 specs each replace their stage by calling `registerStageHandler("competitor", realHandler)` etc. The stubs return trivial payloads; the score stub returns `{ score: 95, passed: true }` so the lifecycle ends in `complete`, not `gated_failed`. Don't remove the stubs without coordinating across all Phase 2 work.
- **`pipeline-bus.ts` reads `process.env` directly, not the validated `env` export.** This is intentional — importing `lib/env.ts` triggers Zod validation at module load, which breaks Vitest specs that don't have `.env.local`. Production safety is unchanged (env still validates at app boot).
- **`stage_complete` bus events carry only `{ stage }`, not the full row.** The `useRun` hook re-fetches `/api/runs/[runId]` after each `stage_complete` to get fresh JSONB. ~10 extra GETs per full run, acceptable. Bumping the bus payload to include the row would blow past Realtime's per-message size budget on large `script_data`.
- **`/runs/[runId]/page.tsx` redirects cross-user requests to `/runs`, not 404.** Server Components don't return JSON cleanly; the API route `GET /api/runs/[runId]` does return JSON 404. The verification check targets the API; the page just defers to the API for HTML clients.
- **No new SQL migration in 1.6.** Phase 1.2's `0005_pipeline_runs.sql` already shipped all 31 columns + the 4 partial indexes + the 3 RLS policies; `pg_trgm` was enabled in `0001_extensions.sql`. Verification item #1 satisfied without a new migration.
- **Channel-delete → open-SSE `run_error: CHANNEL_DELETED`** isn't wired. Phase 1.5's `softDeletePipelineRunsForChannel` cascades `deleted_at` on the rows but doesn't `publish()` per-run. Small follow-up: the channel-delete service should iterate over the affected run IDs and publish a `run_error` event with code `CHANNEL_DELETED` for each one.
- **SSE proxy integration test + Playwright E2E both deferred.** The four state-mutation invariants are unit-tested; the SSE proxy's first-event-snapshot + keepalive contract has manual coverage.

**What's next:** Phase 2.1 — competitor outliers (Stage 3). Plug a real handler into `registerStageHandler("competitor", ...)` at module load. The orchestrator picks it up automatically; the stub is overridden; the workspace UI's "3 · Competitor outliers found" card starts rendering real data. After Phase 2.1 lands, the first end-to-end real lifecycle smoke test becomes possible (onboard → drop idea → watch stage 3 hit the real Anthropic Opus 4.7 + YouTube search and write the outliers payload).

---

## 2026-05-14 — Phase 1.5 shipped: channel onboarding (SSE pipeline + multi-channel UX)

**Detail:** [`Phase-1.5-Summary.md`](./Phase-1.5-Summary.md) · [Phase folder](./Phases/Phase%201%20%E2%80%94%20Foundation/Phase%201.5%20%E2%80%94%20Channel%20onboarding/)

**Headline:** The first end-to-end SSE consumer in the codebase. Pasting a YouTube channel URL now walks through six progress events and lands the user on a fully editable review screen — niche, top 8 competitors, channel summary — and persists to `channels` with a 3-channel cap, soft-delete cascade, and active-channel switcher in the header.

**What's new:**
- `POST /api/onboard` (SSE): CSRF Origin check, 3-channel limit pre-flight, `assertHeadroom(600)` quota gate *before* the stream opens (so a 429 returns as JSON, not as a closed stream), then six progress events — `validating → fetching_channel → fetching_videos → computing_median → extracting_niche → identifying_competitors` — culminating in a `complete` event with the full `ChannelDraft` payload.
- `POST /api/onboard/confirm`: persists the draft with idempotency (re-confirming the same channel UPDATEs in place, count stays at 1), preserves user-edited niches across re-confirms, merges manual competitors back over auto re-detection, and auto-sets `profiles.active_channel_id` when the first channel lands.
- `POST /api/competitors/redetect` throttled to 1/hr/channel via `channels.last_competitor_redetect_at` (returns 429 + `Retry-After`). The (niche, country) result is cached for 6 hours in `youtube_api_cache`, so the cap-hit case returns the prior result without burning quota.
- `GET /api/channels`, `DELETE /api/channels/[id]` (cascade-soft-deletes runs, returns `{deletedRunCount}`, reassigns active channel if needed; cross-user → 404 not 403), `GET /api/channels/[id]/run-count` (delete-modal pre-flight), `POST /api/profile/active-channel`.
- `/onboard` → `/onboard/processing` → `/onboard/review` → `/runs/new` flow. Processing screen is the first real consumer of `lib/streaming/sse.ts` + `lib/hooks/useStageStream.ts` — the SSE infrastructure Phase 1.3 built is now exercised live.
- `ChannelSwitcher` in the `(app)` header (sourced from a new `ChannelContextProvider`) brings the multi-channel UX online with optimistic `setActive` + rollback. Every Phase 1.6+ route gets active-channel context for free.
- Sonnet 4.6 enters the codebase via `lib/anthropic/onboarding.ts#callSonnet` — bypasses the pipeline-Stage-indexed `callClaude` since onboarding lives outside the 10-stage DAG, but reuses `buildSystem` (CRIT-3 cache_control at 1024 tokens) and `withRetry` (EXT-3 1s/2s/4s backoff) unchanged. CLAUDE.md CRIT-2 table now documents the Sonnet onboarding row + call site.
- `lib/validation/channels.ts` tightened in place: `videoId` is now `/^[\w-]{11}$/` (was `.min(1)`), `TopVideosSchema` caps at `.max(50)`, `CompetitorSchema.youtubeChannelId` enforces `/^UC[\w-]{22}$/`. Phase 1.3 tests still pass — the 11-char IDs in fixtures already satisfy the new regex.
- 22 new Vitest specs (58 total, ~320ms): tightened schemas, `computeMedianViews` edge cases, `mergeCompetitors` semantics including the 20-cap, and the validator's new `m.youtube.com` acceptance + `javascript:` / `data:` rejection.

**How to run it locally:**
```bash
pnpm install
pnpm typecheck             # tsc --noEmit
pnpm lint                  # ESLint — 0 warnings, 0 errors
pnpm test                  # Vitest — 58 specs
pnpm build                 # next build — 17 routes + middleware
pnpm dev                   # http://localhost:3000 — sign in, visit /onboard
```

**Heads up for the next contributor:**
- **First Sonnet 4.6 call lands here.** `callSonnet` is intentionally separate from `callClaude(stage)` — do NOT add `"niche"` or `"competitorIdent"` to the `Stage` enum or its dependency maps. The pipeline DAG is for the 10 production stages only.
- **`competitor.medianViews` is `null` from onboarding.** Phase 2 stage 3 (outlier detection) hydrates per-candidate medians on demand from the cached uploads playlists. Don't try to fetch them eagerly in onboarding — the verification matrix caps fresh quota at 520 units and the candidate-median pass would push it over.
- **Draft-mode re-detect throttle skipped.** Per-channel throttle (the durable case) ships; the per-user draft throttle isn't here. The 6h (niche, country) cache and the EXT-2 daily cap are the safety nets during drafting. Adding Redis or `onboard_redetect_attempts` is Phase 2 work.
- **`mergeCompetitors` lives in `lib/services/onboard-merge.ts`.** Pure, zero deps. The split exists so Vitest can import it without triggering env validation in `lib/anthropic/client.ts`. `lib/services/onboard.ts` re-exports it for production call sites — both import paths work, but use the dedicated module in tests.
- **`AddCompetitorInput` writes `MANUAL_<handle>` as `youtubeChannelId` for non-UC URLs.** Avoids burning a YouTube quota unit per keystroke. Phase 2 should resolve manual handles to UC… on save (or on first outlier search).
- **`/onboard` redirects to `/runs?toast=channel-limit` at 3 channels.** Phase 1.6 will need to render the toast when that query param is present.
- **First live integration test of the SSE cache-hit path happens here.** Phase 1.3's deferred verification item ("cached.ts channels.list second call within 24h hits cache") only needs a real onboarding run to verify. Unit-test coverage of `readThrough` is unchanged.

**What's next:** Phase 1.6 — idea workspace shell. Adds `/runs`, `/runs/new`, `/runs/[runId]` under the `(app)` group. `ChannelContextProvider` is already mounted in the layout, so workspace components can read the active channel via `useChannelContext()` without re-deriving auth state. The pipeline orchestrator skeleton from Phase 1.3 (`lib/services/pipeline.ts`) gets its first wired-up route here (likely `POST /api/pipeline/[stage]`) — closing the gap between the orchestrator and a real handler. After 1.6, the Foundation phase is done and Phase 2 (the 12 production stages) can plug in.

---

## 2026-05-13 — Phase 1.4 shipped: magic-link auth (middleware + sign-in surface + UserMenu)

**Detail:** [`Phase-1.4-Summary.md`](./Phase-1.4-Summary.md) · [Phase folder](./Phases/Phase%201%20%E2%80%94%20Foundation/Phase%201.4%20%E2%80%94%20Magic-link%20auth/)

**Headline:** The seven protected route prefixes (`/onboard`, `/runs`, `/api/onboard`, `/api/channels`, `/api/profile`, `/api/competitors`, `/api/pipeline`) now sit behind a single SSR-aware middleware. Phase 1.5 onboarding plugs in next without re-deriving auth.

**What's new:**
- `middleware.ts` at the repo root — wraps every request in `createSupabaseMiddlewareClient`, calls `getUser()` to refresh the access-token cookie when stale, and 307s unauthenticated requests on protected prefixes to `/sign-in?next=<encoded>` with any refreshed `Set-Cookie` headers carried through to the redirect.
- `POST /api/auth/sign-in` — `Origin`-based CSRF check against `env.SITE_URL`, Zod-validated email, DB-backed sliding rate limit (5 sends per email per hour, returns 429 + numeric `Retry-After`), `signInWithOtp` with `emailRedirectTo = SITE_URL + /api/auth/callback`. Always 204 on success; every outcome (`sent`, `rate_limited`, `invalid_email`, `send_failed`) writes a `login_attempts` audit row.
- `GET /api/auth/callback` — accepts either a PKCE `code` or a `token_hash + type` pair, exchanges through the SSR server client so the cookie lands, and maps the Supabase error string to an `expired | used | invalid` reason via `mapCallbackError`. Strips the query string before redirecting through `resolvePostAuthDestination` so the auth code doesn't bleed into history.
- Sign-in UI under `app/(public)/sign-in/` — the main form, a "Check your inbox" screen with a live 30-second resend cooldown, and a three-branch error page. **Every copy site says "15 minutes"**, not the mockup's stale "60 minutes" (spec Appendix B override).
- Authed shell under `app/(app)/` — header + `UserMenu` dropdown trimmed to "Signed in as <email>" + session pill + Sign out. Sign-out is a Server Action wired through `<form action={signOutAction}>`; no `/api/auth/sign-out` route handler.
- `lib/services/auth.ts` + `lib/validation/auth.ts` — `resolvePostAuthDestination` (reads `profiles.channel_count_cache` → `/onboard` or `/runs`), `checkSendRateLimit` (sliding-window math), `SAFE_NEXT_PATTERN` (single open-redirect regex reused by all three call sites), and Zod schemas with that regex baked in.
- Mockup-derived CSS landed in `app/globals.css` (`.btn-primary`, `.input`, `.input-error`, `.card-row`, `.pill`, `@keyframes spin` / `.spin`), matching the Phase 1.1 pattern of keeping utility classes global rather than inlining 60+ character Tailwind chains.
- Branded `supabase/templates/magic-link.{html,txt}` ready to paste into the Supabase dashboard.
- CLAUDE.md updated with all 7 Appendix B items: stack lock-in mentions `@supabase/ssr`, EXT-1 adds `SITE_URL`, A-1 documents the `lib/supabase/` exception, API-2 error-code union expanded, SEC-2 adds the `login_attempts` service-role-only note, Common Mistakes gets the SSR cookie-mutation pitfall, and the Pre-Commit Checklist gets a "redirect allowlist verified" line.

**How to run it locally:**
```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm build      # confirm middleware compiled + all 7 routes registered
pnpm dev        # http://localhost:3000 — visit /sign-in, /sign-in/sent?email=…, /sign-in/error?reason=expired
```

End-to-end email delivery additionally needs the manual Supabase dashboard steps (Custom SMTP via Resend, redirect-URL allowlist, magic-link template upload). See the per-phase summary for the exact dashboard paths.

**Heads up for the next contributor:**
- **`SITE_URL` must match the dev port.** The CSRF Origin check on `/api/auth/sign-in` and the `emailRedirectTo` for `signInWithOtp` both come from `env.SITE_URL`. If `pnpm dev` is on a non-`3000` port, set `SITE_URL` accordingly before testing the form roundtrip.
- **Cursor squats on port 3099 via loopback.** If a smoke test mysteriously returns "Empty reply from server" / "This page isn't working," check `lsof -nP -iTCP:<port> -sTCP:LISTEN` before debugging Next. Pick a port nothing else binds (3040 worked in our session).
- **No `app/api/auth/sign-out/route.ts`.** Sign-out is a Server Action (`app/(app)/_components/signOutAction.ts`) invoked through a form. If a future phase wants a programmatic HTTP endpoint, the Server Action body lifts directly.
- **No `resend` npm dep.** Resend is wired via Supabase Custom SMTP in the dashboard, not the SDK. `RESEND_API_KEY` stays in `lib/env.ts` so the dashboard config stays observable.
- **Phase-1 UserMenu trim.** Mockup state 11 shows "Account settings" + "Help & docs" rows; spec §7.5 trims them in Phase 1. Don't reintroduce them without a Phase 2 spec.
- **`(app)` layout has no pages yet.** Phase 1.5 (onboarding) and Phase 1.6 (workspace) populate this route group. The layout's defense-in-depth `getUser()` redirect is duplicative with middleware on purpose — keep it.
- **Three verification items are gated on the manual dashboard config:** real email delivery + arrival time, the click-once-then-expire / click-twice flows, and the 60s-TTL refresh-cookie test. The code path is wired; only the SMTP config blocks the live test.

**What's next:** Phase 1.5 — channel onboarding. `/onboard` becomes the first real `(app)` page; the first SSE route lands at `/api/onboard`, which is where the Phase 1.3 deferred verifications (live cache-hit integration test, full `useStageStream` DOM test) finally run for real. Onboarding's first successful run bumps `profiles.channel_count_cache` to ≥1, which then steers subsequent sign-ins through `resolvePostAuthDestination` to `/runs` instead of `/onboard`.

---

## 2026-05-11 — Phase 1.3 shipped: Anthropic + YouTube wrappers + SSE + orchestrator skeleton

**Detail:** [`Phase-1.3-Summary.md`](./Phase-1.3-Summary.md) · [Phase folder](./Phases/Phase%201%20%E2%80%94%20Foundation/Phase%201.3%20%E2%80%94%20Anthropic%20%2B%20YouTube%20wrappers/)

**Headline:** Every critical rule (CRIT-1/-2/-3, EXT-2/-3, SEC-1, TS-2) is now enforced once at the wrapper layer. No Tier 2 stage will ever touch the Anthropic or YouTube SDKs directly.

**What's new:**
- `lib/anthropic/` — `callClaude({ stage, system, messages, maxTokens, thinking?, effort? })` routes to the right model (Opus 4.7 for competitor/score/script, Haiku 4.5 for the seven short stages), applies `cache_control` at the 1024-token CRIT-3 threshold, retries 429/529 with 1s/2s/4s backoff (max three retries per EXT-3) via the SDK's typed exceptions, and defaults Opus calls to adaptive thinking + `effort: "high"` per the Anthropic skill's intelligence-sensitive floor.
- `lib/youtube/` — the *only* place that imports `googleapis`. `searchVideos` (1h cache, 100u), `getChannels` (24h, 1u), `getVideos` (6h, 1u). Deterministic sha256-of-sorted-params cache keys. SEC-1 URL allowlist via `new URL()` parsing. `assertHeadroom` enforces the 8000-unit EXT-2 soft cap.
- `lib/streaming/sse.ts` — `createSSEStream` returns `{response, emitProgress, emitComplete, emitError, close}` with the proxy-friendly header set; the response is ready to `return` from a route handler.
- `lib/hooks/useStageStream.ts` — client hook with a full `idle → running → done | error` state machine, AbortController cleanup, and an exported `parseSSEEvent` parser that's unit-tested without a DOM.
- `lib/services/pipeline.ts` — stage registry (dependsOn DAG + JSONB output column per stage), `registerStageHandler` for Tier 2 plug-in, `runStage(runId, stage, userId)` that loads the row through the service-role client with an explicit user_id filter, and the 92-point gate baked into the score stage.
- ESLint `no-restricted-imports` blocks `@anthropic-ai/sdk` outside `lib/anthropic/**` and `googleapis` outside `lib/youtube/**`. Tests can construct error fixtures; production code cannot.
- Vitest installed; 36 specs pass in ~250ms covering the verification matrix from `task.md`.

**How to run it locally:**
```bash
pnpm install
pnpm typecheck             # tsc --noEmit
pnpm lint                  # ESLint — checks the import fence too
pnpm test                  # vitest run — 36 specs
```

**Heads up for the next contributor:**
- **`callClaude` is non-streaming.** Streaming lands when the first streaming stage (likely stage 4 score or stage 7 script) actually needs it; the wrapper plumbs `thinking` / `effort` so streaming can be added without breaking call sites.
- **Stage 3 (`competitor`) is Opus 4.7.** CLAUDE.md CRIT-2 originally omitted stage 3 — the row was added in this phase. Stick with Opus unless a measured workload says otherwise.
- **Two verification items are deferred to Phase 1.5** when a real SSE route ships and a DOM environment is justified: the live cache-hit integration test (currently covered by code review) and the full `useStageStream` DOM test (currently covered by unit-testing `parseSSEEvent` independently).
- **Tests need a `server-only` shim.** `vitest.config.ts` aliases `^server-only$` to `tests/server-only.ts`. If you add a new server-only file with a Vitest test, you don't need to do anything extra — the alias already covers it.
- **`OverloadedError` is not exported in `@anthropic-ai/sdk@0.95.2`.** `retry.ts` falls back to `err instanceof APIError && err.status === 529` for the overload-class check; same behavior, future-proof if the class is restored.

**What's next:** Phase 1.4 — magic-link auth. Adds `app/middleware.ts` at the project root (consuming `lib/supabase/middleware.ts`), `/sign-in` + `/api/auth/callback` route handlers, Resend SMTP configuration on the dev project, and the branded magic-link email template. First real consumer of the SSE pattern lands in Phase 1.5 (channel onboarding) with `/api/onboard` — that's also when the two deferred verification items get exercised live.

---

## 2026-05-11 — Phase 1.2 shipped: Supabase project + schemas + typed data layer

**Detail:** [`Phase-1.2-Summary.md`](./Phase-1.2-Summary.md) · [Phase folder](./Phases/Phase%201%20%E2%80%94%20Foundation/Phase%201.2%20%E2%80%94%20Supabase%20%2B%20schemas/)

**Headline:** The data foundation is live. Every Phase 1.3+ feature reads and writes through `lib/supabase/` and `lib/db/`.

**What's new:**
- Dev Supabase project provisioned and linked; 8 migrations applied (profiles, channels, pipeline_runs, youtube_quota_usage, youtube_api_cache, onboard_drafts, login_attempts + a `private` schema for security-definer triggers). RLS on every table.
- `lib/supabase/{server,middleware,service}.ts` — three typed clients. The middleware factory returns `{supabase, response}` so rotated cookies propagate, and `service.ts` is pinned to `import "server-only"`.
- `lib/db/types.ts` (generated from the linked schema) + 7 thin typed CRUD wrappers in `lib/db/*.ts`. Callers inject the client, so session vs. service-role auth stays explicit.
- `lib/validation/channels.ts` — Zod schemas for the channel JSONB columns (`TopVideo`, `Competitor`, max-20 `CompetitorSet`). Stage-payload schemas land with their owning phase.
- Auth config patched on the dev project: 15-minute OTP expiry, 30-day refresh-token inactivity timeout, `/api/auth/callback` redirect allowlist. Resend SMTP + branded template stay deferred to Phase 1.4.
- `pnpm db:push` and `pnpm db:types` scripts added so re-running migrations and regenerating types is one command each.

**How to run it locally:**
```bash
pnpm install
supabase link --project-ref cbfdafhugrthyeaquyta   # one-time; switches to IPv4 pooler
pnpm db:push                                       # apply any new migrations
pnpm db:types                                      # regenerate lib/db/types.ts
pnpm typecheck                                     # confirm everything still compiles
```

**Heads up for the next contributor:**
- **IPv6 gotcha on this network:** the first `supabase db push` fails with `IPv6 is not supported on your current network: dial tcp [2a05:…]:5432`. Re-run `supabase link --project-ref cbfdafhugrthyeaquyta` (no other args) to switch the CLI to the IPv4 session pooler. Documented in CLAUDE.md under External Services.
- **`onboard_drafts.draft_id` has no DB default.** The wrapper generates it via `crypto.randomUUID()`. If another writer appears, generate the UUID there too rather than expecting a default.
- **`supabase gen types --linked` prints a banner to stdout.** The `db:types` script pipes stderr to `/dev/null` to keep `lib/db/types.ts` clean — don't drop the redirect.
- **Resend SMTP + branded email template** are still unconfigured. Magic-link emails in dev use Supabase's default sender; Phase 1.4 owns the swap.
- **`handle_new_user` trigger has not been exercised against a real `auth.users` insert yet.** The first real magic-link sign-in in Phase 1.4 is the integration test for both it and `sync_channel_count`.
- **Staging and production projects deferred.** Same migrations and the same `curl PATCH` against the Management API will spin them up cleanly before launch.

**What's next:** Phase 1.3 — Anthropic + YouTube wrappers (`lib/anthropic/` with model routing + `cache_control` helpers + EXT-3 retry, `lib/youtube/cached.ts` enforcing CRIT-1 via the `youtube_quota_usage` + `youtube_api_cache` wrappers from this phase, and the `lib/services/pipeline.ts` orchestrator skeleton).

---

## 2026-05-11 — Phase 1.1 shipped: project scaffold + env validation

**Detail:** [`Phase-1.1-Summary.md`](./Phase-1.1-Summary.md) · [Phase folder](./Phases/Phase%201%20%E2%80%94%20Foundation/Phase%201.1%20%E2%80%94%20Project%20scaffold%20%2B%20env/)

**Headline:** The technical foundation is in place. Every subsequent phase plugs into this scaffold.

**What's new:**
- Next.js 15 App Router app with TypeScript strict mode and the `@/*` path alias.
- Tailwind v4 design tokens from mockup #01 baked into `app/globals.css` (`yt`, `ink`, `curiosity`, `fear`, `result` palettes plus shadows and the `.card`/`.glow-bg`/`.grid-bg`/`.pulse-dot` utilities). This is the locked visual contract every UI feature will inherit.
- `lib/env.ts` — Zod-validated env vars for all 7 required keys (`ANTHROPIC_API_KEY`, `YOUTUBE_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `SITE_URL`). The app refuses to start on bad config.
- `ATTRIBUTIONS.md` and an in-app footer link satisfy CRIT-4 (MIT attribution for `AgriciDaniel/claude-youtube`) before any prompt code is written.
- ESLint 9 flat config, Prettier, `.gitignore`, `.env.example`, and the `pnpm dev`/`build`/`lint`/`typecheck`/`format` scripts.
- Reference repo cloned to `~/development/_reference/claude-youtube/` so Phase 2 can lift sub-skill prompt patterns under MIT.
- Reusable conversation-flow prompt templates under `prompts/` (start → focus → execute → document).

**How to run it locally:**
```bash
pnpm install
cp .env.example .env.local   # fill in the 7 keys
pnpm dev                     # http://localhost:3000
```

**Heads up for the next contributor:**
- The trigger tokens (`curiosity`, `fear`, `result`) are single-step (`-500` only), matching mockup #01. If a stage needs more shades, extend `@theme` in `app/globals.css` — don't fork the trigger naming.
- `next lint` is deprecated in Next 16. We're on 15.5.x so it still works, but plan a migration before the upgrade.
- The reference repo's `sub-skills/` directory is actually at `skills/claude-youtube/sub-skills/`. A top-level symlink makes the documented path work; future per-prompt `// Adapted from sub-skills/<name>.md` comments resolve through it.

**What's next:** Phase 1.2 — Supabase project + schemas (channels, profiles, pipeline_runs, youtube_quota_usage, youtube_api_cache, onboard_drafts, login_attempts) with RLS on every user-scoped table.
