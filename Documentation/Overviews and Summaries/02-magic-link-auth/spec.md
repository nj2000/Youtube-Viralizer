# Spec — Feature #02: Email Magic-Link Auth

> **Status:** Approved · **Phase:** 1 · **Tier:** 1 (User Foundation) · **Build Order:** §1.1
> **Source PRD:** `Documentation/PRDs/02-magic-link-auth.md`
> **Mockup:** `Documentation/Mockups/02-magic-link-auth.html`

This spec is the engineering contract. It supersedes the PRD on any conflict. Code is built from this document.

---

## 1. Overview

A passwordless, email-only auth flow built directly on **Supabase Auth's `signInWithOtp` magic-link primitive** with **Resend as the SMTP provider** (configured via the Supabase dashboard's Custom SMTP settings). The user enters an email; Supabase issues a one-time, 15-minute magic link; clicking the link hits our `/api/auth/callback` route, which exchanges the embedded code for a session cookie set by `@supabase/ssr`. Middleware on the `(app)` route group then enforces session presence on every authenticated route.

**Same flow signs up and signs in.** A row in `auth.users` is created on first send; a corresponding row in `public.profiles` is auto-created via a Postgres trigger on `auth.users` insert. Returning users hit the same `signInWithOtp` call — Supabase identifies the existing user by email and reuses the row.

**Scope of this feature:**

- `/sign-in`, `/sign-in/sent`, `/sign-in/error` pages
- `/api/auth/callback` route handler (the only server-side touchpoint of the magic-link redirect)
- `/api/auth/sign-out` action
- Middleware at `middleware.ts` enforcing session presence on `(app)` routes
- Supabase server/browser client factories using `@supabase/ssr`
- Branded Resend email template (subject + HTML + plain-text)
- Per-email send rate limit: 5 per hour
- Post-auth redirect logic: 0 channels → `/onboard`; ≥1 channel → `/runs`
- Sign-out dropdown affordance in the app header
- DB trigger creating `public.profiles` row on `auth.users` insert
- A `login_attempts` table for rate-limit accounting and audit logging

**Why it matters:** This is the gate to the entire app. Tier 1.1 in the build order. Every other user-scoped feature reads `auth.uid()` and assumes a valid session — onboarding, the pipeline, idea history, run views all break without this. Magic-link is also the lead-magnet conversion path: lower friction at the door means higher free-tier capture, which feeds Phase 2's funnel.

**Why we're not rolling our own token table:** Supabase Auth's built-in magic-link flow is already battle-tested (single-use, time-bounded, signed). Reimplementing the token mint/store/expire/redeem cycle would be 200 lines of code we don't need to write and a security surface we don't need to own. We use Supabase's primitive verbatim and only add what's missing: rate limiting, branded emails, and our app's specific post-auth routing.

---

## 2. User Stories

Phase 1 covers all PRD user stories. Each is mapped to the section that resolves it.

- As a new visitor, I want to sign up with just my email, so I can try the product without creating yet another password. → §4.1, §5.1
- As a returning user, I want to sign in by entering my email and clicking a link, so I never have to remember a password. → §5.1
- As a user, I want my session to persist across browser tabs and reasonable time windows, so I'm not re-authenticated constantly. → §5.4 (30-day cookie)
- As a user, I want a clear "sign out" affordance, so I can end my session on shared devices. → §4.4, §7.5
- As a security-conscious user, I want magic-link tokens to expire if I don't use them quickly, so a stolen email can't compromise my account. → §5.2 (15-min TTL, single-use)

**Out of scope (deferred to Phase 2 or beyond):**

- Social logins (Google / Apple / GitHub)
- Password-based auth
- Two-factor authentication
- Email change flow
- Account recovery via secondary channel
- Active-session listing / per-session revoke
- Account deletion / GDPR self-service

> **Note on PRD/spec divergence — link TTL.**
> The PRD says "60 minutes." Supabase's built-in OTP TTL is configurable but defaults to 1 hour, and the project-level setting applies globally. **This spec sets TTL to 15 minutes** because (a) lower window narrows the stolen-email attack surface, (b) creators check email immediately after submitting (no benefit to the wider window), and (c) the explicit MVP default in the kickoff message overrides the PRD. The mockup copy currently says "60 minutes" — UI copy must be updated to "15 minutes" before ship. Flagged in §10.

---

## 3. Data Model

Supabase manages `auth.users`, `auth.identities`, and the magic-link OTP machinery internally — we do not touch those tables directly. This section covers only the public-schema rows we own.

### 3.1 `profiles` table — already defined in spec #01

Cross-feature contract; do not redefine here. The relevant columns for this feature are:

```sql
-- (Reproduced for reference only — owning spec is #01 §3.2)
public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  active_channel_id   uuid references public.channels(id) on delete set null,
  channel_count_cache integer not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
)
```

This feature **adds a trigger** (defined in §3.3) that inserts a row here on every `auth.users` insert.

### 3.2 `login_attempts` table (new — owned by this feature)

Append-only audit log used for two purposes: per-email rate limiting (§5.3) and security audit (§9). One row per `signInWithOtp` invocation, regardless of outcome.

```sql
create table public.login_attempts (
  id                uuid primary key default gen_random_uuid(),
  email             citext not null,                 -- citext for case-insensitive lookups
  ip_address        inet,                            -- nullable: behind proxy this may be unavailable
  user_agent        text,                            -- truncated to 500 chars at the app layer
  outcome           text not null check (outcome in (
    'sent',                                           -- magic link successfully dispatched
    'rate_limited',                                   -- blocked before send (>5 in last hour)
    'invalid_email',                                  -- failed Zod validation; logged for audit only
    'send_failed',                                    -- Resend/Supabase returned an error
    'callback_success',                               -- code exchanged into a session
    'callback_expired',                               -- token expired
    'callback_already_used',                          -- single-use token already consumed
    'callback_invalid'                                -- malformed / forged token
  )),
  attempted_at      timestamptz not null default now(),
  -- For callback rows, optionally link back to the auth user once we know their id:
  user_id           uuid references auth.users(id) on delete set null
);

-- Critical index: rate-limit lookups happen on every send-link request.
-- (email, outcome='sent') filtered to the last hour must be fast.
create index login_attempts_email_sent_recent
  on public.login_attempts (email, attempted_at desc)
  where outcome = 'sent';

-- Audit lookups by user_id.
create index login_attempts_user_idx on public.login_attempts (user_id, attempted_at desc)
  where user_id is not null;

-- Bulk cleanup of old rows (90-day retention; Phase 2 cron).
create index login_attempts_attempted_at_idx on public.login_attempts (attempted_at);
```

**Required Postgres extension** (one-time, in the same migration):

```sql
create extension if not exists citext;
```

**Row-Level Security on `login_attempts`:**

This table is **service-role only**. Users never query it directly — the rate-limit check runs in route handlers using the service-role client. Therefore:

```sql
alter table public.login_attempts enable row level security;
-- No policies defined → RLS denies all anon/authenticated access by default.
-- Service-role connections bypass RLS, which is what we want.
```

**Retention:** rows older than 90 days are deleted by a daily cron (Phase 2 — for Phase 1 the table is small enough to grow unattended; flagged in §10).

### 3.3 Trigger: auto-create `profiles` row on `auth.users` insert

This is the **mechanism the entire app depends on** for the cross-feature contract `auth.users.id == public.profiles.id`. Without it, the first read of `profiles` after sign-up returns no row and the onboarding flow breaks with an FK violation.

```sql
-- Lives in migration: 20260510_profiles_trigger.sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer                          -- runs as owner so it can write to public.profiles regardless of caller
set search_path = public
as $$
begin
  insert into public.profiles (id, active_channel_id, channel_count_cache)
  values (new.id, null, 0)
  on conflict (id) do nothing;            -- idempotent: replaying the trigger never fails
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

Notes:

- `security definer` is required because `auth.users` triggers run as the postgres role, but `public.profiles` writes need to bypass RLS — this is the standard Supabase pattern.
- `on conflict (id) do nothing` makes the trigger idempotent. If a profile somehow exists (e.g., from a manual seed or a re-played migration), the insert is a no-op rather than an error that would block the user from signing up.
- `set search_path = public` is a security hardening: prevents a malicious schema-search-path manipulation from redirecting the insert to a different table.

### 3.4 Zod schemas (`lib/validation/auth.ts`)

```typescript
import { z } from "zod";

export const SignInInputSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email({ message: "Please enter a valid email address." })
    .max(254, { message: "Email address is too long." }), // RFC 5321 limit
});

export type SignInInput = z.infer<typeof SignInInputSchema>;

export const CallbackQuerySchema = z.object({
  // Supabase appends `code=...&...` for the PKCE flow; older OTP-style links use `token_hash` + `type`.
  // We support both because Supabase's email template defaults to the PKCE-style URL.
  code: z.string().min(1).max(512).optional(),
  token_hash: z.string().min(1).max(512).optional(),
  type: z.enum(["magiclink", "email", "recovery", "invite", "signup"]).optional(),
  next: z.string().regex(/^\/[a-zA-Z0-9/_-]*$/).optional(), // safe relative path only (SEC-3)
});

export type CallbackQuery = z.infer<typeof CallbackQuerySchema>;
```

Note the `next` parameter regex: only relative paths matching `/^\/[a-zA-Z0-9/_-]*$/` are accepted. This blocks the open-redirect attack of a forged callback URL with `?next=https://evil.example/...` (see §9).

### 3.5 Constraints

- `auth.users.email` uniqueness is enforced by Supabase. We do not need a separate uniqueness check.
- `login_attempts.email` is `citext` so `Foo@Bar.com` and `foo@bar.com` collapse to the same rate-limit bucket.
- The Zod schema lowercases and trims email before any DB write, so `login_attempts.email` rows are always normalized.

---

## 4. API Endpoints

All routes live under `app/api/auth/`. The `/sign-in*` *pages* live under `app/(public)/sign-in/` and are not API endpoints — they render UI and call server actions or `fetch` to the API routes.

Field naming follows CLAUDE.md API-1: snake_case in DB and external APIs, camelCase in TypeScript. Zod schemas perform the transform.

Error envelope per CLAUDE.md API-2:

```typescript
{ error: string, code: ErrorCode }
```

with `ErrorCode` union of:

```typescript
type ErrorCode =
  | "INVALID_EMAIL"          // Zod failed on email format
  | "RATE_LIMITED"           // >5 sends in last hour for this email
  | "EXPIRED_LINK"           // Supabase rejected the code as expired
  | "INVALID_LINK"           // malformed / forged code, or query schema failed
  | "ALREADY_USED"           // single-use token already consumed
  | "EMAIL_SEND_FAILED"      // Supabase / Resend returned a 5xx
  | "INTERNAL_ERROR";        // unexpected; logged to Sentry
```

### 4.1 `POST /api/auth/sign-in` — request a magic link

**Auth:** not required (this is the entry point).

**Request body:**

```typescript
{ email: string }
```

**Behavior:**

1. Parse body with `SignInInputSchema`. On failure: `400 { code: "INVALID_EMAIL" }`.
2. Capture `request.headers.get("x-forwarded-for")` (first IP) and `request.headers.get("user-agent")` (truncated to 500 chars).
3. Check rate limit (§5.3). On block: log `outcome='rate_limited'`, return `429 { code: "RATE_LIMITED", retryAfterSec: <number> }`.
4. Call `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: <CALLBACK_URL> } })` using the **server-role anon client** (not service role; `signInWithOtp` is a public auth method).
5. If Supabase returns an error: log `outcome='send_failed'`, return `502 { code: "EMAIL_SEND_FAILED" }`. Do **not** leak the upstream error message to the client.
6. On success: log `outcome='sent'`, return `204 No Content`.

**Response codes:**

| Status | Code | When |
|---|---|---|
| 204 | — | Magic link dispatched. |
| 400 | `INVALID_EMAIL` | Zod validation failed. |
| 429 | `RATE_LIMITED` | >5 sends in last hour for this email. Includes `Retry-After` header (seconds). |
| 502 | `EMAIL_SEND_FAILED` | Supabase or Resend returned an error. |
| 500 | `INTERNAL_ERROR` | Unexpected exception. Logged. |

**Important:** This endpoint **always returns the same shape regardless of whether the email belongs to an existing user** (Supabase's `signInWithOtp` does not distinguish — it sends the link either way and creates the user on first redemption). This is the desired behavior: it prevents email enumeration (an attacker cannot tell which addresses have accounts).

### 4.2 `GET /api/auth/callback` — magic-link redirect target

**Auth:** not required (the user is being authenticated by this very call).

This is the URL embedded in the email. It receives Supabase's authorization code (PKCE flow) and exchanges it for a session, setting cookies via `@supabase/ssr`.

**Query params:**

```
?code=<string>          (PKCE; Supabase default)
&type=magiclink         (sometimes present)
&next=/runs             (optional; safe path only — see §3.4)
```

OR (older OTP-style template):

```
?token_hash=<string>&type=magiclink
```

**Behavior:**

1. Parse query with `CallbackQuerySchema`. On failure: log `outcome='callback_invalid'`, redirect to `/sign-in/error?reason=invalid`.
2. If `code` is present: call `supabase.auth.exchangeCodeForSession(code)`.
3. Else if `token_hash` and `type` are present: call `supabase.auth.verifyOtp({ token_hash, type })`.
4. Else: redirect to `/sign-in/error?reason=invalid`.
5. On Supabase error:
    - Error message contains `expired` → log `outcome='callback_expired'`, redirect to `/sign-in/error?reason=expired`.
    - Error message contains `already used` or `invalid` → log `outcome='callback_already_used'`, redirect to `/sign-in/error?reason=used`.
    - Other → log `outcome='callback_invalid'`, redirect to `/sign-in/error?reason=invalid`.
6. On success: log `outcome='callback_success'` with `user_id`, then determine post-auth redirect (§5.4) and return a `307` redirect.

**Reference implementation** (`app/api/auth/callback/route.ts`):

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CallbackQuerySchema } from "@/lib/validation/auth";
import { logLoginAttempt } from "@/lib/db/login-attempts";
import { resolvePostAuthDestination } from "@/lib/services/auth";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const parsed = CallbackQuerySchema.safeParse(Object.fromEntries(url.searchParams));

  // Always known up-front; logged on every branch:
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const ua = req.headers.get("user-agent")?.slice(0, 500) ?? null;

  if (!parsed.success) {
    await logLoginAttempt({ email: "", ip, ua, outcome: "callback_invalid" });
    return NextResponse.redirect(new URL("/sign-in/error?reason=invalid", req.url));
  }

  const { code, token_hash, type, next } = parsed.data;
  const supabase = await createSupabaseServerClient();

  let exchangeResult;
  if (code) {
    exchangeResult = await supabase.auth.exchangeCodeForSession(code);
  } else if (token_hash && type) {
    exchangeResult = await supabase.auth.verifyOtp({ token_hash, type });
  } else {
    await logLoginAttempt({ email: "", ip, ua, outcome: "callback_invalid" });
    return NextResponse.redirect(new URL("/sign-in/error?reason=invalid", req.url));
  }

  if (exchangeResult.error) {
    const msg = exchangeResult.error.message.toLowerCase();
    const reason =
      msg.includes("expired") ? "expired" :
      (msg.includes("already") || msg.includes("invalid")) ? "used" :
      "invalid";
    const outcome =
      reason === "expired" ? "callback_expired" :
      reason === "used"    ? "callback_already_used" :
                             "callback_invalid";
    await logLoginAttempt({ email: "", ip, ua, outcome });
    return NextResponse.redirect(new URL(`/sign-in/error?reason=${reason}`, req.url));
  }

  const userId = exchangeResult.data?.user?.id ?? null;
  const email = exchangeResult.data?.user?.email ?? "";
  await logLoginAttempt({ email, ip, ua, outcome: "callback_success", userId });

  const dest = await resolvePostAuthDestination(supabase, next ?? null);
  return NextResponse.redirect(new URL(dest, req.url));
}
```

The `logLoginAttempt` helper writes to `public.login_attempts` using the service-role client (the user's session is not yet established when audit rows for invalid callbacks are written). All errors from `logLoginAttempt` are caught and logged to Sentry — a logging failure must not block the user from signing in.

### 4.3 `POST /api/auth/sign-out` — invalidate session

**Auth:** required (no-op if already signed out).

**Behavior:**

1. Call `supabase.auth.signOut()`.
2. Clear the SSR cookies (handled by `@supabase/ssr` when invoked through `createSupabaseServerClient`).
3. Redirect to `/sign-in` with `303 See Other`.

This is implemented as a Next.js Server Action (not a JSON API) so it can be wired to a `<form action={signOut}>` in the header — no client JS required for the happy path.

### 4.4 `GET /api/auth/whoami` — current session probe (Phase 2 — not built in Phase 1)

Out of scope for Phase 1. Listed here only to claim the path so future code lands in the right place. Phase 1 has no client-side need for this — the server components render based on the SSR session directly.

---

## 5. Business Logic

### 5.1 Magic-link send flow

**Inputs:** `email: string` (post-Zod normalization).

**Steps:**

1. Rate-limit check against `public.login_attempts` (§5.3).
2. Construct callback URL: `${env.SITE_URL}/api/auth/callback`. Optionally append `?next=<safe-path>` if the request includes one (e.g., the user was bounced from an authenticated route).
3. Call:

```typescript
await supabase.auth.signInWithOtp({
  email,
  options: {
    emailRedirectTo: `${env.SITE_URL}/api/auth/callback`,
    shouldCreateUser: true,    // explicit: same flow signs up and signs in
  },
});
```

4. Supabase mints a single-use, 15-minute OTP, builds the email body using our **custom template** (§5.5), and dispatches it via Resend SMTP (configured at the project level in the Supabase dashboard).
5. Append a row to `login_attempts` with `outcome='sent'`.

**Cost notes:** Each magic-link send is one Resend transactional email — well within the free tier. Supabase Auth has its own rate-limit (separate from ours): 30 magic links per hour per project by default. Our 5/email/hour limit (§5.3) is the user-facing cap; the Supabase global cap protects against multi-user enumeration sprees.

### 5.2 Magic-link TTL and single-use semantics

- **TTL:** 15 minutes. Set in **Supabase dashboard → Authentication → Email → "Magic Link expiry"** to 900 seconds.
- **Single-use:** enforced by Supabase. The `code` param in the callback URL is invalidated on the first successful `exchangeCodeForSession` call. A second call returns an error containing "already" or "invalid", which we map to `ALREADY_USED`.
- **PKCE:** Supabase defaults to the PKCE flow for SSR. The code in the URL is opaque; the verifier lives in the cookie set when `signInWithOtp` was called. **This means the link must be opened in the same browser that requested it** for the cookie verifier to be present.
  - **Decision:** in Phase 1 we accept this UX limitation. Cross-device link clicks will fail with `INVALID_LINK`. This is more secure (PKCE is the intended flow) and matches the PRD edge case "User clicks the link on a different device/browser → allow it, but flag the session in logs (no UX block in v1)" — except we err on the side of refusal rather than allow. Flagged in §10 for revisit.

### 5.3 Rate limiting

**Limit:** 5 magic-link sends per email per hour, sliding window.

**Algorithm:**

```typescript
// In lib/services/auth.ts
async function checkSendRateLimit(email: string): Promise<
  { allowed: true } | { allowed: false; retryAfterSec: number }
> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const { count, error } = await supabaseService
    .from("login_attempts")
    .select("attempted_at", { count: "exact", head: true })
    .eq("email", email)
    .eq("outcome", "sent")
    .gte("attempted_at", oneHourAgo.toISOString());

  if (error) throw new Error("Rate-limit check failed");
  if ((count ?? 0) < 5) return { allowed: true };

  // Find the oldest of the 5 most recent sends; reset window starts when it ages out.
  const { data } = await supabaseService
    .from("login_attempts")
    .select("attempted_at")
    .eq("email", email)
    .eq("outcome", "sent")
    .gte("attempted_at", oneHourAgo.toISOString())
    .order("attempted_at", { ascending: true })
    .limit(1);

  const oldest = data?.[0]?.attempted_at;
  const retryAfterSec = oldest
    ? Math.max(1, Math.ceil((new Date(oldest).getTime() + 60 * 60 * 1000 - Date.now()) / 1000))
    : 60 * 60;

  return { allowed: false, retryAfterSec };
}
```

**Why a DB-backed counter and not Redis:** Phase 1 has no Redis dependency. Postgres handles ~5 lookups/second comfortably under the partial index `login_attempts_email_sent_recent`. Migrating to Redis is a Phase 2 optimization if write contention becomes an issue.

**Accuracy:** the index ordering guarantees the count is consistent within the request's snapshot; race conditions between two near-simultaneous requests for the same email may briefly exceed the cap by 1, which is acceptable.

**Failure mode:** if the rate-limit check itself fails (DB outage), we **fail closed**: return `502 { code: "EMAIL_SEND_FAILED" }`. Accepting an unbounded number of magic-link sends during a DB outage is a DoS vector.

### 5.4 Post-auth redirect logic

After a successful `exchangeCodeForSession` in the callback, the user must be routed to the right next-step page.

```typescript
// In lib/services/auth.ts
export async function resolvePostAuthDestination(
  supabase: SupabaseClient,
  hintedNext: string | null,
): Promise<string> {
  if (hintedNext && hintedNext.startsWith("/")) {
    return hintedNext;
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "/sign-in"; // shouldn't happen — defensive

  // Read profiles.channel_count_cache in a single query.
  // RLS enforces user-scoping; we still pass user.id explicitly for clarity.
  const { data: profile } = await supabase
    .from("profiles")
    .select("channel_count_cache")
    .eq("id", user.id)
    .single();

  if (!profile || profile.channel_count_cache === 0) {
    return "/onboard";
  }
  return "/runs";
}
```

**Why read `channel_count_cache` and not query `channels`:** the cache is maintained by spec #01's trigger and avoids a join. This is the single read on a hot path (every successful sign-in) — minimizing it matters.

**The `next` hint:** when middleware redirects an unauthenticated user to `/sign-in?next=/runs/abc123`, the sign-in page passes `next=/runs/abc123` through `signInWithOtp.options.emailRedirectTo` so the email's link includes it. After auth, the callback honors it. The Zod regex (§3.4) blocks open-redirect abuse.

### 5.5 Email template

Configured in **Supabase dashboard → Authentication → Email Templates → Magic Link**. Replaces the default Supabase template with our branded version.

**Subject:**

```
Your sign-in link to Viralizer
```

**HTML body** (template variables `{{ .ConfirmationURL }}` and `{{ .Email }}` are interpolated by Supabase):

```html
<!DOCTYPE html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0e0e12; color: #e8e8ec; margin: 0; padding: 24px;">
    <div style="max-width: 480px; margin: 0 auto; background: #13131a; border-radius: 16px; padding: 32px; border: 1px solid rgba(255,255,255,0.06);">
      <div style="font-weight: 800; font-size: 18px; color: #ffffff; margin-bottom: 24px;">Viralizer</div>
      <h1 style="font-size: 22px; font-weight: 800; color: #ffffff; margin: 0 0 12px;">Sign in to Viralizer</h1>
      <p style="color: #a3a3ad; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
        Click the button below to finish signing in. This link works for 15 minutes and can only be used once.
      </p>
      <a href="{{ .ConfirmationURL }}"
         style="display: inline-block; background: linear-gradient(180deg, #ff2d3f, #ff0033); color: #ffffff; padding: 12px 24px; border-radius: 8px; font-weight: 600; text-decoration: none;">
        Sign in to Viralizer
      </a>
      <p style="color: #7a7a86; font-size: 12px; line-height: 1.6; margin: 32px 0 0;">
        If the button doesn't work, paste this link into your browser:<br>
        <span style="word-break: break-all; color: #cdcdd4;">{{ .ConfirmationURL }}</span>
      </p>
      <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.06); margin: 32px 0;">
      <p style="color: #52525e; font-size: 11px; line-height: 1.5; margin: 0;">
        Sent to {{ .Email }} because someone requested a sign-in link. If that wasn't you, ignore this email — no account is created until the link is clicked.
      </p>
    </div>
  </body>
</html>
```

**Plain-text body** (Supabase auto-derives from HTML if a text version isn't supplied; we override to ensure quality):

```
Sign in to Viralizer

Click this link to finish signing in. It works for 15 minutes, once:
{{ .ConfirmationURL }}

Sent to {{ .Email }}. If you didn't request this, ignore it — no account is created until the link is clicked.
```

The `{{ .ConfirmationURL }}` placeholder resolves to a URL of the form:

```
https://<project-ref>.supabase.co/auth/v1/verify
  ?token=<otp>
  &type=magiclink
  &redirect_to=<our SITE_URL>/api/auth/callback
```

Supabase verifies the OTP, then redirects to `redirect_to` with `?code=...` appended. **The `redirect_to` host must be allow-listed in Supabase dashboard → Authentication → URL Configuration → Redirect URLs.** Required entries:

- `http://localhost:3000/api/auth/callback` (dev)
- `https://staging.viralizer.app/api/auth/callback` (staging)
- `https://viralizer.app/api/auth/callback` (production)

Missing entries cause Supabase to reject the redirect with a generic error — the user lands on Supabase's error page, never reaches our callback. This is a classic on-call footgun. Flagged in §10.

### 5.6 Middleware: session enforcement on `(app)` routes

`middleware.ts` at the project root runs on every request matching the `(app)` route group plus the API routes that require auth.

```typescript
// middleware.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseMiddlewareClient } from "@/lib/supabase/middleware";

const PUBLIC_PATHS = [
  "/sign-in",
  "/sign-in/sent",
  "/sign-in/error",
  "/api/auth/sign-in",
  "/api/auth/callback",
  // Marketing pages — out of scope for this spec but listed for completeness:
  "/",
  "/pricing",
];

const PROTECTED_PREFIXES = [
  "/onboard",
  "/runs",
  "/api/onboard",
  "/api/channels",
  "/api/profile",
  "/api/competitors",
  "/api/pipeline",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Static / public assets — let through.
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  ) {
    return NextResponse.next();
  }

  // Public paths — let through.
  if (PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + "/"))) {
    // Refresh the session cookie if present (does nothing for unauthenticated users).
    const { response } = await createSupabaseMiddlewareClient(req);
    return response;
  }

  // Protected paths — require session.
  const isProtected = PROTECTED_PREFIXES.some(p => pathname.startsWith(p));
  if (!isProtected) {
    return NextResponse.next(); // unhandled path; fall through (404 handled by Next.js)
  }

  const { supabase, response } = await createSupabaseMiddlewareClient(req);
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    // Preserve the path the user was trying to reach.
    const signInUrl = new URL("/sign-in", req.url);
    if (pathname !== "/sign-in") {
      signInUrl.searchParams.set("next", pathname + req.nextUrl.search);
    }
    return NextResponse.redirect(signInUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     *  - _next/static (static files)
     *  - _next/image (image optimization files)
     *  - favicon.ico
     *  - public files (images, fonts)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

**Why API routes are also matched:** middleware enforces auth at the edge — a request to `/api/onboard` without a session is rejected with a redirect (or, for `Accept: application/json` requests, the route handler itself returns `401 { code: "UNAUTHENTICATED" }`). This is defense in depth alongside RLS.

**Critical Supabase SSR pattern:** the `createSupabaseMiddlewareClient` factory **must return both `supabase` and `response`** because the SSR client mutates the response cookies on token refresh. Returning only `supabase` discards the refreshed cookies and the user's session silently expires after the first request. This bug is the single most common Supabase SSR pitfall.

```typescript
// lib/supabase/middleware.ts
import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

export async function createSupabaseMiddlewareClient(req: NextRequest) {
  let response = NextResponse.next({ request: { headers: req.headers } });

  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (cookies) => {
        cookies.forEach(({ name, value, options }) => {
          response.cookies.set({ name, value, ...options });
        });
      },
    },
  });

  return { supabase, response };
}
```

---

## 6. State Management

### 6.1 Server state

Authoritative for: `auth.users` (Supabase), `public.profiles` (linked 1:1), `public.login_attempts`, and the active session cookie (HTTP-only, secure, set by `@supabase/ssr`).

**Session storage:** by default Supabase sets two cookies: `sb-<ref>-auth-token` (the access + refresh token bundle) and `sb-<ref>-auth-token-code-verifier` (PKCE verifier; cleared after exchange). Configuration:

```typescript
// lib/supabase/server.ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) =>
            cookieStore.set({ name, value, ...options })
          );
        } catch {
          // The `set` method throws when called from a Server Component.
          // This is expected — the middleware is responsible for cookie writes
          // on read paths. Ignored here.
        }
      },
    },
  });
}
```

**Cookie attributes** (set by Supabase; we do not override):

- `HttpOnly: true`
- `Secure: true` in production (`Secure: false` in dev for `localhost` over HTTP)
- `SameSite: Lax` — required for the magic-link redirect to attach the cookie. `Strict` would block the cross-origin redirect from the email client.
- `Path: /`
- Access token TTL: 1 hour (Supabase default; auto-refreshed by SSR on every request)
- Refresh token TTL: **30 days** (overridden in Supabase dashboard → Authentication → Sessions → "Refresh token reuse interval" + JWT expiry settings)

**Service-role client:** used only inside `lib/db/login-attempts.ts` for writes to `login_attempts` (which is RLS-locked). All other DB access uses the user's session client.

### 6.2 Client state

The auth pages are **server components** by default (per CLAUDE.md TS-1). The minimal client-side state required:

- `/sign-in` form — needs `useState` for the email field and submit-disabled state during the in-flight POST. Marked `"use client"` only for that single form component, not the whole page.
- `/sign-in/sent` resend-cooldown timer — a `"use client"` component holds a 30-second `setInterval` countdown and re-enables the resend button when it hits zero.
- `/sign-in/callback` — **does not exist as a page**. The callback is a server route handler (`/api/auth/callback`) that redirects directly. State 4 in the mockup is a *transient* render the user may briefly see only if the redirect is slow; it can be implemented as a no-page fallback (the "Signing you in…" state lives only in the brief delay between the email click and the server's redirect — no React component is needed).
- App header sign-out dropdown — `"use client"` for the open/close state. The sign-out itself is a server action.

**No global state library** (Zustand, Redux) is required.

### 6.3 Optimistic updates

Not applicable — auth state changes are always server-confirmed before the UI reflects them.

---

## 7. UI/UX Behavior

### 7.1 Routes

| Route | Auth | Purpose |
|---|---|---|
| `/sign-in` | not required | Email entry form. If user already has a session, redirect to post-auth destination (§5.4). |
| `/sign-in/sent?email=<email>` | not required | Confirmation page after submit. Shows the masked email, a "Didn't get it?" block with a 30s-cooldown resend button. |
| `/sign-in/error?reason=<reason>` | not required | Landing for callback failures. `reason` ∈ `{expired, used, invalid}`. |
| `/api/auth/sign-in` | not required | POST handler for the form. |
| `/api/auth/callback` | not required | Magic-link redirect target. |
| `/api/auth/sign-out` | required | Server action — terminates session and redirects to `/sign-in`. |

The `(public)` route group hosts all `/sign-in*` pages so they bypass the `(app)` middleware's session check.

### 7.2 `/sign-in` (mockup State 1)

- Centered card, max-width 28rem.
- Logo + heading "Sign in to Viralizer" + subhead "We'll email you a sign-in link — no password needed. New here? Same flow signs you up."
- Single email input with envelope icon prefix.
- "Send link" button, full width, brand-red gradient.
- Footer line: "Passwordless. Links expire after 15 minutes." (Update from mockup's "60 minutes" — see §2 PRD divergence note.)

**Submit handler:**

1. Client-side Zod validation (`SignInInputSchema`). On failure: render mockup State 5 (rose-themed inline error under the input).
2. POST `/api/auth/sign-in` with `{ email }`.
3. While in flight: render mockup State 2 (button shows spinner + "Sending link…", input disabled).
4. On `204`: client-side `router.push("/sign-in/sent?email=" + encodeURIComponent(email))`.
5. On `429 RATE_LIMITED`: render mockup State 6 (amber banner above card with "We've sent several links recently" copy + countdown derived from `Retry-After` header).
6. On `502 EMAIL_SEND_FAILED`: render mockup State 7 (rose banner + "Retry send" button).
7. On `500 INTERNAL_ERROR`: render mockup State 7 with generic copy.

### 7.3 `/sign-in/sent` (mockup State 3)

- Heading "Check your inbox" + sub "We sent a sign-in link to **<email>**. Click it and you're in."
- Numbered 1-2-3 walkthrough card.
- "Didn't get it?" block with 30s-cooldown resend button. Cooldown is **client-side only** (the `<input type="number">`-style countdown). The actual rate limit is enforced server-side regardless.
- "← Use a different email" link routes back to `/sign-in`.

**Resend button behavior:**

- Disabled for 30s after page load.
- Click → POST `/api/auth/sign-in` again with the same email.
- On `429`: re-enter the rate-limited state (banner above card).

The page does **not** poll for sign-in completion. The user signs in by clicking the email link, which lands them at `/api/auth/callback` and then their post-auth destination — this tab is irrelevant after the email is sent.

### 7.4 `/sign-in/error` (mockup States 8, 9, 10)

Branches on `reason` query param:

| `reason` | Mockup State | Heading | Body | CTAs |
|---|---|---|---|---|
| `expired` | 8 | "This link has expired" | "Magic links are good for 15 minutes. We'll send a fresh one — should land in your inbox in seconds." | Primary: "Send a new link" (routes to `/sign-in`); Secondary: "Use a different email" |
| `used` | 9 | "This link has already been used" | "Each magic link is single-use. If you signed in already, you're good — head to your runs." | Primary: "Send new link"; Secondary: "Go to runs" (smart: if user has a session, route to `/runs`; if not, route to `/sign-in`) |
| `invalid` | 10 | "This link isn't valid" | "The link looks malformed — maybe it got cut off when forwarded, or the URL was edited." | Primary: "Request a new link" (routes to `/sign-in`); Secondary: "Need help? Read the docs" |

**Default reason** if param is missing or unrecognized: `invalid`.

### 7.5 App header sign-out dropdown (mockup State 11)

Lives in `app/(app)/_components/UserMenu.tsx`. Rendered on every authenticated page.

- Trigger: chip with avatar (first letter of email), email address, chevron.
- Dropdown:
  - Header: "Signed in as" + email + green pill "Session active · expires in N days" (computed from refresh token expiry; not strictly accurate, but the visual cue is what the user reads)
  - "Account settings" — Phase 2; in Phase 1 routes to `/account` which is a stub page or removed entirely (decision below)
  - "Help & docs" — Phase 2 placeholder
  - Divider
  - "Sign out" — `<form action={signOutAction}><button>` styled red

**Phase 1 dropdown decision:** The "Account settings" and "Help & docs" rows are out of scope. Render only "Signed in as <email>" + "Sign out" in Phase 1. The visual scaffolding for the other rows can be added when those features ship. Update mockup notes accordingly.

### 7.6 Loading states

- `/sign-in` submit (mockup State 2): button spinner + disabled input. ~500ms typical.
- `/sign-in/callback`: the user briefly sees "Signing you in…" (mockup State 4) only if Supabase's verify + our session-set takes >200ms. In practice this redirect happens before the browser paints anything. **Implementation:** no React component. The route handler returns a 307 redirect within 100-300ms.

### 7.7 Already-signed-in handling

If a user with a valid session navigates to `/sign-in`, `/sign-in/sent`, or `/sign-in/error`, the page should redirect them to their post-auth destination (§5.4). Done as a server-component check at the top of each page:

```typescript
// app/(public)/sign-in/page.tsx
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolvePostAuthDestination } from "@/lib/services/auth";

export default async function SignInPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const dest = await resolvePostAuthDestination(supabase, null);
    redirect(dest);
  }
  return <SignInForm />;
}
```

---

## 8. Edge Cases

| Case | Behavior |
|---|---|
| Email contains `+` alias (e.g., `nik+test@example.com`) | Allowed. Zod's `.email()` accepts RFC 5322; Supabase stores as-is. Rate-limit bucket keyed by exact normalized email — `nik+test@x.com` and `nik@x.com` are independent. |
| Email contains non-ASCII (e.g., `nikolás@ünicode.com`) | Allowed. Internationalized email is RFC 6531-valid; Supabase supports it. Tested in QA. |
| Email length > 254 chars | Rejected by Zod `.max(254)` with `INVALID_EMAIL`. RFC 5321 limit. |
| User submits same email twice within the cooldown | Server-side rate limiter is the source of truth. Client-side 30s cooldown is just UX polish. |
| User exceeds 5 sends in an hour | `429 RATE_LIMITED` with `Retry-After` header. UI shows mockup State 6 with countdown. |
| User clicks magic link in a different browser than they requested it in | PKCE verifier cookie is missing → `exchangeCodeForSession` fails → redirected to `/sign-in/error?reason=invalid`. **This is a known UX limitation in Phase 1.** Listed in §10. |
| User clicks the link twice (double-click) | First click consumes the OTP and redirects to post-auth destination. Second click hits Supabase, gets "already used" error, redirected to `/sign-in/error?reason=used`. |
| Link clicked after 15 minutes | Supabase returns expired error → `/sign-in/error?reason=expired`. |
| Link is forwarded to another person who clicks it | If still within 15 minutes and unused, that person signs in as the original requester. **This is a known limitation of email-based magic links across the industry.** Mitigated only by the 15-min TTL and PKCE binding (the verifier cookie is in the original requester's browser, so the forwarded click fails with `INVALID_LINK`). |
| User has session but visits `/sign-in` | Redirected to post-auth destination (§7.7). |
| Resend service down | Supabase's SMTP call fails → `502 EMAIL_SEND_FAILED`. UI shows mockup State 7 with retry button. The `login_attempts` row is `outcome='send_failed'`, not `'sent'` — does **not** count against the rate limit. |
| Supabase Auth down | Same path as Resend down. The retry-with-backoff is implicit (user clicks "Retry send"). No automatic retry — magic-link sending is user-initiated. |
| User signs out then immediately signs in on the same device | New session cookie set; old session was already invalidated by `signOut()`. No double-session state. |
| User signs in on multiple devices | Supabase issues independent refresh tokens per session. Both work. Sign-out only ends the current device's session. |
| User loses access to their email account | **No recovery flow in Phase 1.** Listed as known limitation. Phase 2 ticket: "Allow email change via support contact + identity verification." |
| Browser blocks third-party cookies | The session cookie is **first-party** (set on our domain), so this doesn't affect us. Some anti-tracking extensions may still block — out of scope. |
| User has DNT (Do Not Track) header set | Ignored. We do not run analytics on the auth flow in Phase 1. |
| User opens the email link inside the email client's preview pane (which sometimes pre-fetches links) | The pre-fetch consumes the OTP. When the user actually clicks, they get `ALREADY_USED`. **This is the most common real-world failure mode for magic links.** Mitigation: Supabase's PKCE flow requires the verifier cookie which is not present in the pre-fetcher's request, so the pre-fetch fails harmlessly with `INVALID_LINK` and the OTP is *not* consumed. PKCE fixes this for us — confirmed in Supabase docs. |
| User has multiple pending magic links (sent 3 in a row, clicks the second one) | Each link's `code` is independent until consumed. The first click consumes that link's OTP; other links remain valid until they expire or are clicked. Single-use is **per-link**, not per-email. |
| Existing user requests a link from a new device | Same flow. Supabase recognizes the email and signs into the existing `auth.users` row. No duplicate account is created. |
| User submits an email that's the upper-case version of their existing email (`Nik@Example.com` vs `nik@example.com`) | Zod lowercases before any DB write. Supabase Auth itself stores email lowercased. They resolve to the same `auth.users` row. |
| User clicks email link while logged in as someone else | The new code's `exchangeCodeForSession` replaces the existing session. The old session's refresh token remains valid until expiry (or until the user explicitly signs out elsewhere). |
| Profile row doesn't exist for an authenticated user (trigger failed?) | `resolvePostAuthDestination` returns `/onboard` (the `!profile` branch). Onboarding will then INSERT/UPSERT the channel; spec #01's `confirmOnboard` does a `tx.profiles.findOne` that will create-or-fetch as needed. Defensive. |
| User clicks "Sign out" but their session has already expired | `supabase.auth.signOut()` is a no-op for an unauthenticated client. The redirect to `/sign-in` happens regardless. |
| `next` param in callback is a path that the user is not authorized to view (e.g., `/runs/<other-user's-runId>`) | Redirect is honored. The destination route's own auth/RLS check returns 404 (per spec #01 SEC-2). The auth flow is unaffected. |
| `next` param contains an attempted open redirect like `https://evil.example/x` or `//evil.example/x` | Zod regex rejects (must match `/^\/[a-zA-Z0-9/_-]*$/`). On rejection, `next` is ignored and we use the default destination logic. |
| Migration deploys, trigger fails for a brief window, new user signs up during that window | Their `auth.users` row exists but `profiles` does not. They land on `/onboard` (per the `!profile` defensive branch). Onboarding's first DB call will insert the missing profile. No user-visible failure. |

---

## 9. Security Considerations

- **No password storage:** entire feature avoids the most-attacked authentication primitive.
- **Single-use, time-bounded tokens:** Supabase enforces. 15-minute TTL minimizes stolen-link window.
- **PKCE flow:** the magic-link verifier is bound to the requesting browser via a code-verifier cookie. Forwarded or pre-fetched links cannot be redeemed without the verifier. This is materially stronger than the older "click the link from anywhere" flow.
- **Rate limiting (CLAUDE.md SEC equivalent):** 5 sends per email per hour at our app layer + Supabase's project-wide 30/hour cap. Logged in `login_attempts`.
- **No email enumeration:** `/api/auth/sign-in` returns the same `204` whether the email exists or not. An attacker cannot probe for valid accounts. Rate-limit responses (`429`) are also returned identically regardless of account existence.
- **No error-message leakage:** Supabase / Resend errors are logged server-side (Sentry) but the client receives only the seven canonical codes from §4. We never echo upstream messages.
- **Open-redirect prevention:** the `next` callback param is validated against `/^\/[a-zA-Z0-9/_-]*$/`. Absolute URLs, protocol-relative URLs (`//evil`), and query strings with their own redirects are all rejected. Fallback is `/onboard` or `/runs`.
- **CSRF:** Next.js Server Actions are CSRF-protected by default (the `next-action` header check). Same-origin POSTs to `/api/auth/sign-in` verify the `Origin` header matches `env.SITE_URL`. Cross-origin POSTs are rejected with `403`.
- **Cookie hardening:** `HttpOnly`, `Secure` (in prod), `SameSite=Lax`, `Path=/`. Session cookies cannot be read by JavaScript, mitigating XSS-driven theft.
- **RLS:** every read of `profiles` from a user-context client is filtered by `auth.uid()`. The `login_attempts` table is service-role-only (no policies → RLS denies all anon/authenticated access).
- **Audit trail:** every `sign-in` request and every callback outcome is logged to `login_attempts` with IP and user-agent. Sufficient for incident investigation.
- **PII:** email is the only identifier we store. IP and UA in `login_attempts` are operational data with 90-day retention. No additional encryption beyond Supabase defaults.
- **Trigger security (`security definer`):** the `handle_new_user` trigger uses `security definer` to bypass RLS — required for correctness. `set search_path = public` prevents schema-search-path manipulation. Function owner is the postgres role, which limits attack surface.
- **No prompt-injection surface:** this feature has no LLM calls. CLAUDE.md CRIT-3 is N/A.
- **Email content:** the magic-link email contains only the link and the user's own email address. No user-controlled fields are interpolated, eliminating header-injection and template-injection risks.
- **Sign-out invalidation:** `supabase.auth.signOut()` revokes the refresh token server-side. The access token remains valid for up to 1 hour (its TTL) — acceptable, since a logged-out client has no way to use it.
- **Multi-tab consistency:** signing out in one tab does **not** automatically sign out other tabs in Phase 1. The other tab will fail its next request with `401` and middleware will redirect to `/sign-in`. Active broadcast (via `BroadcastChannel` or Supabase realtime) is a Phase 2 polish.

---

## 10. Future Considerations (Out of Scope for Phase 1)

The following are intentionally deferred. Each is tracked elsewhere — do not implement as part of this feature.

- **Cross-device link clicks (PKCE relaxation):** allow magic links opened on a different device than they were requested from. Requires switching from PKCE to the older OTP flow (or adding a fallback path). Trade-off: improved UX vs. weaker binding. Phase 2 decision after observing real failure rates.
- **Email change flow:** currently email is the immutable identifier. Phase 2 ticket: support contact + identity-verification path to change the address on an existing account.
- **Account deletion / GDPR self-service:** Phase 2. Requires cascading delete across `channels`, `pipeline_runs`, `login_attempts`, etc.
- **Active-session listing + per-session revoke:** Phase 2 settings page showing all refresh tokens with their issued-at timestamps and a "Sign out everywhere" button.
- **Multi-tab sign-out broadcast:** Phase 2. `BroadcastChannel`-based notification so all open tabs reflect logout immediately.
- **Social logins (Google / Apple / GitHub):** Phase 3 if at all. Phase 1 is intentionally email-only to minimize provider dependencies and OAuth attack surface.
- **2FA:** Phase 3. Magic-link is *already* a single factor that proves email control; adding TOTP would be defense in depth but is overkill for the creator-tools threat model.
- **`login_attempts` retention cron:** 90-day purge. Phase 2. For Phase 1 the table grows linearly with sign-ins and is small enough to ignore.
- **Supabase redirect-URL allowlist drift:** when deploying to a new environment, Supabase's allowlist must be updated manually. Add a deployment checklist item or move to Supabase config-as-code (Phase 2).
- **Mockup copy update:** "Links expire after 60 minutes" → "Links expire after 15 minutes" on `/sign-in` and the email body. Tracked as a Phase-1-blocking copy fix (§2 divergence note).
- **Custom error page for Supabase's own redirect-URL rejection:** if a misconfigured `redirect_to` is rejected by Supabase Auth, the user lands on a generic Supabase error page, not ours. Hard to fix because the rejection happens before our domain is reached. Mitigated by deployment checklist; product fix is "don't misconfigure."
- **Email deliverability monitoring:** alerts on bounce/spam rates from Resend. Phase 2.
- **Phase 2 — Stripe paywall integration:** when Stripe ships, the post-auth redirect logic may need a third branch (e.g., expired-trial users → `/billing`). The `resolvePostAuthDestination` function is the extension point.

---

## Appendix A — File map

This spec implies the following files exist by the end of implementation:

```
app/
  (public)/
    sign-in/
      page.tsx                          # /sign-in — server component, redirects if signed in
      _components/
        SignInForm.tsx                  # "use client" — email field + submit handler
      sent/
        page.tsx                        # /sign-in/sent
        _components/
          ResendButton.tsx              # "use client" — 30s cooldown timer
      error/
        page.tsx                        # /sign-in/error?reason=...
  (app)/
    _components/
      UserMenu.tsx                      # header dropdown with sign-out
  api/
    auth/
      sign-in/route.ts                  # POST → signInWithOtp + rate-limit check
      callback/route.ts                 # GET → exchangeCodeForSession + redirect
      sign-out/route.ts                 # POST (server action) → signOut
lib/
  supabase/
    server.ts                           # createSupabaseServerClient (SSR cookies)
    middleware.ts                       # createSupabaseMiddlewareClient (response mutation)
    service.ts                          # service-role client for login_attempts
  services/
    auth.ts                             # checkSendRateLimit, resolvePostAuthDestination
  db/
    login-attempts.ts                   # logLoginAttempt + rate-limit query
    profiles.ts                         # already in spec #01 — read-only access here
  validation/
    auth.ts                             # SignInInputSchema, CallbackQuerySchema
middleware.ts                           # session enforcement on (app) routes
supabase/
  migrations/
    20260510_login_attempts.sql         # citext extension + login_attempts table
    20260510_profiles_trigger.sql       # handle_new_user function + trigger
  templates/
    magic-link.html                     # branded email body (uploaded to Supabase dashboard)
    magic-link.txt                      # plain-text fallback
```

---

## Appendix B — CLAUDE.md updates required

When this spec is implemented, the following CLAUDE.md sections must be updated:

1. **Stack lock-in:** confirm `@supabase/ssr` is the cookie/session library. Add a line under "Database + Auth: **Supabase**" reading: "Session/cookie management via **`@supabase/ssr`**. All server clients via `lib/supabase/server.ts`; middleware client via `lib/supabase/middleware.ts`. Service-role client (`lib/supabase/service.ts`) used only for RLS-locked tables (`login_attempts`)."
2. **EXT-1 required env vars:** add `SITE_URL` to the validated env list. Used as the base for `emailRedirectTo` in `signInWithOtp` and as the CSRF Origin allowlist.
3. **Architecture A-1 layer rules:** add a row clarifying that `lib/supabase/` factories are exempt from the "no direct external SDK calls outside `lib/`" rule because they *are* the wrapper layer for Supabase.
4. **API-2 error envelope:** add the seven new auth-specific codes to the documented union: `INVALID_EMAIL`, `RATE_LIMITED`, `EXPIRED_LINK`, `INVALID_LINK`, `ALREADY_USED`, `EMAIL_SEND_FAILED` (in addition to the existing `UNAUTHENTICATED`, `INTERNAL_ERROR`).
5. **SEC-2 RLS:** add `login_attempts` to the list of RLS-protected tables, with the note that **no policies are defined** (service-role-only access by design).
6. **Common Mistakes section:** add an entry for the Supabase SSR middleware cookie-mutation pitfall — "When using `createServerClient` in middleware, you must return both the `supabase` client *and* the `NextResponse` because the SSR client mutates the response cookies during token refresh. Returning only the client silently drops refreshed cookies and the user's session expires after the first request."
7. **Pre-Commit Checklist:** add an explicit row for "If touching auth: confirm Supabase dashboard's Redirect URL allowlist includes the deploy target's `/api/auth/callback` URL."
