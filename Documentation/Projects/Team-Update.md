# Team Update — YouTube Viralizer

Rolling changelog of what shipped, phase by phase. New entries are added at the top. For full detail on any phase, follow the link to `Phase-X.Y-Summary.md`.

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
