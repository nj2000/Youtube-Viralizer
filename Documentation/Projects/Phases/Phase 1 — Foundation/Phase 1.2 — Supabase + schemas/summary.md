# Phase 1.2 — Summary (post-implementation)

**Status:** Complete (dev environment; staging/prod deferred)
**Completed:** 2026-05-11
**Time spent:** ~1 session (continuation; prior agent stopped after schema files + deps)

## What was delivered

### Remote dev project
- Supabase project `Youtube Viralizer` (`cbfdafhugrthyeaquyta`, West EU / Ireland) created, linked to CLI, IPv4 pooler routing confirmed working.
- All 8 migrations applied; `supabase migration list --linked` shows local/remote parity 0001–0008.
- Auth config patched via Management API: `mailer_otp_exp=900` (15 min), `uri_allow_list=http://localhost:3000/api/auth/callback`, `sessions_inactivity_timeout=2592000` (30 days). Email-only provider was already the default (all `external_*_enabled=false` except email).

### Migrations (`supabase/migrations/0001-0008.sql`)
Authored by the prior agent; this session committed and applied them.
- `0001_extensions.sql` — `citext`, `pg_trgm`, `private` schema.
- `0002_profiles.sql` — `profiles(id, active_channel_id, channel_count_cache, …)` + 2 RLS policies + shared `set_updated_at()` function.
- `0003_channels.sql` — 21-column `channels` table, partial unique index on `(user_id, youtube_channel_id) WHERE deleted_at IS NULL`, 4 RLS policies, `private.sync_channel_count()` security-definer trigger, FK `profiles.active_channel_id → channels.id`.
- `0004_profiles_trigger.sql` — `handle_new_user()` security-definer + `on_auth_user_created` trigger on `auth.users`.
- `0005_pipeline_runs.sql` — `pipeline_run_status` enum (queued, running, gated_failed, complete, error), 10 JSONB stage columns + 10 `stale_*` booleans, `idea_text CHECK (10..500)`, `pg_trgm` GIN partial index, 3 RLS policies (no DELETE — soft-delete only).
- `0006_youtube_quota_and_cache.sql` — `youtube_quota_usage` with `(date, consumer)` composite unique + `youtube_api_cache(cache_key PK)`. RLS enabled, zero policies → service-role only.
- `0007_onboard_drafts.sql` — `onboard_drafts(draft_id PK, …, expires_at default now()+10min)`. Service-role only.
- `0008_login_attempts.sql` — `login_attempts(id, email citext, outcome, attempted_at, …)`. Service-role only.

### Client factories (`lib/supabase/`)
- `server.ts` — `createSupabaseServerClient()` using `@supabase/ssr` + `next/headers` cookies. `setAll()` wrapped in try/catch so calls from Server Components (which can't mutate cookies) don't throw.
- `middleware.ts` — `createSupabaseMiddlewareClient(req)` returns **`{ supabase, response }`** so the caller propagates rotated cookies on both request and response.
- `service.ts` — service-role client with `import "server-only"`. `persistSession=false` / `autoRefreshToken=false` since each call is one-shot.

### Typed DB layer (`lib/db/`)
- `types.ts` — generated via `supabase gen types typescript --linked` (stderr filtered). Covers `channels`, `login_attempts`, `onboard_drafts`, `pipeline_runs`, `profiles`, `youtube_api_cache`, `youtube_quota_usage` plus `graphql_public`.
- 7 thin CRUD wrappers (`profiles.ts`, `channels.ts`, `runs.ts`, `login-attempts.ts`, `onboard-drafts.ts`, `youtube-quota.ts`, `youtube-cache.ts`) — each takes an injected `SupabaseClient<Database>` so the caller chooses session vs. service-role auth.
- `channels.ts` parses `top_videos_json` and `competitor_set_json` through Zod on read (snake_case JSONB stays out of the rest of the codebase; everything else surfaces as camelCase `Channel.topVideos` / `Channel.competitorSet`).

### Validation (`lib/validation/`)
- `channels.ts` — `TopVideoSchema`, `CompetitorSchema`, `CompetitorSetSchema` (max 20 items). Stage-payload Zod (score, script, etc.) deferred to the phases that write those columns.

### Tooling
- `package.json` scripts: `db:push` (`supabase db push`) and `db:types` (`supabase gen types typescript --linked 2>/dev/null > lib/db/types.ts`). Stderr suppressed because the CLI banner `"Initialising login role..."` was contaminating the types file.
- `.mcp.json` registers the Supabase HTTP MCP (`https://mcp.supabase.com/mcp`). Not authenticated this session — Management API + CLI covered everything needed, so the MCP OAuth handshake was avoided.

## Verification results

| # | Check | Result |
|---|---|---|
| 1 | Migrations 0001–0008 apply cleanly; `supabase migration list --linked` shows local↔remote parity | ✅ |
| 2 | All 7 user tables exist in `public` (`pg_tables`) | ✅ (task.md said "8" but the list itself is 7 + `auth.*`) |
| 3 | `channels` has 21 columns | ✅ |
| 4 | `pipeline_runs` has 10 JSONB stage columns and 10 `stale_*` booleans | ✅ |
| 5 | `pipeline_run_status` enum has 5 values: `queued, running, gated_failed, complete, error` | ✅ |
| 6 | RLS enabled on all 7 user tables | ✅ |
| 7 | `channels` policies: 4 (select/insert/update/delete own); `pipeline_runs`: 3 (no DELETE policy); `profiles`: 2; service-role-only tables: 0 | ✅ |
| 8 | `channels_user_youtube_unique` index has `WHERE deleted_at IS NULL` clause | ✅ |
| 9 | `pipeline_runs.idea_text` CHECK constraint enforces `char_length 10..500` | ✅ |
| 10 | `pg_trgm` GIN index `pipeline_runs_idea_text_trgm` on `idea_text` | ✅ |
| 11 | `handle_new_user` + `sync_channel_count` functions exist; `on_auth_user_created` + `channels_sync_count` triggers exist | ✅ (live trigger behaviour will be exercised in Phase 1.4 magic-link sign-in) |
| 12 | `lib/supabase/middleware.ts` returns `{ supabase, response }` (typed) | ✅ |
| 13 | `lib/supabase/service.ts` has `import "server-only"` at top | ✅ |
| 14 | `grep -rE 'NEXT_PUBLIC_.*SERVICE' .` returns nothing | ✅ |
| 15 | `lib/db/types.ts` covers all user tables | ✅ |
| 16 | `pnpm typecheck` clean | ✅ |
| 17 | Auth config patched: `mailer_otp_exp=900`, `sessions_inactivity_timeout=2592000`, `uri_allow_list=…/api/auth/callback` | ✅ (verified via `GET /v1/projects/{ref}/config/auth`) |

## Deviations from `task.md`

1. **Dev only — staging/prod deferred.** Task said "Create dev/staging/prod projects." Per session decision, only the dev project is provisioned for now. Same migration files will spin up staging/prod cleanly when needed.
2. **Resend SMTP + branded email template deferred to Phase 1.4.** `RESEND_API_KEY` is still a placeholder in `.env.local`. Until then, magic-link emails will use Supabase's default sender + template. Phase 1.4 task already owns this.
3. **`onboard_drafts.draft_id` has no DB default.** Other UUID PKs use `default gen_random_uuid()`; this one doesn't, so `createOnboardDraft()` calls `crypto.randomUUID()` itself. Not worth a `0009_*` migration just to add the default — wrapper generation is fine. Worth flagging if a third writer ever appears.
4. **`youtube_quota_usage` is keyed by `(date, consumer)`, not just `date`.** The composite unique was already in the migration (consumer = `'hot_path' | 'corpus_cron'`). `getTodayUsage` / `incrementTodayUsage` default to `hot_path`; total daily usage across consumers will be a service-layer concern in Phase 1.3 when CRIT-1 enforcement lands.
5. **JSONB content stored as camelCase, not snake_case.** API-1 (snake_case in DB, camelCase in TS) governs *column names*; the migration column names are snake_case. JSONB *payload shape* is purely application data — keeping it camelCase eliminates a transform layer and keeps Zod schemas readable. The boundary is still respected: `topVideos: TopVideo[]` is the contract; `top_videos_json` is the storage detail.

## IPv6 gotcha (root cause of the prior agent getting stuck)
The first `supabase db push --dry-run` failed: `IPv6 is not supported on your current network: dial tcp [2a05:…]:5432: connect: no route to host`. Re-running `supabase link --project-ref cbfdafhugrthyeaquyta` switched the stored connection string to the IPv4 session pooler. Worth noting in CLAUDE.md or a follow-up if other agents trip on it.

## Out-of-scope items deferred

- No `app/middleware.ts` at root (Phase 1.4 owns this).
- No API route handlers — Phase 1.4+.
- No service-layer logic — Phase 1.3+.
- No staging/prod Supabase projects.
- No Resend SMTP or branded email template (Phase 1.4).
- No background cleanup crons for expired `onboard_drafts` / old `login_attempts` (Phase 2).
- No stage-payload Zod schemas for `pipeline_runs.*_data` JSONB columns (each phase writes its own when it lands).

## Follow-ups for next phase

- Phase 1.3 (Anthropic + YouTube wrappers) will import `lib/db/youtube-quota.ts` + `youtube-cache.ts` for CRIT-1 enforcement and consume the service-role client from `lib/supabase/service.ts`.
- Phase 1.4 (magic-link auth) will add `app/middleware.ts` that calls `createSupabaseMiddlewareClient()` for every request, plus the `/sign-in` and `/api/auth/callback` routes. It will also configure Resend SMTP and upload the branded magic-link email template — both deferred from this phase.
- The `handle_new_user` trigger has not been exercised against a real `auth.users` insert yet. The first real magic-link sign-in in Phase 1.4 is the integration test.

## Files changed/added

```
.mcp.json                                                  (committed in scaffold checkpoint)
package.json                                               (db:push, db:types scripts)
supabase/.gitignore                                        (committed in scaffold checkpoint)
supabase/config.toml                                       (committed in scaffold checkpoint)
supabase/migrations/0001..0008_*.sql                       (committed in scaffold checkpoint; applied to remote)
lib/db/types.ts                                            (new — generated)
lib/db/profiles.ts                                         (new)
lib/db/channels.ts                                         (new)
lib/db/runs.ts                                             (new)
lib/db/login-attempts.ts                                   (new)
lib/db/onboard-drafts.ts                                   (new)
lib/db/youtube-quota.ts                                    (new)
lib/db/youtube-cache.ts                                    (new)
lib/supabase/server.ts                                     (new)
lib/supabase/middleware.ts                                 (new)
lib/supabase/service.ts                                    (new)
lib/validation/channels.ts                                 (new)
Documentation/Projects/Phases/Phase 1.2/summary.md         (this file)
```
