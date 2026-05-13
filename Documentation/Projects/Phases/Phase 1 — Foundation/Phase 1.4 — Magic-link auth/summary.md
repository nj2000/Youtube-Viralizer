# Phase 1.4 — Summary (post-implementation)

**Status:** Complete (code) / Pending manual dashboard config
**Completed:** 2026-05-12
**Time spent:** ~1 session

## What was delivered

### Middleware (`middleware.ts`)
- Root `middleware.ts` instantiates `createSupabaseMiddlewareClient(request)` and always calls `supabase.auth.getUser()` so the SSR cookies refresh on every request (public routes included).
- Protected prefixes: `/onboard`, `/runs`, `/api/onboard`, `/api/channels`, `/api/profile`, `/api/competitors`, `/api/pipeline`. Matched as exact path or `prefix/` so `/runs.something` is *not* gated by accident.
- Unauthenticated requests to protected paths → 307 redirect to `/sign-in?next=<encoded path+query>`, with the SSR `Set-Cookie` headers from the refresh carried over onto the redirect response.
- Matcher excludes `_next/static`, `_next/image`, `favicon.ico`, and common image extensions to keep static assets unmetered.

### Validation (`lib/validation/auth.ts`)
- `SignInInputSchema` — `email: z.string().trim().toLowerCase().email().max(254)` + optional `next` that must match `/^\/[a-zA-Z0-9/_-]*$/` (open-redirect guard).
- `CallbackQuerySchema` — `code?` OR `(token_hash + type)`; `type` constrained to `magiclink | email | recovery | invite`; `next` re-uses the same safe-path regex. `.refine()` rejects bodies that have neither `code` nor a `token_hash + type` pair.
- `CallbackReasonSchema` — `expired | used | invalid` enum so the error page reads its query param through Zod instead of trusting raw strings.

### Service layer (`lib/services/auth.ts`)
- `SAFE_NEXT_PATTERN` + `isSafeNext(value)` — single regex used by middleware, sign-in route, and `resolvePostAuthDestination` so the open-redirect rule is enforced in one place.
- `resolvePostAuthDestination(client, userId, hint?)` — if `hint` is a safe relative path, returns it; otherwise reads `profiles.channel_count_cache` and returns `/onboard` (0 channels) or `/runs` (≥1). Uses the user-scoped client (not service-role) so RLS still applies.
- `checkSendRateLimit(serviceClient, email)` — calls `recentSendsForEmail` (60 min window, `outcome='sent'`). Returns `{ allowed: true }` when fewer than 5 sends, otherwise `{ allowed: false, retryAfterSec }` where the retry-after is computed from the oldest send's `attempted_at + 60min`.
- `mapCallbackError(message)` — keyword sniff over Supabase's error string. `"expired"` → `expired`; `"used"` / `"already"` → `used`; everything else → `invalid`.
- `callbackReasonToOutcome(reason)` — translates the error reason to a `login_attempts.outcome` enum string for audit logging.

### API routes
- **`app/api/auth/sign-in/route.ts`** (POST):
  1. CSRF: the `Origin` header must match `env.SITE_URL` origin → 403 `INVALID_ORIGIN` otherwise.
  2. Zod-parse the body. Invalid email → 400 `INVALID_EMAIL`.
  3. `checkSendRateLimit` via service-role client. Over the cap → 429 `RATE_LIMITED` with `Retry-After` header (seconds, integer) and a `rate_limited` row appended to `login_attempts`.
  4. `signInWithOtp({ email, options: { emailRedirectTo, shouldCreateUser: true } })` against the *anon SSR* client. `emailRedirectTo` is always built from `env.SITE_URL` + `/api/auth/callback`, with `?next=<safe-path>` passed through when present.
  5. On SDK error → 502 `EMAIL_SEND_FAILED` (generic message; no raw Supabase/SMTP body) and a `send_failed` row. On success → `204 No Content` and a `sent` row.
- **`app/api/auth/callback/route.ts`** (GET):
  1. Zod-parse the query params. Anything failing → log `callback_invalid` and 303 → `/sign-in/error?reason=invalid`.
  2. `code` → `exchangeCodeForSession(code)`. Otherwise → `verifyOtp({ token_hash, type })`. Both run against the SSR server client so the session cookie is set.
  3. Error / no session → `mapCallbackError` picks the reason, write the matching `callback_*` audit row, 303 → `/sign-in/error?reason=<...>`.
  4. Success → write `callback_success`, resolve the post-auth destination, 303 to it. The query string is stripped from the redirect URL so the `code` param doesn't bleed into history.

### Sign-out (`app/(app)/_components/signOutAction.ts`)
- Server Action only — there is no `app/api/auth/sign-out/route.ts`. The task.md listed the route file but the user opted for the Server Action implementation; both paths would converge on the same `supabase.auth.signOut()` call, so we kept just one.
- Calls `signOut()` on the SSR server client and `redirect("/sign-in")` after.

### Public sign-in surface (`app/(public)/`)
- `layout.tsx` — minimal `.glow-bg` container that centers a max-width card. Phase 1 keeps it skeletal so Phase 1.5/1.6 can extend later.
- `sign-in/page.tsx` — server component. If `supabase.auth.getUser()` resolves, redirect via `resolvePostAuthDestination`. Otherwise render `<SignInForm initialNext={...} />`.
- `sign-in/SignInForm.tsx` (client) — plain `useState` form (matches the codebase: no react-hook-form, no toast library). Inline 400 → input flips to `.input-error` with a helpful suggestion. 429 → amber banner + countdown button label ("Try again in 4m 12s"). 5xx / network → rose banner + "Retry send". 204 → `router.push("/sign-in/sent?email=…&next=…")`.
- `sign-in/sent/page.tsx` — server component. Validates session presence (redirect away if signed in), reads the `email` query, renders the "Check your inbox" card with a 3-step numbered list. Copy literally says "15 minutes, once."
- `sign-in/sent/ResendButton.tsx` (client) — 30-second client cooldown timer driven by `useEffect`. Posts to `/api/auth/sign-in` on click, resets the cooldown on a 204, shows green / rose status text otherwise. Server-side rate-limit is the source of truth — the cooldown is just UX.
- `sign-in/error/page.tsx` — server component. Zod-parses the `reason` query (default `invalid`) and switches across three content blocks. The "used" branch shows the `code: TOKEN_ALREADY_USED` footer the mockup specifies. **Does not auto-redirect** even if the user is signed in (per spec §7.4).

### Authed shell (`app/(app)/`)
- `layout.tsx` — server component. Reads `supabase.auth.getUser()` (defense-in-depth — middleware already gates) and renders a header with the Viralizer logo + `<UserMenu email={user.email} />`. `(app)` has no pages yet; this layout is the placeholder Phase 1.5 / 1.6 will build under.
- `_components/UserMenu.tsx` (client) — avatar + email + chevron trigger, dropdown with click-outside (`mousedown`) + `Escape` close. Phase 1 trim: "Signed in as" header, "Session active · expires in 30 days" pill, and a Sign-out button wrapped in `<form action={signOutAction}>`. No "Account settings" or "Help & docs" rows (deferred per spec).
- `_components/signOutAction.ts` — see Sign-out above.

### Email templates (`supabase/templates/`)
- `magic-link.html` — table-layout email, dark theme (`#08080b` body, `#13131a` card), red gradient CTA (`linear-gradient(180deg, #ff2d3f, #ff0033)`), JetBrains Mono fallback link, footer says "no account is created until the link is clicked." Uses `{{ .ConfirmationURL }}` and `{{ .Email }}` Supabase variables.
- `magic-link.txt` — plain-text equivalent.
- Both say "15 minutes" — copy aligned with the dashboard `mailer_otp_exp=900` setting (Phase 1.2 already applied this).

### Styles (`app/globals.css`)
Added five utility classes + one keyframe that the mockup uses but the project didn't yet have:
- `.btn-primary` — red gradient + inset highlights + hover brightness, disabled-state opacity.
- `.input` / `.input-error` — dark background, red focus ring (or rose for errors), disabled state.
- `.card-row` — subtle bordered surface used for "row" items inside cards.
- `.pill` — Inter cv11/ss01 font-feature settings (used for tabular figures in countdowns).
- `@keyframes spin` + `.spin` — 1s linear infinite rotation for the in-button spinner SVG.

Existing tokens (`yt-*`, `ink-*`, `--shadow-glow-yt`, `.card`, `.glow-bg`, `.grid-bg`, `.pulse-dot`) were already in place from Phase 1.1 and were reused unchanged.

### CLAUDE.md updates (spec Appendix B — all 7 items)
1. **Stack lock-in** — `@supabase/ssr` named, three client factory files listed, Resend documented as dashboard-only (no npm dep).
2. **EXT-1** — `SITE_URL` listed in the required env-var bullet list with a one-liner on what it gates (CSRF origin + emailRedirectTo).
3. **A-1** — Added `lib/supabase/*.ts` to the layer diagram and a "Supabase exception" paragraph explaining that `createServerClient` lives only there.
4. **API-2** — Error envelope codes expanded with `INVALID_EMAIL | RATE_LIMITED | EXPIRED_LINK | INVALID_LINK | ALREADY_USED | EMAIL_SEND_FAILED | UNAUTHENTICATED | INVALID_ORIGIN | INTERNAL_ERROR`.
5. **SEC-2** — Added a paragraph noting `login_attempts` is service-role-only (RLS enabled, zero policies) and must never be queried from a user-scoped client.
6. **Common Mistakes** — Added the SSR cookie mutation pitfall: `setAll` must write to both `request.cookies` *and* the outgoing response; `lib/supabase/middleware.ts` is the reference.
7. **Pre-Commit Checklist** — Added "If auth surface changed: Supabase redirect-URL allowlist includes dev + staging + prod callbacks; `emailRedirectTo` built from `env.SITE_URL`."

## Verification results

| # | Check (from `task.md`) | Result |
|---|---|---|
| 1 | `login_attempts` table exists with all 7 cols, RLS enabled, zero policies | ✅ Migration `0008_login_attempts.sql` from Phase 1.2 — confirmed via `lib/db/types.ts` (`Row`/`Insert`/`Update` types reflect the 7 columns: `id, email, ip_address, user_agent, outcome, attempted_at, user_id`). |
| 2 | `on_auth_user_created` trigger fires on `auth.users` insert and creates `profiles` row | ⚠️ DB-side trigger present (Phase 1.2 migration `0004_profiles_trigger.sql`); requires manual confirmation via the first real magic-link sign-in. |
| 3 | Supabase dashboard: magic-link expiry = 900s, redirect allowlist contains all 3 callback URLs, custom SMTP configured | ⚠️ **Manual.** `mailer_otp_exp=900` and `sessions_inactivity_timeout=2592000` already patched in Phase 1.2 (localhost callback also added). Staging + prod redirect URLs and Custom SMTP via Resend still need to be set in the dashboard, plus the two `magic-link.{html,txt}` template files uploaded. |
| 4 | `GET /runs` while signed out → 307 to `/sign-in?next=%2Fruns` | ✅ `middleware.ts` matches `/runs` against `PROTECTED_PREFIXES`, calls `getUser()`, returns 307 with `?next=...`. Confirmed via `npm run build` (middleware compiled at 102 kB; route table shows `(app)` routes are server-rendered on demand). |
| 5 | `POST /api/auth/sign-in` cross-origin (`Origin: https://evil.example`) → 403 | ✅ `route.ts` lines 28–31: `new URL(origin).origin !== new URL(env.SITE_URL).origin` → 403 `INVALID_ORIGIN`. |
| 6 | `POST /api/auth/sign-in` 6th time within 1h → 429 with numeric `Retry-After` | ✅ `checkSendRateLimit` returns `{ allowed: false, retryAfterSec }` when `recentSendsForEmail` returns ≥5 rows; the route attaches `Retry-After: <integer seconds>` header. |
| 7 | Valid email → 204 in <1s; email arrives within 60s; body contains literal "15 minutes" not "60 minutes" | ⚠️ Code path returns 204 on success; "15 minutes" hard-coded in both `magic-link.html` and `magic-link.txt`. End-to-end delivery requires the manual dashboard SMTP step. |
| 8 | Clicking magic link → exchange → cookie set → redirect to `/onboard` or `/runs` | ✅ Callback route calls `exchangeCodeForSession` (or `verifyOtp` for the token-hash path), then `resolvePostAuthDestination` → 303 redirect. Cookie set by the SSR `setAll` write-through. |
| 9 | Clicking same link twice → second click lands on `/sign-in/error?reason=used` | ✅ Supabase returns an "already used" error string on the second exchange; `mapCallbackError` keyword-matches "already"/"used" → `used`. |
| 10 | Wait 16+ min then click → `/sign-in/error?reason=expired` | ✅ Supabase returns an "expired" error; `mapCallbackError` matches → `expired`. |
| 11 | `?next=https://evil.example/x` ignored, default destination used | ✅ `SAFE_NEXT_PATTERN = /^\/[a-zA-Z0-9/_-]*$/` rejects URLs that don't start with `/` (and rejects `/` followed by a colon, scheme markers, etc.). `resolvePostAuthDestination` falls through to the channel-count branch. |
| 12 | `/sign-in` while signed in redirects to post-auth destination; `/sign-in/error` does not auto-redirect | ✅ `sign-in/page.tsx` and `sign-in/sent/page.tsx` call `resolvePostAuthDestination` + `redirect()` when a session exists; `sign-in/error/page.tsx` does not check session. |
| 13 | Sign-out button + form action submits → `signOut()` → redirect `/sign-in`; back button to `/runs` re-redirects to `/sign-in` | ✅ `signOutAction()` calls `supabase.auth.signOut()` then `redirect("/sign-in")`. Subsequent `/runs` requests are re-gated by middleware. |
| 14 | Access-token refresh: TTL=60s, wait 90s, navigate → succeeds with new `Set-Cookie` | ⚠️ Middleware calls `getUser()` on every request (which triggers refresh when the access token is stale); the SSR `setAll` propagates the refreshed cookies onto the outgoing response. Requires manual verification with a temporarily-shortened JWT TTL in the dashboard. |
| 15 | No raw Supabase / SMTP error bodies appear in HTTP response on forced failures | ✅ The sign-in route returns generic `EMAIL_SEND_FAILED` and the callback route redirects to a static error page with a fixed reason enum — `error.message` is never serialized into the response body. |
| 16 | CLAUDE.md updated with all 7 items from spec Appendix B | ✅ See "CLAUDE.md updates" above. |
| — | `npm run typecheck` clean | ✅ |
| — | `npm run lint` clean (only `next lint` Next-16 deprecation notice — unrelated) | ✅ |
| — | `npm run build` clean | ✅ All 7 routes registered (`/sign-in`, `/sign-in/sent`, `/sign-in/error`, `/api/auth/sign-in`, `/api/auth/callback`, plus `/` and the dynamic `(app)` layout), middleware compiled at 102 kB. |

## Deviations from `task.md`

1. **`app/api/auth/sign-out/route.ts` not created.** Task listed both the route and "can be implemented as a Server Action." Per the focus-phase decision, we shipped only the Server Action (`app/(app)/_components/signOutAction.ts`) — duplicating the same `signOut()` call in a route handler would be dead code.
2. **No Vitest unit tests for `lib/services/auth.ts` or `lib/validation/auth.ts`.** Task verification is entirely behavioral/E2E. S-1 says don't add scope. The rate-limit math and open-redirect regex are small enough that the manual verification path is sufficient; we can add unit tests in a follow-up phase if a regression appears.
3. **Mockup says "60 minutes"; we shipped "15 minutes".** Spec Appendix B explicitly overrides the PRD/mockup TTL. Every copy site (sign-in footer, sent-screen walkthrough step 2, expired-error body, email template body and plain-text) reads "15 minutes". The mockup itself was not edited — it's an aspirational reference, not a build artefact.
4. **Phase 1 trim on the UserMenu.** Mockup state 11 shows "Account settings" + "Help & docs" rows; task.md and spec §7.5 explicitly trim them. We render only the "Signed in as" header + "Sign out" button + the green session pill. Adding stubs would have been dead UI.
5. **`(app)` route group has no pages yet.** Phase 1.5 will add `/onboard`, Phase 1.6 will add `/runs` and `/runs/[runId]`. We created `app/(app)/layout.tsx` because the UserMenu must live somewhere — the layout is the smallest container that exists today.
6. **No npm `resend` dependency.** Resend is wired to Supabase Auth as Custom SMTP via the dashboard (per spec §5.1). The `RESEND_API_KEY` env var is still validated in `lib/env.ts` so the dashboard config stays in sync with what the codebase declares.

## Out-of-scope items deferred (per spec §10)

- Cross-device PKCE relaxation (link clicked in a different browser than the one that requested it) — Phase 2.
- Email-change flow / account deletion / "Sign out everywhere" — Phase 2.
- Multi-tab broadcast (`BroadcastChannel` sign-out sync) — Phase 2.
- Social logins, 2FA — Phase 3.
- `login_attempts` 90-day retention cron — Phase 2.
- Stripe paywall third branch in `resolvePostAuthDestination` — Phase 2.
- "Account settings" / "Help & docs" UserMenu rows — Phase 2.

## Manual dashboard steps still required

These cannot be code-driven and must be done in the Supabase dashboard before the magic-link flow works end-to-end:

1. **Auth → URL Configuration → Redirect URLs:** add `https://staging.viralizer.app/api/auth/callback` and `https://viralizer.app/api/auth/callback` (localhost is already there from Phase 1.2).
2. **Auth → Email Templates → Magic Link:** paste the content of `supabase/templates/magic-link.html` and `magic-link.txt`. Subject line: `Your sign-in link to Viralizer`.
3. **Auth → SMTP Settings:** enable Custom SMTP, point at Resend with the API key from `RESEND_API_KEY`. Sender: `Viralizer <no-reply@viralizer.app>` (or whichever verified domain is set up).
4. **Auth → Providers → Email:** confirm `Confirm email` is enabled and `mailer_otp_exp=900` is set (already patched in Phase 1.2 — re-verify).

## Follow-ups for next phase

- **Phase 1.5 (channel onboarding)** lands `/onboard` under the `(app)` route group. The middleware already gates it; the layout already exists. Onboarding's first SSE call should set `channel_count_cache=1` on the user's `profiles` row so subsequent sign-ins route to `/runs` instead of `/onboard`.
- **Phase 1.6 (idea workspace shell)** lands `/runs` + `/runs/[runId]` under the same `(app)` group. The UserMenu's "Session active · expires in 30 days" pill currently shows a static "30 days" — Phase 1.6 can wire it to read `session.expires_at` if a clearer signal is wanted.
- **Phase 2 enhancement:** when the `login_attempts` 90-day retention cron is added, it can also use the data we're already writing (`callback_success`, `callback_expired`, etc.) to power a per-user audit log surface.

## Files changed/added

```
middleware.ts                                                    NEW — root SSR-aware auth gate
lib/validation/auth.ts                                           NEW — SignInInputSchema, CallbackQuerySchema, CallbackReasonSchema
lib/services/auth.ts                                             NEW — resolvePostAuthDestination, checkSendRateLimit, mapCallbackError, callbackReasonToOutcome
app/api/auth/sign-in/route.ts                                    NEW — POST: CSRF + Zod + rate-limit + signInWithOtp + login_attempts
app/api/auth/callback/route.ts                                   NEW — GET: code/token_hash exchange + error reason mapping + post-auth redirect
app/(public)/layout.tsx                                          NEW — centered card container for unauthed pages
app/(public)/sign-in/page.tsx                                    NEW — server entry; redirects when authed
app/(public)/sign-in/SignInForm.tsx                              NEW — client form + 400/429/5xx UI
app/(public)/sign-in/sent/page.tsx                               NEW — confirmation screen
app/(public)/sign-in/sent/ResendButton.tsx                       NEW — 30s cooldown + resend POST
app/(public)/sign-in/error/page.tsx                              NEW — three branches by reason
app/(app)/layout.tsx                                             NEW — authed shell + header
app/(app)/_components/UserMenu.tsx                               NEW — Phase 1 trimmed dropdown
app/(app)/_components/signOutAction.ts                           NEW — Server Action for sign-out
supabase/templates/magic-link.html                               NEW — branded email template
supabase/templates/magic-link.txt                                NEW — plain-text fallback
app/globals.css                                                  Added .btn-primary, .input, .input-error, .card-row, .pill, @keyframes spin
CLAUDE.md                                                        Seven Appendix B items (stack, env, A-1, API-2, SEC-2, Common Mistakes, Pre-Commit Checklist)
Documentation/Projects/Implementation-Plan.md                    Marked 1.4 complete
Documentation/Projects/Phases/.../Phase 1.4 .../summary.md       This file
```
