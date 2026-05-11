# Phase 1.4 — Magic-link auth

**Parent:** Phase 1 — Foundation
**Status:** Not Started
**Estimated:** 4-8 hours
**Depends on:** Phase 1.2 (profiles trigger + login_attempts), Phase 1.3 (wrappers)
**Spec:** `Documentation/Overviews and Summaries/02-magic-link-auth/spec.md`

## Goal

Passwordless email-only auth on Supabase Auth's `signInWithOtp` magic-link primitive (Resend SMTP, 15-min single-use PKCE tokens). Rate-limited at 5 sends/email/hour. Same flow signs up and signs in. Auth-gates every `(app)` route. Routes post-auth: 0 channels → `/onboard`, else `/runs`.

## What to Build

### Step 1 — Dashboard config + DB foundation
- Supabase Dashboard: magic-link TTL 900s, redirect-URL allowlist (localhost + staging + prod), Resend Custom SMTP, refresh-token TTL 30 days. Upload branded magic-link template (HTML + text).
- Migrations from Phase 1.2 already include `login_attempts` table + `handle_new_user` trigger; nothing new here unless missed.
- `SITE_URL` already in `lib/env.ts`.

### Step 2 — Server-side auth + middleware
- `app/api/auth/callback/route.ts` (GET): parse `code`/`token_hash`/`type` + `next` (allowlist `/^\/[a-zA-Z0-9/_-]*$/` — blocks open redirects). Exchange via `exchangeCodeForSession` or `verifyOtp`. Map Supabase error message → `reason=expired|used|invalid`. Log `callback_*` outcome. Redirect via `resolvePostAuthDestination`.
- `middleware.ts` at repo root: public paths (`/`, `/sign-in*`, `/api/auth/*`) pass through but still call middleware Supabase client (so refresh works). Protected paths (`/onboard`, `/runs`, `/api/*` except auth) require `getUser()` (server-validated). Redirect unauthenticated to `/sign-in?next=<encoded>`. Excludes `_next/*`, favicon, image extensions.
- `lib/services/auth.ts` — `resolvePostAuthDestination(supabase, hint)`: if hint starts `/`, return it; else read `profiles.channel_count_cache` → `/onboard` (0) or `/runs` (>0).

### Step 3 — Send endpoint + rate limit + email
- `lib/services/auth.ts` `checkSendRateLimit(email)`: count `outcome='sent'` in last hour for email; ≥5 returns `{ allowed: false, retryAfterSec }`. Fail closed on DB error.
- `app/api/auth/sign-in/route.ts` (POST): CSRF Origin check → 403 if not `SITE_URL` origin. Zod-parse email (`.trim().toLowerCase().email().max(254)`). Rate-limit. Call `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo, shouldCreateUser: true } })` using anon-key SSR client. Always returns `204` (no enumeration). Errors: `400 INVALID_EMAIL`, `429 RATE_LIMITED` (with `Retry-After`), `502 EMAIL_SEND_FAILED` (no upstream leak).
- `app/api/auth/sign-out/route.ts` (POST): `supabase.auth.signOut()` → 303 redirect `/sign-in`. Or Server Action.
- `supabase/templates/magic-link.html` + `.txt`: branded dark theme, subject `Your sign-in link to Viralizer`, body says "15 minutes" (not 60). Uploaded to Supabase dashboard.

### Step 4 — UI surface
- `app/(public)/sign-in/page.tsx` + `SignInForm` (`"use client"`): centered card, email input with envelope icon, gradient submit button. POST `/api/auth/sign-in`; 204 → push `/sign-in/sent?email=<encoded>`; 429 → amber banner with countdown; 5xx → rose banner + retry.
- `app/(public)/sign-in/sent/page.tsx` + `ResendButton` (30s cooldown).
- `app/(public)/sign-in/error/page.tsx`: branches on `reason=expired|used|invalid` with distinct copy + CTAs per spec §7.4.
- `app/(app)/_components/UserMenu.tsx` (`"use client"`): avatar + email + sign-out button inside `<form action={signOutAction}>`. Click-outside + Escape close. Account-settings + Help rows trimmed for Phase 1.
- Already-signed-in guard: `/sign-in` and `/sign-in/sent` server pages redirect via `resolvePostAuthDestination` when session present. `/sign-in/error` does NOT auto-redirect.

### Step 5 — E2E + CLAUDE.md updates
- Happy path (new email): URL → sent screen → email arrives (60s) → click → lands on `/onboard` (no channels) or `/runs` (>0). Audit rows present.
- Error matrix: invalid email, rate-limited (6th send), expired link (16+min), used link (click twice), invalid link, cross-browser PKCE, CSRF, open-redirect.
- Cookie refresh test: TTL=60s → wait 90s → navigate → DevTools shows `Set-Cookie` for refreshed token.
- CLAUDE.md updates (spec Appendix B): stack lock-in `@supabase/ssr`, env vars include `SITE_URL`, A-1 supabase/ exception, API-2 error codes union, SEC-2 login_attempts entry, Common Mistakes (SSR cookie pitfall), Pre-Commit Checklist (redirect allowlist).

## Cross-feature contracts

- **`auth.users.id == public.profiles.id`** — Phase 1.5/1.6/Phase 2 all assume the trigger created the profile row.
- **Root `middleware.ts`** is the only auth gate for `(app)` and protected APIs. Downstream features don't re-implement.
- **`resolvePostAuthDestination`** extended in Phase 2 for Stripe (third branch `/billing`).
- **`lib/supabase/*` factories** from 1.2 are the only place `@supabase/ssr` is instantiated.
- **Error code union:** `INVALID_EMAIL, RATE_LIMITED, EXPIRED_LINK, INVALID_LINK, ALREADY_USED, EMAIL_SEND_FAILED, UNAUTHENTICATED, INTERNAL_ERROR` is canonical for API-2.

## Verification

- [ ] `login_attempts` table exists with all 7 columns from spec §3.2, RLS enabled with zero policies
- [ ] `on_auth_user_created` trigger fires: inserting via `auth.admin.createUser` creates matching `profiles` row
- [ ] Supabase dashboard: magic-link expiry = 900s, redirect allowlist contains all 3 callback URLs, custom SMTP configured
- [ ] `GET /runs` while signed out → 307 to `/sign-in?next=%2Fruns`
- [ ] `POST /api/auth/sign-in` cross-origin (`Origin: https://evil.example`) → 403
- [ ] `POST /api/auth/sign-in` 6th time within 1h → 429 with numeric `Retry-After`
- [ ] `POST /api/auth/sign-in` valid email returns 204 in <1s; email arrives within 60s; body contains literal "15 minutes" not "60 minutes"
- [ ] Clicking magic link → exchange → cookie set → redirect to `/onboard` or `/runs`
- [ ] Clicking same link twice → second click lands on `/sign-in/error?reason=used`
- [ ] Wait 16+ min then click → `/sign-in/error?reason=expired`
- [ ] `?next=https://evil.example/x` ignored, default destination used
- [ ] `/sign-in` while signed in redirects to post-auth destination; `/sign-in/error` does not auto-redirect
- [ ] Sign-out button + form action submits → `signOut()` → redirect `/sign-in`; back button to `/runs` re-redirects to `/sign-in`
- [ ] Access-token refresh: TTL=60s, wait 90s, navigate → succeeds with new `Set-Cookie`
- [ ] No raw Supabase / SMTP error bodies appear in HTTP response on forced failures
- [ ] CLAUDE.md updated with all 7 items from spec Appendix B

## Out of scope (deferred)

- Cross-device link clicks (Phase 2 PKCE relaxation)
- Email-change flow / account deletion / "Sign out everywhere"
- Multi-tab broadcast (BroadcastChannel) — Phase 2
- Social logins, 2FA — Phase 3
- `login_attempts` 90-day retention cron — Phase 2
- Stripe paywall third branch in `resolvePostAuthDestination` — Phase 2
- "Account settings" / "Help & docs" UserMenu rows
