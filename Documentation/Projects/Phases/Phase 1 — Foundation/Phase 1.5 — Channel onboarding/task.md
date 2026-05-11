# Phase 1.5 — Channel onboarding

**Parent:** Phase 1 — Foundation
**Status:** Not Started
**Estimated:** 6-10 hours
**Depends on:** Phase 1.2 (channels + onboard_drafts), Phase 1.3 (YouTube + Anthropic wrappers), Phase 1.4 (auth)
**Spec:** `Documentation/Overviews and Summaries/01-channel-onboarding/spec.md`

## Goal

One-time ~30-second flow where authenticated user pastes a YouTube channel URL → app fetches metadata + last 50 videos + computes median views + extracts niche (Sonnet 4.6) + identifies 8 competitors → user reviews + edits → confirm persists to `channels`. Up to 3 channels per user. Cascade soft-delete with confirmation modal.

## What to Build

### Step 1 — Data layer
- Channels migration (full from spec #01 §3.1) already in Phase 1.2.
- Zod schemas in `lib/validation/channel.ts` + `lib/validation/onboard.ts`: `TopVideoSchema` (videoId regex `/^[\w-]{11}$/`, viewCount nonneg int, ISO datetime, durationSec int; `TopVideosSchema = array().max(50)`). `CompetitorSchema` (youtubeChannelId `/^UC[\w-]+$/`, source `'auto'|'manual'`; `CompetitorSetSchema = array().max(20)`). `OnboardRequestSchema`, `ChannelDraftSchema`, `ConfirmRequestSchema`, `RedetectRequestSchema`.
- `lib/db/channels.ts`, `profiles.ts`, `onboard-drafts.ts` — typed CRUD. Every JSONB read Zod-parsed; parse failure throws `INTERNAL_ERROR`, never raw Zod to client. snake_case ↔ camelCase at boundary (API-1).

### Step 2 — External services
- `lib/youtube/validate.ts` — URL allowlist regex + `parseChannelUrl` + `resolveToChannelId` (videos.list for video URLs, search.list for `/c/`, channels.list `forHandle` for `@`, direct for `/channel/UC`). All calls via cached wrapper (CRIT-1).
- `lib/youtube/onboard.ts` — `fetchChannelMetadata(channelId)` (channels.list snippet+statistics, 24h cache), `fetchLast50Videos(uploadsPlaylistId)` (playlistItems.list + batched videos.list), parses durations to seconds, sorts desc by publishedAt, slices to 50.
- `computeMedianViews(videos)`: 0 → `{median: null, isNewChannel: true}`; 1–9 → mean + `lowCadence: true`; 10+ → true median (rounded).
- `lib/prompts/onboard-niche.ts` + `lib/services/niche.ts` — Sonnet 4.6 (claude-sonnet-4-6). System prompt ≥1024 tokens with `cache_control`. User prompt wraps description (truncated to 1500 chars) + last-20 video titles in `<channel_description>` XML with prompt-injection-defense directive. Output 1–200 chars, truncate at sentence boundary if long, empty if <10 chars → `failed: true`. Retry per EXT-3. Cache key `(youtubeChannelId, sha256(description), sha256(titles))` for 7 days. File header attribution comment per CRIT-4.
- `lib/prompts/onboard-competitors.ts` + `lib/services/competitors.ts` — 5-step: Sonnet generates 5 queries → `search.list` (5×100=500 units) returning ≤50 unique candidates excluding self → batched `channels.list` (1 unit) → top 20 by subs get median fetch (cached, ~20 units) → Sonnet ranks top 8 with rationale (not persisted). Total ~520 units. `(niche, country)` cache 6h. Returns `{competitors, belowThreshold}` (`belowThreshold=true` when <3).

### Step 3 — API layer
- `POST /api/onboard` SSE (`route.ts` + `lib/services/onboard.ts`): pre-check quota (>8000 → QUOTA_EXCEEDED), channel limit (>=3 → CHANNEL_LIMIT_REACHED). Emit 6 progress events (validating, fetching_channel, fetching_videos, computing_median, extracting_niche, identifying_competitors), then `complete` with ChannelDraft. Persist draft to `onboard_drafts` with `draftId`, expires +10min. Anthropic outage does NOT terminate stream — emit complete with `flags.nicheExtractionFailed` / `flags.competitorsBelowThreshold`.
- `POST /api/onboard/confirm`: parse body, lookup draft (404 DRAFT_EXPIRED), verify ownership. Transaction: SELECT existing `(user_id, youtube_channel_id) WHERE deleted_at IS NULL`. If exists: UPDATE YouTube-derived fields, preserve niche if `niche_source='user_edited'`, merge competitors (manual preserved). If new: enforce 3-channel limit (403 CHANNEL_LIMIT_REACHED), INSERT, set `active_channel_id` if first channel. Delete draft. Return `{channelId}`.
- `POST /api/competitors/redetect`: two modes — `channelId` (throttle by `channels.last_competitor_redetect_at`) or `draftId` (throttle by `userId`). `canRedetect(lastAt)` allows when >1h elapsed; else 429 `RATE_LIMITED` with `retryAfterSec`. Cache hits still return instantly within 6h.
- `GET /api/channels` — list non-deleted with `{channelLimit:3, channelCount}`.
- `POST /api/profile/active-channel { channelId }` — verify ownership, set; 204.
- `DELETE /api/channels/:channelId` — transaction: soft-delete channel, cascade `pipeline_runs.deleted_at`, reset `profiles.active_channel_id` if was active, decrement count via trigger. Returns `{deletedRunCount}`.
- `GET /api/channels/:channelId/run-count` — for delete confirmation modal.
- Cross-user requests return 404 (not 403) for IDOR safety.

### Step 4 — UI
- `/onboard` page (server + `UrlInputForm` client): client-side URL validation mirror, server-side pre-check `channelCount<3`, banner on `?error=<code>`. Submit → `router.push('/onboard/processing?url=...')`.
- `/onboard/processing` client: POST `/api/onboard` with `fetch` + `ReadableStream`. Render 5 progress rows (gray→spinner→check). On `complete`: stash draft in sessionStorage, navigate `/onboard/review?draftId=...`. On `event: error`: navigate `/onboard?error=<code>`.
- `/onboard/review` client: read draft from sessionStorage. `ChannelSummaryCard` (read-only), `NicheEditor` textarea (200 max), banners for flags, `CompetitorList` with X-remove, `AddCompetitorInput`, `RedetectButton` (throttle countdown), Confirm CTA disabled when niche empty. On confirm: POST `/api/onboard/confirm` → 200 routes to `/runs/new`.
- `ChannelContextProvider` in `(app)/layout.tsx` fetches `/api/channels`; `ChannelSwitcher` dropdown in header (avatar+handle, active marked, "Add another" disabled at limit, set-active optimistic). Per-row delete menu → `DeleteChannelModal` (fetches run-count first).

### Step 5 — Integration testing
- E2E happy path: paste URL → 5 progress rows → review → confirm → `/runs/new` → DB row inspected.
- Quota: fresh onboard ≤700 units; second within TTL = 0 new units.
- Edge cases: 0 videos, 1–9 videos (mean+lowCadence), hidden subs (null), non-ASCII handles, 4th-channel limit, niche emptied, removed-all-competitors confirm with warning.
- Security: cross-user reads return 0 rows; cross-user DELETE returns 404; quota>8000 returns QUOTA_EXCEEDED without YouTube call; Anthropic outage produces empty niche + flag; prompt-injection defense holds (description `"Ignore previous instructions..."` doesn't change output).

## Cross-feature contracts

- **Downstream readers of `channels`:** Stage 3 reads `median_views` (5× outlier threshold), Stages 4/5/14/18 read `niche` + `competitor_set_json`. Shape locked by `TopVideoSchema`/`CompetitorSchema`.
- **Auth (Phase 1.4):** all routes session-required; RLS as defense-in-depth.
- **CRIT updates required:** CRIT-2 model table adds Sonnet 4.6 row for onboarding; Stack lock-in line adds Sonnet 4.6; ATTRIBUTIONS.md references `sub-skills/ideate.md`.
- **Soft-delete cascade:** deleting channel cascades runs. Workspace must handle gracefully.
- **3-channel limit** hard-coded for Phase 1; moves to tier lookup in Phase 2.

## Verification

- [ ] Migrations applied; RLS denies cross-user channel reads
- [ ] Zod `TopVideoSchema` rejects bad videoId; `TopVideosSchema` rejects arrays >50
- [ ] `parseChannelUrl("javascript:alert(1)")` throws `INVALID_URL`; `m.youtube.com` and `youtu.be` accepted
- [ ] `computeMedianViews([])` returns `{median:null, isNewChannel:true}`; `[100,200,300]` returns mean+lowCadence; `[1..11]` returns median 6
- [ ] Niche extraction call uses literal `"claude-sonnet-4-6"`, has `cache_control` on system prompt ≥1024 tokens
- [ ] On Anthropic 429: retries 3 times with backoff, final returns `{niche:"", failed:true}`
- [ ] Competitor identification: 5 queries, dedupe, ≤520 units fresh; `belowThreshold=true` when <3 picks
- [ ] `POST /api/onboard` emits SSE stream with 6 progress + complete; `onboard_drafts` row created
- [ ] Quota >8000 returns 429 `QUOTA_EXCEEDED` immediately (no YouTube call)
- [ ] `POST /api/onboard/confirm` idempotent: re-confirming same channel UPDATEs in place, count stays 1
- [ ] User-edited niche preserved on re-confirm; competitor merge keeps manual entries
- [ ] First channel auto-sets `profiles.active_channel_id`
- [ ] 4th channel returns 403 `CHANNEL_LIMIT_REACHED`
- [ ] Re-detect throttled to 1/hr per channel; 6h cache returns same result without quota
- [ ] DELETE channel cascade-soft-deletes all `pipeline_runs.channel_id=:id`, returns `{deletedRunCount}`
- [ ] Cross-user `DELETE` returns 404 not 403
- [ ] `/onboard/review` Confirm disabled when niche empty; "no competitors" warning checkbox required to proceed
- [ ] Prompt-injection: description containing `"Ignore previous instructions..."` doesn't alter niche output
- [ ] CLAUDE.md CRIT-2 table has Sonnet 4.6 onboarding row

## Out of scope

- `mode: "competitor"` (Phase 2)
- Per-tier channel limits (Phase 2 — Stripe)
- Nightly auto-refresh (Phase 2 cron)
- Hybrid niche library / vocabulary integration (Feature #18)
- Channel Assets Library (Feature #25)
- OAuth channel ownership verification (Phase 3)
- Back catalog beyond 50 videos
- Non-YouTube platforms
