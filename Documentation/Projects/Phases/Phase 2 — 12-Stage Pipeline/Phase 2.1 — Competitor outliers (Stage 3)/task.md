# Phase 2.1 — Competitor outliers (Stage 3)

**Parent:** Phase 2 — 12-Stage Pipeline
**Status:** Complete
**Estimated:** 8-12 hours
**Depends on:** Phase 1.3 (Anthropic + YouTube wrappers), Phase 1.5 (channels.competitor_set_json), Phase 1.6 (pipeline_runs)
**Spec:** `Documentation/Overviews and Summaries/04-competitor-outlier-analysis/spec.md`

## Goal

The vertical-slice proof of concept (Build-Order §2.1): drop an idea → orchestrator queues stage 3 → YouTube search per competitor → filter outliers (≥5× competitor's own median) → Opus delta extraction → SSE stream → persist to `pipeline_runs.competitor_data`. If anything's wrong in the architecture, it surfaces here.

## What to Build

### Step 1 — Data + schemas
- `lib/validation/competitor.ts`: `OutlierSchema` (videoId, title, channelTitle, channelHandle, viewCount, channelMedianViews, viewMultiple, publishedAt, deltaLabel, deltaReason, transferableLesson, isShort, recencyBoosted, triggerLabel from closed 8-value enum), `ExtractedPatternSchema` (pattern, evidence: videoId[], confidence), `CompetitorDataSchema = { schemaVersion: z.literal(1), outliers, extractedPatterns, noOutliers: boolean, generatedAt, costUnits }`.

### Step 2 — YouTube extensions
- Extend `lib/youtube/cached.ts`: `searchCompetitorOutliers(competitorChannelId, publishedAfter)` — `search.list` with `channelId`, `type=video`, `order=date`, `maxResults=25`, 1h TTL, 100 units. `getVideoDetails(videoIds[])` batched in 50s (1 unit), 6h TTL. `computeChannelMedian(channelId)` 24h cache from videos.list with 90-day fallback, shorts excluded.
- Recency-weighted projection for videos <72h old (view_multiple projected forward; flag `recencyBoosted: true`).

### Step 3 — Service + prompt (Opus 4.7 per CRIT-2)
- `lib/services/competitor.ts`: orchestration — load run + channel.competitor_set_json, for each competitor (up to 8) fetch+filter outliers (≥5× their median), aggregate top ~15 across competitors with diversity cap of 5 per channel, livestream VODs demoted, shorts excluded from median computation but kept in outlier set with `isShort: true`. Run quota soft-cap check (`>8000`) between every competitor fetch.
- `lib/prompts/competitor.ts`: Opus prompt with `cache_control` on system block ≥1024 tokens (CRIT-3). Attribution header `// Adapted from AgriciDaniel/claude-youtube (MIT) — sub-skills/competitor.md` (CRIT-4). Single batched LLM call across all outliers (lets model extract cross-cutting patterns; cost ~$0.10/run with cache warm).

### Step 4 — API + SSE
- `app/api/pipeline/competitor/route.ts`: POST `{runId}` → SSE. Per-competitor progress events (fetching, filtering, hydrating), then `complete` with CompetitorData. Calls `markStageStarted` → handler → `markStageComplete` (writes `competitor_data`). On no outliers found: persist `noOutliers: true` with empty arrays; downstream stages handle.
- Worst-case quota math: 8×100 (search) + 8×1 (videos.list batch) + per-competitor median fetches if uncached = ~808 units. Pre-check `>8000`.
- Error codes: NO_COMPETITORS (empty competitor_set), QUOTA_EXCEEDED, UPSTREAM_ERROR, STREAM_IN_PROGRESS (409 on concurrent run).
- 2 regenerate modes via same endpoint: `forceFresh` (bypass cache) vs default (re-extract only).

### Step 5 — UI integration
- Stage 3 card in `/runs/[runId]`: loading state shows per-competitor progress + skeleton tiles; main state shows 8-15 outlier tiles (thumbnail, title, channel avatar+name, viewMultiple, deltaLabel pill with trigger color, transferableLesson). Extracted patterns section below. Regenerate modal warns about quota cost.
- Empty: "No outliers ≥5× detected" with "Lower threshold to 3×" button DISABLED with tooltip (Phase 2 deferred).
- Cost indicator on regenerate: shows "~$0.10 Opus" (corrects mockup #04 State 5 which said "$0.04 Haiku" — needs UI update).

### Step 6 — Integration & testing
- E2E with mocked YouTube + Anthropic, fresh + cached calls.
- Quota soft-cap: stop fetching when cumulative units would exceed 8000 mid-run; persist partial result with `partialComplete: true` flag.
- Cache verification: 2nd call within 1h TTL hits cache (no quota increment).
- Prompt-cache verification: `cache_read_input_tokens > 0` on 2nd run within 5 min.
- Empty-set short-circuit, malformed JSON retry once, diversity cap, recency projection.
- CLAUDE.md Appendix B: add Stage 3 row to CRIT-2 table.

## Cross-feature contracts

- Reads `channels.competitor_set_json` (Phase 1.5) — uses each competitor's own median, NOT user's. The user's median is UI framing only.
- Reads `channels.niche` (Phase 1.5).
- Writes `pipeline_runs.competitor_data` (Phase 1.6) — consumed by Stage 4 (scoring), Stage 5 (titles via extractedPatterns), Stage 14 (hybrid scoring future).
- Status transitions managed by `pipeline-state.ts` helpers exclusively.

## Verification

- [ ] `OutlierSchema` rejects videoId not matching `/^[\w-]{11}$/`
- [ ] `lib/youtube/cached.ts` searchCompetitorOutliers 2nd call within 1h reads cache without quota increment
- [ ] Quota guard fires `QUOTA_EXCEEDED` when cumulative request would exceed 8000 BEFORE making the call
- [ ] Worst-case fresh run consumes ≤808 YouTube units (verified in test telemetry)
- [ ] Anthropic call has `cache_control: ephemeral` on system block ≥1024 tokens
- [ ] 2nd Anthropic call within 5min shows `cache_read_input_tokens > 0` in usage object
- [ ] Concurrent POST to same runId returns 409 STREAM_IN_PROGRESS
- [ ] When zero outliers ≥5×: response persists `noOutliers: true` and `outliers: []`, downstream Stage 4 still runs without error
- [ ] Diversity cap: no channel contributes >5 outliers
- [ ] Recency projection: video <72h old has `recencyBoosted: true` flag
- [ ] CLAUDE.md CRIT-2 table has Stage 3 row for `claude-opus-4-7`
- [ ] Attribution comment present in `lib/prompts/competitor.ts`

## Out of scope

- Lower-threshold "3×" regenerate (Phase 2 deferred)
- "Queue for midnight" (Phase 2 deferred)
- Hybrid scoring corpus integration (Feature #14)
- Cross-niche outlier discovery
