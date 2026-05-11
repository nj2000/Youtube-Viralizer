# Phase 1.2 — Supabase + Schemas

**Status:** Complete (dev environment; staging/prod deferred)
**Date:** 2026-05-11
**Branch:** `main`
**Detail:** See `Phases/Phase 1 — Foundation/Phase 1.2 — Supabase + schemas/summary.md` for the full per-file breakdown and verification log.

---

## What was built

The data foundation every Phase 1.3+ feature reads and writes through:

- A dev Supabase project (`cbfdafhugrthyeaquyta`, West EU / Ireland) provisioned, linked to the CLI, and **all 8 migrations applied** with local↔remote parity confirmed.
- The full schema for Phase 1: `profiles`, `channels` (21 cols, partial unique index, soft-delete), `pipeline_runs` (10 JSONB stage columns + 10 `stale_*` booleans + a 5-value `pipeline_run_status` enum + a `pg_trgm` GIN index on `idea_text`), plus the service-role-only tables `youtube_quota_usage`, `youtube_api_cache`, `onboard_drafts`, and `login_attempts`. RLS is on for every table — user-scoped ones get per-action policies; service-only ones get zero policies.
- Two security-definer triggers in a `private` schema: `handle_new_user()` auto-creates a `profiles` row on every `auth.users` insert, and `sync_channel_count()` keeps `profiles.channel_count_cache` in sync as channels are inserted, soft-deleted, or restored.
- The three typed Supabase clients in `lib/supabase/`: `server.ts` (Server Components / Server Actions via `@supabase/ssr` + `next/headers`), `middleware.ts` (returns `{supabase, response}` so rotated cookies propagate), and `service.ts` (service-role, pinned to `import "server-only"`).
- Generated `lib/db/types.ts` and 7 thin typed CRUD wrappers (`profiles`, `channels`, `runs`, `login-attempts`, `onboard-drafts`, `youtube-quota`, `youtube-cache`) — each takes an injected `SupabaseClient<Database>` so callers control session vs. service-role auth.
- Zod schemas for the `channels` JSONB columns (`TopVideoSchema`, `CompetitorSchema`, `CompetitorSetSchema`). Stage-payload Zod for `pipeline_runs.*_data` is left to the phases that write those columns.
- Auth config patched on the dev project: 15-minute OTP expiry, 30-day refresh-token inactivity timeout, and the `/api/auth/callback` redirect allowlist. Resend SMTP and the branded magic-link email template remain deferred to Phase 1.4.

---

## Key implementation decisions

| Decision | Why |
|---|---|
| **CLI `db push` instead of Supabase MCP** | The MCP server needs an OAuth handshake to expose its tools; the CLI was already authenticated. CLI is deterministic, scriptable, and the path the user picked. |
| **PATCHed auth config via Management API, not dashboard** | The CLI doesn't expose `auth update` subcommands, and three values needed setting (`mailer_otp_exp`, `sessions_inactivity_timeout`, `uri_allow_list`). One `curl PATCH` to `https://api.supabase.com/v1/projects/<ref>/config/auth` covered all three reproducibly. |
| **JSONB content stored as camelCase, not snake_case** | API-1 (snake_case in DB, camelCase in TS) governs *column names*. JSONB payload shape is application data — keeping it camelCase removes a transform layer and keeps Zod schemas readable. The boundary is still respected: `Channel.topVideos` is the contract; `top_videos_json` is the storage detail. |
| **`onboard_drafts.draft_id` generated client-side** | Other UUID PKs in the schema use `default gen_random_uuid()`; this one doesn't. Rather than spin up a `0009_*` migration just to add a default, `createOnboardDraft()` calls `crypto.randomUUID()` itself. The migration files stay frozen at 0001–0008. |
| **`youtube_quota_usage` keyed on `(date, consumer)`** | The migration shipped with a composite unique constraint anticipating `hot_path` vs. `corpus_cron` (Phase 2). The wrapper defaults to `hot_path` so today's usage tracks user-driven pipeline runs cleanly; cross-consumer totals can roll up in service-layer code later. |
| **No live trigger integration test** | `handle_new_user` and `sync_channel_count` exist and are wired, but exercising them requires synthesising an `auth.users` insert. The first real magic-link sign-in in Phase 1.4 is the natural integration test; verifying SQL syntax + function presence here is enough. |
| **30-day refresh-token TTL → `sessions_inactivity_timeout=2592000`** | Supabase exposes two session-lifetime knobs: absolute timebox and inactivity timeout. The task spec said "refresh-token TTL = 30 days." Inactivity timeout matches typical "remember me for 30 days" UX; absolute timebox is left at 0 (no hard cap). |

---

## Files created or modified

**Schema (committed in the scaffold checkpoint commit `f438fb2`)**
```
.mcp.json                                     Supabase MCP server registration
supabase/.gitignore, supabase/config.toml     Local dev config
supabase/migrations/0001..0008_*.sql          8 ordered migrations
```

**Clients & DB layer**
```
lib/supabase/server.ts        Server Component client (@supabase/ssr)
lib/supabase/middleware.ts    Returns {supabase, response} for cookie propagation
lib/supabase/service.ts       Service-role client, server-only
lib/db/types.ts               Generated from the linked schema
lib/db/profiles.ts            getProfile, updateProfile, setActiveChannel
lib/db/channels.ts            CRUD + Zod-parsed JSONB → camelCase Channel
lib/db/runs.ts                CRUD + soft-delete for pipeline_runs
lib/db/login-attempts.ts      recordLoginAttempt, recentSendsForEmail
lib/db/onboard-drafts.ts      createOnboardDraft (generates draft_id), get, delete
lib/db/youtube-quota.ts       getTodayUsage, incrementTodayUsage (per-consumer)
lib/db/youtube-cache.ts       getCachedPayload, setCachedPayload with TTL
lib/validation/channels.ts    TopVideoSchema, CompetitorSchema, CompetitorSetSchema
```

**Tooling**
```
package.json                  Added db:push and db:types scripts
```

**Documentation**
```
Documentation/Projects/Phases/Phase 1 — Foundation/
  Phase 1.2 — Supabase + schemas/summary.md       Post-phase deep dive
Documentation/Projects/Phase-1.2-Summary.md       This file
Documentation/Projects/Team-Update.md             Prepended Phase 1.2 entry
Documentation/Projects/Implementation-Plan.md     Marked 1.2 complete
CLAUDE.md                                          Added IPv6 gotcha note
```

---

## How to verify it works

From the project root, with `.env.local` populated:

```bash
# Type-check (will fail loudly if the generated types drift from the schema)
pnpm typecheck

# Linked-project sanity check (auth + IPv4 pooler routing)
supabase projects list                # the dev project should show ● in the LINKED column
supabase migration list --linked      # Local 0001..0008 should match Remote 0001..0008
```

**Verify the schema shape on the remote** (CLI v2.79+ supports `db query`):

```bash
supabase db query "
  select 'tables' as check, count(*)::text as result
    from pg_tables where schemaname='public'
  union all
  select 'channels_columns', count(*)::text
    from information_schema.columns
    where table_schema='public' and table_name='channels'
  union all
  select 'pipeline_runs_jsonb_cols', count(*)::text
    from information_schema.columns
    where table_schema='public' and table_name='pipeline_runs' and data_type='jsonb'
  union all
  select 'pipeline_run_status_enum', string_agg(enumlabel, ',' order by enumsortorder)
    from pg_enum e join pg_type t on e.enumtypid=t.oid
    where t.typname='pipeline_run_status'
" --linked
# Expected: tables=7, channels_columns=21, pipeline_runs_jsonb_cols=10,
#           enum=queued,running,gated_failed,complete,error
```

**Verify auth config:**

```bash
TOKEN=$(security find-generic-password -s "Supabase CLI" -w \
        | sed 's/^go-keyring-base64://' | base64 -d)
curl -s -H "Authorization: Bearer $TOKEN" \
     "https://api.supabase.com/v1/projects/cbfdafhugrthyeaquyta/config/auth" \
  | python3 -m json.tool \
  | grep -E "mailer_otp_exp|uri_allow_list|sessions_inactivity_timeout"
# Expected: mailer_otp_exp=900, sessions_inactivity_timeout=2592000,
#           uri_allow_list="http://localhost:3000/api/auth/callback"
```

**Verify the CRIT-1 / SEC-2 safety guarantees:**

```bash
# No service-role key leaked behind a NEXT_PUBLIC_ prefix:
grep -rE 'NEXT_PUBLIC_.*SERVICE' \
  --include="*.ts" --include="*.tsx" --include="*.json" --include="*.env*" . \
  | grep -v node_modules | grep -v .next
# Expected: no output.

# Service-role client is import-pinned to the server:
head -1 lib/supabase/service.ts
# Expected: import "server-only";
```

**Re-generate types after any future migration:**

```bash
pnpm db:push           # apply pending migrations to remote
pnpm db:types          # regenerate lib/db/types.ts from the linked schema
pnpm typecheck         # confirm wrappers still compile against the new types
```

---

## Issues encountered and how they were resolved

**`supabase db push` failed with `IPv6 is not supported on your current network`.** This is the gotcha that stopped the prior agent. The CLI's default direct DB endpoint resolves over IPv6, and this network has no IPv6 route. **Fix:** re-run `supabase link --project-ref cbfdafhugrthyeaquyta` (with no other args). The link command re-resolves the stored connection string and switches to the IPv4 session pooler (`aws-0-eu-west-1.pooler.supabase.com`). Documented in CLAUDE.md under External Services so future agents don't trip on the same thing.

**`supabase gen types typescript --linked` polluted the output with the CLI banner `"Initialising login role..."`.** The banner was printed to stdout, so redirecting `>` captured it as the first "line" of `lib/db/types.ts` and broke TypeScript parsing. **Fix:** pipe stderr to `/dev/null` *and* prefix the redirect carefully — encoded into the `db:types` npm script as `supabase gen types typescript --linked 2>/dev/null > lib/db/types.ts` so future regenerations stay clean.

**`onboard_drafts.draft_id` had no `default gen_random_uuid()` in the migration**, unlike every other UUID PK in the schema. `Database['public']['Tables']['onboard_drafts']['Insert']` therefore requires `draft_id`. **Fix:** `createOnboardDraft()` now calls `crypto.randomUUID()` itself rather than churning a `0009_*` migration. Documented as a deviation in the per-phase summary in case a third writer ever appears.

**Resend SMTP + branded email template deferred to Phase 1.4.** Task `1.2/task.md` listed both as Step 1 dashboard config. `RESEND_API_KEY` is still a placeholder in `.env.local`, and the magic-link email template will be implemented alongside the actual `/sign-in` flow. Magic-link emails in the dev project currently use Supabase's default sender and template — fine for development, never user-visible at this phase.

**Staging and production projects deferred.** `task.md` Step 1 said "Create dev/staging/prod projects." Per the session decision, only dev is provisioned for Phase 1.2. Same migrations and same auth config patch will spin them up cleanly when needed before launch.

**The "8 tables" verification line in `task.md` is off-by-one.** The bullet says "All 8 tables exist (verified by `\dt public.*`): profiles, channels, pipeline_runs, youtube_quota_usage, youtube_api_cache, onboard_drafts, login_attempts (plus auth.* managed by Supabase)" — that list is 7 user tables + the Supabase-managed `auth` schema. The implementation has 7 tables in `public` as listed, which is correct.
