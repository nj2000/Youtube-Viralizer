# Team Update — YouTube Viralizer

Rolling changelog of what shipped, phase by phase. New entries are added at the top. For full detail on any phase, follow the link to `Phase-X.Y-Summary.md`.

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
