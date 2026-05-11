# PRD — Email Magic-Link Auth

## Feature Name
Email Magic-Link Authentication

## Overview
Passwordless authentication using email magic links. Users enter their email, receive a one-time link, click it, and arrive signed in. No password storage, no social-login dependencies, mirrors the lead-magnet funnel pattern that converts well for creator-economy products.

**Problem solved:** Password auth introduces friction (forgot password, weak password, phishing) and signup friction kills conversions on free-tier landing pages. Magic links lower friction to the bare minimum: enter email, click link.

## User Stories
- As a new visitor, I want to sign up with just my email, so I can try the product without creating yet another password.
- As a returning user, I want to sign in by entering my email and clicking a link, so I never have to remember a password.
- As a user, I want my session to persist across browser tabs and reasonable time windows, so I'm not re-authenticated constantly.
- As a user, I want a clear "sign out" affordance, so I can end my session on shared devices.
- As a security-conscious user, I want magic-link tokens to expire if I don't use them quickly, so a stolen email can't compromise my account.

## Functional Requirements
- Sign-in form: single email input + "Send link" button
- On submit: send a magic-link email via Resend within 5 seconds
- Magic-link token must expire after 60 minutes
- Magic-link token is single-use; clicking it twice fails the second time
- Successful click creates a session and redirects to `/onboard` (if no channel) or `/runs` (if onboarded)
- Sessions persist for 30 days via secure HTTP-only cookie
- "Sign out" button in app header invalidates the session server-side
- Rate-limit magic-link sends to 5 per email per hour to prevent abuse
- Existing-user detection: same email signing in again returns to their existing account, never duplicates
- Email content: branded, includes the magic link and a plain-text fallback URL

## User Interface

### Screens
1. **`/sign-in`** — landing-style page with email input, "Send link" button, brief explainer copy ("We'll email you a sign-in link — no password needed").
2. **`/sign-in/sent`** — confirmation page after submitting email. "Check your inbox for a link from us." + "Resend link" button (disabled for 30s).
3. **`/sign-in/callback?token=…`** — invisible route that validates the token, creates the session, and redirects.
4. **`/sign-in/error`** — landing for invalid/expired tokens. Explanation + button to request a new link.
5. **App header sign-out control** — user-email dropdown with "Sign out" item.

### Key interactions
- Submitting an email shows a brief loading state, then routes to `/sign-in/sent`
- The "Resend link" button has a 30s cooldown to prevent accidental spam
- Clicking the magic link in email → callback validates → session set → redirect to onboarding or workspace

## States to Handle

### Happy path
Enter email → magic link sent → user clicks link in email → token validated → session created → routed to next step.

### Error states
- Invalid email format → inline validation before submit
- Resend service down or rate-limited → "Couldn't send right now, please try again in a minute"
- Magic-link token expired → `/sign-in/error` with "This link has expired. Request a new one."
- Magic-link token already used → `/sign-in/error` with "This link has already been used."
- Magic-link token malformed/forged → generic invalid-link error (do not reveal token internals)
- User exceeded send-rate limit → "We've sent several links recently. Please check your inbox or wait a few minutes."

### Empty states
- Not applicable — this is a single-form flow.

### Loading states
- Submitting email → button shows spinner, disabled until response
- Callback validation → blank screen with subtle spinner (typically <1s)

## Edge Cases
- User clicks the link on a different device/browser than where they requested it → allow it, but flag the session in logs (no UX block in v1)
- User clicks a link multiple times rapidly (double-click) → only first click creates session; second click sees "already used"
- User's email address contains a `+` alias or non-ASCII characters → must work
- User receives the email after the 60-minute window → expired-token flow
- Email lands in spam → out of our control, but "Resend link" button mitigates
- User loses access to the email account → no recovery flow in v1 (note in CLAUDE.md as a known limitation)
- Network failure during callback → user can request a new link
- User signs in on multiple devices → multiple sessions allowed; sign-out only ends current session

## Out of Scope
- Social logins (Google, Apple, GitHub)
- Password-based auth
- Two-factor authentication
- Account recovery via secondary channel
- Team accounts / multi-user organizations
- Session management UI (list of active sessions, revoke individual)
- Email change flow (Phase 2 — currently email is the immutable identifier)
- Account deletion / GDPR self-service (Phase 2)
