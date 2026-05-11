# Phase 1.2 — Supabase + schemas

**Parent:** Phase 1 — Foundation
**Status:** Not Started
**Estimated:** 4-6 hours
**Depends on:** Phase 1.1 (`lib/env.ts` with validated Supabase keys)
**Reference:** Build-Order.md §0.4; specs `01-channel-onboarding/spec.md §3`, `02-magic-link-auth/spec.md §3`, `03-idea-workspace-history/spec.md §3`; CLAUDE.md SEC-2, EXT-2.

## Goal

Stand up the Supabase project, define every table the Phase 1 product reads or writes, enable row-level security on all user-scoped tables, and ship typed Supabase client factories in `lib/supabase/` + DB query modules in `lib/db/` so feature code never speaks SQL directly. RLS is enabled from day one per SEC-2 — adding it later is much harder.

## What to Build

### Step 1 — Supabase project setup (dashboard config)
- Create dev/staging/prod projects.
- Enable email auth only (disable all other providers).
- Configure Resend SMTP under Authentication → Email.
- Set magic-link OTP expiry = **900 seconds** (15 min); refresh-token TTL = 30 days.
- Upload branded magic-link email template (HTML + text).
- Add redirect-URL allowlist: `http://localhost:3000/api/auth/callback`, staging URL, prod URL.
- Capture `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` for `lib/env.ts`.

### Step 2 — Migrations (`supabase/migrations/*.sql`)
Order matters — run in this sequence:
1. `0001_extensions.sql` — `citext`, `pg_trgm`.
2. `0002_profiles.sql` — `profiles` table extending `auth.users` with `active_channel_id`, `channel_count_cache`. RLS: select_own, update_own.
3. `0003_channels.sql` — full schema from spec #01 §3.1 (21 columns including `niche`, `niche_source`, JSONB stage fields, `deleted_at` soft-delete). Unique partial index on `(user_id, youtube_channel_id) WHERE deleted_at IS NULL`. 4 RLS policies. `sync_channel_count` trigger updates `profiles.channel_count_cache`. FK `profiles.active_channel_id → channels.id`.
4. `0004_profiles_trigger.sql` — `handle_new_user()` security-definer function + `on_auth_user_created` trigger on `auth.users`.
5. `0005_pipeline_runs.sql` — `pipeline_run_status` enum (queued/running/gated_failed/complete/error), `pipeline_runs` table with 10 JSONB stage columns + 10 `stale_*` booleans + status + indexes (partial `WHERE deleted_at IS NULL`), RLS select/insert/update_own (no DELETE policy — soft-delete only), `pg_trgm` GIN on `idea_text`.
6. `0006_youtube_quota_and_cache.sql` — `youtube_quota_usage` (date PK, units_used) + `youtube_api_cache` (cache_key, payload, expires_at). RLS enabled with **zero policies** → service-role only.
7. `0007_onboard_drafts.sql` — `onboard_drafts` (draft_id, user_id, payload, expires_at +10min). Service-role only.
8. `0008_login_attempts.sql` — `login_attempts` (citext email, outcome check constraint, indexes for rate limit + audit). Service-role only.

### Step 3 — Supabase client factories (`lib/supabase/`)
- `server.ts` — `createSupabaseServerClient()` using `@supabase/ssr` + `next/headers` cookies. Server Component cookie writes wrapped in try/catch.
- `middleware.ts` — `createSupabaseMiddlewareClient(req)` returns **both** `{ supabase, response }`. Returning only `supabase` silently drops refreshed cookies (the #1 SSR pitfall).
- `service.ts` — service-role client with `import "server-only"`. Never imported into client components.

### Step 4 — Typed DB layer (`lib/db/`)
- Run `supabase gen types typescript --linked > lib/db/types.ts`.
- Thin typed CRUD wrappers per A-1: `profiles.ts`, `channels.ts`, `runs.ts`, `login-attempts.ts`, `onboard-drafts.ts`, `youtube-quota.ts`, `youtube-cache.ts`.
- Every read parsed through Zod (lives in `lib/validation/`); snake_case ↔ camelCase transform at the boundary per API-1.

## Cross-feature contracts

- **`auth.users.id == public.profiles.id`** — every user has exactly one profile row, auto-created by the trigger. Onboarding, workspace, pipeline all assume this.
- **`channels.user_id` FK ON DELETE CASCADE** — deleting an auth user cleans up their channels. `pipeline_runs.channel_id` is RESTRICT — soft-delete via app code.
- **`profiles.active_channel_id`** is the source of truth for "which channel is active." `POST /api/runs` reads this to lock the channel on the new run.
- **`profiles.channel_count_cache`** maintained by trigger; app enforces 3-channel limit against this cache.
- **`pipeline_runs` JSONB columns** are typed `jsonb` here. Per-stage Zod schemas live in stage specs and gate content shape.
- **`youtube_quota_usage` and `youtube_api_cache`** are the CRIT-1 cache layer. Wrappers in Phase 1.3 read/write these.
- **`SUPABASE_SERVICE_ROLE_KEY`** never appears in `NEXT_PUBLIC_*` and `lib/supabase/service.ts` uses `import "server-only"`.

## Verification

- [ ] Migrations 0001–0008 apply cleanly on a fresh Supabase project; re-running is idempotent
- [ ] All 8 tables exist (verified by `\dt public.*`): profiles, channels, pipeline_runs, youtube_quota_usage, youtube_api_cache, onboard_drafts, login_attempts (plus auth.* managed by Supabase)
- [ ] `channels` table has 21 columns in spec #01 §3.1 order
- [ ] `pipeline_runs` has exactly 10 JSONB stage columns and 10 boolean `stale_*` columns
- [ ] `pipeline_run_status` enum has exactly 5 values: queued, running, gated_failed, complete, error
- [ ] Inserting via service client into `auth.users` produces a corresponding `public.profiles` row with `channel_count_cache=0` (trigger verified)
- [ ] Inserting a channel for a user increments `profiles.channel_count_cache`; soft-deleting decrements it
- [ ] RLS denies SELECT on another user's `channels` / `pipeline_runs` row from a session client
- [ ] RLS denies all access to `login_attempts`, `youtube_quota_usage`, `youtube_api_cache`, `onboard_drafts` from session clients (service-role only)
- [ ] `channels` unique partial index allows re-inserting after `deleted_at` is set
- [ ] `pipeline_runs.idea_text` check constraint rejects <10 or >500 char strings
- [ ] `pg_trgm` index used in EXPLAIN for `idea_text ILIKE '%test%'`
- [ ] `lib/supabase/middleware.ts` returns `{ supabase, response }` (typed)
- [ ] `lib/supabase/service.ts` import fails when imported into a `"use client"` component
- [ ] `grep -r 'NEXT_PUBLIC_.*SERVICE' .` returns nothing
- [ ] `lib/db/types.ts` is generated and includes all 8 tables

## Out of scope

- No data writes (this phase ships empty tables only)
- No service-layer logic (Phase 1.3+)
- No API route handlers (Phase 1.4+)
- No middleware.ts at root (Phase 1.4)
- No background jobs / cleanup crons (Phase 2)
- No `outlier_corpus`, `niche_vocabulary`, `channel_assets` (Phase 2/3)
- No `mode: "competitor"` column on channels (Phase 2)
- No per-tier channel limits (Phase 2 — Stripe)
