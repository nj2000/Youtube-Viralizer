# Phase 1.5 — Channel Onboarding

**Status:** Complete
**Date:** 2026-05-14
**Branch:** `main`
**Detail:** See `Phases/Phase 1 — Foundation/Phase 1.5 — Channel onboarding/summary.md` for the full per-file breakdown and verification log.

---

## What was built

End-to-end channel onboarding: the user pastes a YouTube URL, the app fetches metadata + the last 50 videos, computes the channel's median view count, asks Sonnet 4.6 for a niche label and a top-8 competitor set, and shows a review screen where the user edits before saving. Multi-channel support up to 3 channels with a header switcher, active-channel persistence, soft-delete with cascade, and a 1-hour per-channel re-detect throttle.

- **`POST /api/onboard`** streams six SSE progress events (`validating` → `fetching_channel` → `fetching_videos` → `computing_median` → `extracting_niche` → `identifying_competitors`) before emitting `complete` with the `ChannelDraft` payload. EXT-2 quota pre-check (`assertHeadroom(600)`) fires *before* the stream opens, so a 429 returns as JSON, not as a closed stream.
- **`POST /api/onboard/confirm`** persists the draft. Re-confirming the same channel UPDATEs in place (not a duplicate insert); user-edited niches are preserved across re-confirms; manual competitors survive auto re-detection; the 3-channel limit is enforced both pre-stream and at confirm; the first channel auto-sets `profiles.active_channel_id`.
- **`POST /api/competitors/redetect`** with `channelId` is throttled to one call per hour per channel via `channels.last_competitor_redetect_at`, returning 429 + `Retry-After`. The (niche, country) cache hits return without burning quota for 6 hours.
- **`GET /api/channels` / `DELETE /api/channels/[id]` / `POST /api/profile/active-channel` / `GET /api/channels/[id]/run-count`** complete the multi-channel surface. Cross-user requests return 404 (not 403) to avoid existence probes. Delete cascade-soft-deletes all `pipeline_runs` for the channel and returns the affected count.
- **`/onboard` → `/onboard/processing` → `/onboard/review` → `/runs/new`** is the user-facing flow. Processing screen is the first real consumer of `lib/streaming/sse.ts` + `lib/hooks/useStageStream.ts` — the SSE pattern that Phase 1.3 built is now exercised live.
- **`ChannelSwitcher` in the `(app)` header** (sourced from a new `ChannelContextProvider`) gives every authenticated route the active-channel UX with optimistic updates and rollback on failure.

### Tests

22 new Vitest specs land in this phase, bringing the suite to **58 specs total** in ~320ms. Coverage is pure-function-focused: tightened `videoId` / max-50 / UC… regex (9 specs in `tests/validation/channels.test.ts`), `computeMedianViews` edge cases including empty / low-cadence / even-vs-odd / unsorted (5 specs in `tests/youtube/median.test.ts`), `mergeCompetitors` semantics including manual preservation and the 20-cap (5 specs in `tests/services/onboard.test.ts`), and the validator's new acceptance of `m.youtube.com` + explicit rejection of `javascript:` / `data:` URIs (3 new specs in `tests/youtube/validate.test.ts`). SSE / route / live-Anthropic verification stays manual — the integration tests deferred from Phase 1.3 light up the first time onboarding runs end-to-end against a configured Supabase + Anthropic project.

---

## Key implementation decisions

| Decision | Why |
|---|---|
| **Sonnet 4.6 enters via `lib/anthropic/onboarding.ts#callSonnet`, not by extending `callClaude`'s `Stage` enum** | The `Stage` union is the pipeline DAG's source of truth (`stageDependencies`, `stageColumn`, the 92-point gate). Adding `"niche"` / `"competitorIdent"` would force null entries in those maps and bleed onboarding semantics into pipeline code. `callSonnet` is ~25 lines and reuses `buildSystem` (CRIT-3 cache_control) + `withRetry` (EXT-3 backoff) verbatim. CLAUDE.md's CRIT-2 table now names the call site explicitly. |
| **Tightened `lib/validation/channels.ts` in place rather than forking** | Phase 1.3's tests use 11-char video IDs (`dQw4w9WgXcQ`) that already satisfy the new regex, so no breakage. Forking into `channel.ts` (strict) + `channels.ts` (loose) would create drift and let a stage-3 outlier with a bad-shape videoId slip through the looser schema. One source of truth. |
| **`mergeCompetitors` lives in `lib/services/onboard-merge.ts` (a separate file)** | Vitest runs in Node and our `lib/anthropic/client.ts` validates env at module load. Importing the merge function from `lib/services/onboard.ts` would pull the Anthropic client into the test process and fail env validation. Splitting the pure function into a zero-dep module is the cheapest fix; `onboard.ts` re-exports it for call-site ergonomics. |
| **`competitor.medianViews` stays `null` in Phase 1.5** | Spec describes a step-5d "compute medians for top-20 candidates" pass costing ~20 fresh units. We skip it: (a) keeps the fresh-onboard envelope at ~501u, comfortably under the verification's ≤520u cap; (b) Phase 2 stage 3 (outlier detection) needs candidate medians anyway and will hydrate them on demand from the uploads playlists. Premature work otherwise. |
| **Draft-mode re-detect throttle skipped** | Per-channel throttle (the durable case after confirm) ships via `channels.last_competitor_redetect_at`. Draft-mode "1 per user per hour" would need either Redis or a new `onboard_redetect_attempts` table — neither in this phase's scope. The 6h (niche, country) cache and the EXT-2 daily cap are the safety nets during drafting. Documented in the per-phase summary. |
| **`onboard_drafts` read on `/onboard/review` uses the service-role client** | The table has RLS denying user access (service-role-only by design — it's an ephemeral cache, not user-facing data). The review page passes `user_id` through Zod-validated `ChannelDraftSchema.parse` after loading via service-role + checking `draftRow.user_id === user.id` server-side. Cleaner than opening up RLS for an ephemeral table. |
| **`AddCompetitorInput` writes `MANUAL_<handle>` as `youtubeChannelId` when the user pastes a handle URL** | Resolving handle → UC… on every keystroke would burn `channels.list` units (1u each). Resolving on confirm would block the Confirm button on a YouTube round-trip. Phase 1.5's compromise: accept the manual entry as a placeholder, document the limitation in the component, and let Phase 2 hydrate real channel data when the manual competitor's outliers are first searched. |
| **`/onboard` redirects to `/runs?toast=channel-limit` when the user is already at 3 channels** | Per spec §4.1. The `/runs` toast won't render until Phase 1.6 ships, but the redirect contract is in place so 1.6 just needs to render the toast when the query param is present. |
| **Vitest specs for pure functions only** | SSE + route + LLM integration testing needs running infra (Supabase + Anthropic) disproportionate to the per-check value. Pure functions (`computeMedianViews`, `mergeCompetitors`, regex schemas) are cheap to test and catch the kind of regression that would silently break onboarding (e.g. someone reverts the 50-cap). |

---

## Files created or modified

**Validation + types** (`lib/validation/`)
```
channels.ts                            Tightened: videoId /^[\w-]{11}$/, max-50, UC regex on Competitor; +NicheSchema
onboard.ts                             NEW — OnboardRequest, ChannelDraft, ChannelDraftFlags, ConfirmRequest, RedetectRequest, SetActiveChannel
```

**DB helpers** (`lib/db/`)
```
channels.ts                            +countActiveChannels, +findChannelByYoutubeId, +countActiveRunsForChannel, +softDeletePipelineRunsForChannel
```

**YouTube wrappers** (`lib/youtube/`)
```
validate.ts                            +m.youtube.com host; parseChannelUrl alias
cached.ts                              +playlist_items_list endpoint (6h TTL, 1u) + getPlaylistItems
median.ts                              NEW — computeMedianViews (pure)
onboard.ts                             NEW — resolveToChannelId, fetchChannelMetadata, fetchLast50Videos, hydrateCompetitorMetadata
```

**Anthropic + prompts** (`lib/anthropic/`, `lib/prompts/`)
```
anthropic/onboarding.ts                NEW — callSonnet + extractTextFromMessage
anthropic/index.ts                     Re-export callSonnet + extractTextFromMessage + CallSonnetInput
prompts/onboard-niche.ts               NEW — Sonnet system prompt + buildUserPrompt (CRIT-4 attribution)
prompts/onboard-competitors.ts         NEW — query-gen + ranker system prompts + buildUserPrompts (CRIT-4 attribution)
```

**Services** (`lib/services/`)
```
onboard.ts                             NEW — runOnboard + confirmOnboard + ChannelLimitReachedError / DraftExpiredError
onboard-merge.ts                       NEW — mergeCompetitors (pure, zero deps; testable)
competitors.ts                         NEW — identifyCompetitors 5-step w/ (niche, country) cache
```

**API routes** (`app/api/`)
```
onboard/route.ts                       NEW — POST SSE; CSRF + quota pre-check + structured error mapping
onboard/confirm/route.ts               NEW — POST confirm + draft expiry + 3-channel limit
competitors/redetect/route.ts          NEW — POST redetect + per-channel throttle (1/hr)
channels/route.ts                      NEW — GET list with active flag + limit metadata
channels/[channelId]/route.ts          NEW — DELETE soft-cascade + reassign active
channels/[channelId]/run-count/route.ts  NEW — GET for delete-modal pre-flight
profile/active-channel/route.ts        NEW — POST set active
```

**UI** (`app/(app)/`)
```
layout.tsx                             Wrap children in ChannelContextProvider + add ChannelSwitcher to header
_components/ChannelContextProvider.tsx  NEW — client context with optimistic setActive
_components/ChannelSwitcher.tsx        NEW — header dropdown matching mockup state 6
_components/DeleteChannelModal.tsx     NEW — two-step delete with run-count pre-flight
onboard/page.tsx                       NEW — server entry; redirects on 3-channel limit
onboard/OnboardForm.tsx                NEW — client URL form with error-banner from ?error= query
onboard/processing/page.tsx            NEW — server passthrough
onboard/processing/ProcessingClient.tsx  NEW — useStageStream consumer with 5-step state list
onboard/review/page.tsx                NEW — server: loads draft via service-role + Zod-parses
onboard/review/ReviewClient.tsx        NEW — editable niche + competitors + acknowledgement gate
onboard/review/CompetitorList.tsx      NEW — remove buttons + manual/auto badge
onboard/review/AddCompetitorInput.tsx  NEW — manual add with parseChannelUrl validation
```

**Tests** (`tests/`)
```
youtube/validate.test.ts               +3 specs (m.youtube.com, javascript:, data:)
youtube/median.test.ts                 NEW — 5 specs (median edge cases)
services/onboard.test.ts               NEW — 5 specs (mergeCompetitors)
validation/channels.test.ts            NEW — 9 specs (videoId regex, max-50 cap, UC regex)
```

**Docs**
```
CLAUDE.md                                                  CRIT-2 +Sonnet 4.6 onboarding row; stack +Sonnet 4.6; API-2 +7 error codes
ATTRIBUTIONS.md                                            Names sub-skills/ideate.md as adaptation source
Documentation/Projects/Phase-1.5-Summary.md                This file
Documentation/Projects/Team-Update.md                      Prepended Phase 1.5 entry
Documentation/Projects/Implementation-Plan.md              Marked 1.5 complete
Documentation/Projects/Phases/.../Phase 1.5 .../summary.md  Per-phase deep dive
```

---

## How to verify it works

From the project root, with `.env.local` populated:

```bash
pnpm install
pnpm typecheck     # tsc --noEmit — clean
pnpm lint          # ESLint — 0 warnings, 0 errors
pnpm test          # Vitest — 58 specs in ~320ms
pnpm build         # next build — 17 routes registered, middleware compiled
```

Build output now shows the 7 new API routes (`/api/onboard`, `/api/onboard/confirm`, `/api/competitors/redetect`, `/api/channels`, `/api/channels/[channelId]`, `/api/channels/[channelId]/run-count`, `/api/profile/active-channel`) and the 3 onboard pages (`/onboard`, `/onboard/processing`, `/onboard/review`).

**Eyeball the UI** (auth required):

```bash
pnpm dev   # http://localhost:3000
```

Sign in, then visit `/onboard`. Pasting any of the following should hit the form validator client-side and then the SSE pipeline server-side:
- `youtube.com/@mkbhd` — handle path
- `https://youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ` — direct ID
- `https://youtu.be/dQw4w9WgXcQ` — short link (resolves via `videos.list`)
- `https://m.youtube.com/@mkbhd` — mobile host now accepted

The processing screen ticks through the 5 steps live; on completion it routes to `/onboard/review` with a draft id. Editing the niche, removing a competitor, adding one back via URL, and clicking "Confirm and continue" should land at `/runs/new` (404 until Phase 1.6).

**Confirm the channel switcher and delete flow** by onboarding two channels in sequence and switching between them via the header dropdown.

**End-to-end live verification** of the Sonnet niche extraction and competitor identification needs `ANTHROPIC_API_KEY` and `YOUTUBE_API_KEY` populated in `.env.local`, plus the Supabase project from Phase 1.2 linked. The CRIT-3 cache hit (`cache_read_input_tokens > 0`) should appear on the second onboarding within the 7-day niche cache window.

---

## Issues encountered and how they were resolved

**Vitest tripped on env validation when importing `mergeCompetitors`.** The first run of the new `tests/services/onboard.test.ts` failed at module load because `lib/services/onboard.ts` transitively imports `lib/anthropic/client.ts`, which instantiates `new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })` at the top level — and Vitest doesn't get `.env.local`. **Fix:** split the pure function into `lib/services/onboard-merge.ts` (zero deps), update the test import, and re-export from `lib/services/onboard.ts` so production call sites are unchanged. This is the same shape as the `parseSSEEvent` carve-out from Phase 1.3 — the test-import-without-env-load problem recurs whenever a service file pulls in a SDK client. Documented in the deviations section.

**`stableJson` deterministic cache key needed extending for a new endpoint.** Adding `playlist_items_list` to `cached.ts` required adding it to both the `TTL_SECONDS` and `UNITS` records. The existing `Endpoint = keyof typeof UNITS` type catches typos at compile time, so a single missed entry would have failed `tsc`. No bug; documented the new endpoint in the per-phase summary.

**`niche_source` UPDATE preservation logic.** First draft of `confirmOnboard` always set `niche_source: input.niche !== draft.niche ? "user_edited" : "auto"`, which would clobber a previously-user-edited niche back to `auto` if the user re-confirmed without typing in the textarea. **Fix:** detect that case explicitly (`existing.niche_source === "user_edited" && !userEditedNiche`) and preserve both the niche string and the source. Verification item 11 covers this.

**`AddCompetitorInput` manual-handle ID limitation surfaced during build.** Handles can't be turned into UC… IDs without a YouTube call, but the manual-add UX shouldn't block on a network round-trip per keystroke. **Fix:** accept a `MANUAL_<handle>` placeholder for non-UC URLs, surface the limitation in a small helper-text warning, and defer hydration to Phase 2 stage 3 outlier search. The component carries a comment to that effect.

**Vitest's `vite-tsconfig-paths` warning re-appeared.** Same noise as Phase 1.3: "the plugin is detected — Vite now supports tsconfig paths resolution natively." Switching to `resolve.tsconfigPaths: true` didn't resolve the `@/*` alias in our setup last time and still doesn't this time. Plugin stays. Cosmetic only.
