# Phase 1.4 — Magic-Link Auth

**Status:** Complete (code) · Manual Supabase dashboard steps pending
**Date:** 2026-05-13
**Branch:** `main`
**Detail:** See `Phases/Phase 1 — Foundation/Phase 1.4 — Magic-link auth/summary.md` for the full per-file breakdown and verification log.

---

## What was built

End-to-end passwordless sign-in built on Supabase Auth + the `@supabase/ssr` cookie/session pattern. Every user-scoped route from Phase 1.5 onward will sit behind this middleware.

- **Root `middleware.ts`** — wraps every request in `createSupabaseMiddlewareClient`, calls `supabase.auth.getUser()` (which refreshes the access token cookie whenever it's stale), and gates the seven protected prefixes (`/onboard`, `/runs`, `/api/onboard`, `/api/channels`, `/api/profile`, `/api/competitors`, `/api/pipeline`). Unauthenticated requests get a 307 to `/sign-in?next=<encoded path>` with any refreshed `Set-Cookie` headers carried through.
- **`app/api/auth/sign-in`** (POST) — Origin-based CSRF check against `env.SITE_URL`, Zod-validated email (trim + lowercase + RFC + max 254), DB-backed sliding rate limit (5 sends per email per hour, returns 429 with a numeric `Retry-After`), and `signInWithOtp` with `emailRedirectTo` built from `SITE_URL + /api/auth/callback`. Always returns 204 on success and writes one of `sent | rate_limited | invalid_email | send_failed` to `login_attempts`.
- **`app/api/auth/callback`** (GET) — accepts either a `code` (PKCE) or a `token_hash + type` pair, exchanges for a session through the SSR server client (so the cookie is set), and maps Supabase's error string to an `expired | used | invalid` reason for the error page. On success, strips the query string and 303-redirects through `resolvePostAuthDestination`.
- **Sign-in surface** under `app/(public)/sign-in/` — main form, "Check your inbox" with a live 30-second resend cooldown, and a three-branch error page (expired / used / invalid). Copy literally says "15 minutes" everywhere (spec Appendix B overrides the mockup's stale "60 minutes").
- **Authed shell** under `app/(app)/` — header + `UserMenu` dropdown (Phase-1-trimmed: "Signed in as <email>" + session pill + Sign out). Sign-out is a Server Action that calls `supabase.auth.signOut()` and redirects to `/sign-in`. The `(app)` route group has no pages yet — Phase 1.5/1.6 will populate it.
- **Branded email templates** at `supabase/templates/magic-link.{html,txt}` — dark-themed HTML with the YouTube-red gradient CTA, plain-text fallback, footer copy that explicitly says no account is created until the link is clicked.
- **Service + validation layers** — `lib/services/auth.ts` owns `resolvePostAuthDestination` (reads `profiles.channel_count_cache` to route to `/onboard` or `/runs`), `checkSendRateLimit` (sliding-window math against `login_attempts`), and `mapCallbackError` (Supabase string → reason enum). `lib/validation/auth.ts` holds the Zod schemas, including the `/^\/[a-zA-Z0-9/_-]*$/` open-redirect guard reused by middleware, sign-in route, and `resolvePostAuthDestination`.
- **Tailwind utilities** — added the mockup-specific classes the project didn't yet have to `app/globals.css`: `.btn-primary`, `.input`, `.input-error`, `.card-row`, `.pill`, and `@keyframes spin` / `.spin`. Existing tokens (`yt-*`, `ink-*`, `--shadow-glow-yt`, `.card`, `.glow-bg`) were reused unchanged.

### Tests

No new unit tests in this phase. Verification is behavioural: `npm run typecheck`, `npm run lint`, and `npm run build` are clean; the `task.md` checklist's 16 items are covered by a mix of static checks (CSRF, regex, error-reason map), middleware-route assertions verified by the build output, and manual dashboard-gated steps (real email delivery, click-once-then-expire, refresh-token cycle) that can only run after Resend SMTP is wired in the Supabase dashboard. The deferred Vitest specs (rate-limit math, open-redirect regex) are a known follow-up if a regression appears.

---

## Key implementation decisions

| Decision | Why |
|---|---|
| **15-minute magic-link TTL, not 60** | Spec Appendix B explicitly overrides the PRD/mockup. Tighter security; creators typically check email immediately. Every copy site (form footer, sent-screen walkthrough step 2, expired-error body, email template HTML and plain-text) reads "15 minutes". Mockup HTML left untouched as an aspirational reference. |
| **Server Action for sign-out, no `/api/auth/sign-out` route** | Task.md listed both but said "can be implemented as a Server Action." A route handler would duplicate the same two-line `signOut()` + `redirect()` call. The Server Action lives at `app/(app)/_components/signOutAction.ts` and is invoked via `<form action={signOutAction}>` from the UserMenu — no client JS needed. |
| **Mockup CSS extracted into `app/globals.css`** | `.btn-primary`, `.input`, `.input-error`, `.card-row`, `.pill`, and the `spin` animation live in the global stylesheet, matching the pattern Phase 1.1 already established for `.card`, `.glow-bg`, `.grid-bg`, `.pulse-dot`. Tailwind utility chains would have duplicated 60+ characters per usage and would have drifted. |
| **`(app)` layout exists with no pages yet** | The UserMenu has to live somewhere, and the layout is the smallest container that exists today. Phase 1.5 will add `/onboard`, Phase 1.6 will add `/runs` + `/runs/[runId]` under the same group. The layout's defense-in-depth `getUser()` redirect is duplicative with middleware on purpose. |
| **Phase 1 UserMenu trim** | Mockup state 11 shows "Account settings" + "Help & docs" rows; spec §7.5 and task.md explicitly trim them. We render only the "Signed in as" row and the Sign out button. Adding stubs would have been dead UI. |
| **Resend wired via Supabase Custom SMTP, no `resend` npm dep** | Spec §5.1: the sign-in route calls Supabase's `signInWithOtp`, which dispatches via whichever SMTP the dashboard is pointed at. Adding the npm package would have been redundant. `RESEND_API_KEY` stays in `lib/env.ts` so the dashboard config stays observable. |
| **Cookie carry-over on the middleware redirect** | When `getUser()` rotates the access token cookie, the SSR client writes the new value into the *response* object that `createSupabaseMiddlewareClient` returns. If we redirect to `/sign-in` and return a fresh `NextResponse.redirect(...)`, those cookies are lost — the user logs in via magic link and then the very next request can't read the session. Fix: copy `response.cookies.getAll()` onto the redirect response. |
| **`SAFE_NEXT_PATTERN` exported from `lib/services/auth.ts`** | The same `/^\/[a-zA-Z0-9/_-]*$/` regex is used by middleware (to validate the redirect target it's about to embed in `?next=...`), by the sign-in route (to forward `next` into `emailRedirectTo`), and by `resolvePostAuthDestination` (to honour or discard the hint). One source of truth so the rule can't drift in one place. |
| **Audit logging on every callback outcome, not just `sent`** | The `login_attempts` table from Phase 1.2 has eight outcomes (`sent`, `rate_limited`, `invalid_email`, `send_failed`, `callback_success`, `callback_expired`, `callback_already_used`, `callback_invalid`). The route writes the matching row regardless — Phase 2's 90-day retention cron and any future per-user audit surface already have the data they need. |

---

## Files created or modified

**Middleware** (repo root)
```
middleware.ts            SSR cookie refresh + protected-prefix gate + safe-next-encoded redirects
```

**Validation + services** (`lib/`)
```
validation/auth.ts       SignInInputSchema, CallbackQuerySchema, CallbackReasonSchema
services/auth.ts         resolvePostAuthDestination, checkSendRateLimit, mapCallbackError, callbackReasonToOutcome, SAFE_NEXT_PATTERN
```

**API routes** (`app/api/auth/`)
```
sign-in/route.ts         POST — CSRF, Zod, rate-limit, signInWithOtp, login_attempts
callback/route.ts        GET — code/token_hash exchange, error reason mapping, post-auth redirect
```

**Public sign-in surface** (`app/(public)/`)
```
layout.tsx                              .glow-bg container for unauthed pages
sign-in/page.tsx                        Server entry; redirects when authed
sign-in/SignInForm.tsx                  Client form: 400 inline, 429 banner+countdown, 5xx banner+retry
sign-in/sent/page.tsx                   Server: validates session, renders 3-step walkthrough
sign-in/sent/ResendButton.tsx           Client 30-second cooldown timer + resend POST
sign-in/error/page.tsx                  Three branches: expired / used / invalid
```

**Authed shell** (`app/(app)/`)
```
layout.tsx                              Header + UserMenu; defense-in-depth getUser() redirect
_components/UserMenu.tsx                Phase-1-trimmed dropdown with click-outside + Escape close
_components/signOutAction.ts            "use server" — signOut() + redirect("/sign-in")
```

**Email templates**
```
supabase/templates/magic-link.html      Branded dark-themed HTML
supabase/templates/magic-link.txt       Plain-text fallback
```

**Styles**
```
app/globals.css                         +.btn-primary, +.input, +.input-error, +.card-row, +.pill, +@keyframes spin / .spin
```

**Docs**
```
CLAUDE.md                                                       Seven Appendix B items (stack lock-in @supabase/ssr, EXT-1 +SITE_URL, A-1 lib/supabase/ exception, API-2 expanded error code union, SEC-2 login_attempts service-role-only note, Common Mistakes SSR cookie pitfall, Pre-Commit Checklist redirect allowlist line)
Documentation/Projects/Phase-1.4-Summary.md                     This file
Documentation/Projects/Team-Update.md                           Prepended Phase 1.4 entry
Documentation/Projects/Implementation-Plan.md                   Marked 1.4 complete
Documentation/Projects/Phases/.../Phase 1.4 .../summary.md      Per-phase deep dive
```

---

## How to verify it works

From the project root, with `.env.local` populated:

```bash
pnpm install
pnpm typecheck     # tsc --noEmit — clean
pnpm lint          # ESLint — 0 warnings, 0 errors (next lint deprecation notice is unrelated)
pnpm build         # next build — all 7 routes registered, middleware compiled
```

Build output should show:
```
Route (app)
├ ○ /
├ ƒ /api/auth/callback
├ ƒ /api/auth/sign-in
├ ƒ /sign-in
├ ƒ /sign-in/error
└ ƒ /sign-in/sent
ƒ Middleware                              102 kB
```

**Eyeball the visual states** (no Supabase config needed):

```bash
pnpm dev    # http://localhost:3000 (or `--port 3040` if 3000 is taken)
```

Visit each of these and compare against mockup #02:
- `/sign-in` — state 1
- `/sign-in/sent?email=you@example.com` — state 3 (resend countdown ticks live)
- `/sign-in/error?reason=expired` — state 8
- `/sign-in/error?reason=used` — state 9 (note the `TOKEN_ALREADY_USED` footer)
- `/sign-in/error?reason=invalid` — state 10

**Confirm middleware gating** (still no Supabase config needed):

- `GET /runs` while signed out → 307 to `/sign-in?next=%2Fruns`
- `GET /onboard` while signed out → 307 to `/sign-in?next=%2Fonboard`

**Confirm CSRF** (curl from a non-`SITE_URL` origin):

```bash
curl -i -X POST http://localhost:3000/api/auth/sign-in \
  -H "Content-Type: application/json" \
  -H "Origin: https://evil.example" \
  -d '{"email":"a@b.com"}'
# → 403 with body { "code": "INVALID_ORIGIN", "message": "Origin not allowed." }
```

**End-to-end magic-link flow** requires the manual dashboard steps below.

---

## Manual dashboard steps still required

These cannot be code-driven and must be done in the Supabase dashboard before the magic-link flow works end-to-end:

1. **Auth → URL Configuration → Redirect URLs** — add `https://staging.viralizer.app/api/auth/callback` and `https://viralizer.app/api/auth/callback` (localhost is already in the allowlist from Phase 1.2).
2. **Auth → Email Templates → Magic Link** — paste the content of `supabase/templates/magic-link.html` and `magic-link.txt`. Subject line: `Your sign-in link to Viralizer`.
3. **Auth → SMTP Settings** — enable Custom SMTP, point at Resend with the API key from `RESEND_API_KEY`. Sender: `Viralizer <no-reply@viralizer.app>` (or whichever domain is verified).
4. **Auth → Providers → Email** — re-confirm `mailer_otp_exp=900` (Phase 1.2 patched this; just verify).

Once these are in place, the manual end-to-end test is: `pnpm dev` → enter email → check inbox → click link → land on `/onboard` (or `/runs` if the user has channels) → header shows the UserMenu → click avatar → Sign out → back on `/sign-in`.

---

## Issues encountered and how they were resolved

**Cursor squats on port 3099 via loopback.** While smoke-testing the dev server, requests to `http://localhost:3099` returned "Empty reply from server" / Chrome's "This page isn't working." `lsof` showed Cursor listening on both `::1:3099` and `127.0.0.1:3099`; our Next.js process was bound to `*:3099` but lost the race for the explicit loopback addresses. Fix: pick an unused port (3040 in our session). Documented here so the next agent doesn't waste an hour debugging an empty `next dev` log.

**`SITE_URL` and the dev port have to match.** The CSRF Origin check on `POST /api/auth/sign-in` compares `request.headers.get("origin")` against `env.SITE_URL`, and `emailRedirectTo` is built from `env.SITE_URL`. Running `pnpm dev --port 3040` against an `.env.local` that says `SITE_URL=http://localhost:3000` produces a 403 on every form submit, and any magic link would redirect to the wrong port. Set `SITE_URL` to whatever port `next dev` is bound to before testing the form roundtrip.

**Strict array-index access in `checkSendRateLimit`.** With `noUncheckedIndexedAccess: true`, `recent[recent.length - 1]` is typed as `T | undefined` even though the early-return guard above guarantees `recent.length >= 5`. Added an explicit `if (!oldest) return { allowed: true }` rather than reach for a non-null assertion — keeps the surface non-`any`, satisfies the typechecker, and the dead-code path is harmless.

**`task.md` listed `/api/auth/sign-out/route.ts`; we shipped a Server Action instead.** Documented as an intentional deviation in the per-phase summary. Either path would have called the same two lines (`signOut()` + `redirect()`); a route handler would have been dead code. If a downstream phase wants a programmatic HTTP sign-out endpoint, the Server Action body lifts directly into one.

**No unit tests for the new validation + service files.** Task verification is entirely behavioural/E2E and S-1 says don't add scope. The rate-limit math and the open-redirect regex are small surfaces; manual verification is sufficient. Adding `vitest` specs for them is a clean follow-up if a regression appears.
