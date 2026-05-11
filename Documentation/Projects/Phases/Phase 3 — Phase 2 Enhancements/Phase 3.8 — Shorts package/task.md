# Phase 3.8 — Shorts production package

**Parent:** Phase 3 — Phase 2 Enhancements
**Status:** Not Started
**Estimated:** 8-12 hours
**Depends on:** Phase 1.5 (channels)
**Spec:** `Documentation/Overviews and Summaries/21-shorts-production-package/spec.md`

## Goal

Separate single-shot pipeline (NOT staged like long-form). Opus 4.7 generates everything in one joint-context call: script with [CUT] markers every 1-3s, cold-open ≤2s, loop setup at last 1-2s, 9:16 vertical thumbnail brief, Shorts metadata (≤100 char title + #Shorts hashtag), performance prediction. Niche-mismatch detection via Haiku to redirect long-form ideas to long-form pipeline.

## What to Build

### Step 1 — Data layer
- `shorts_runs` table DDL with RLS: id, user_id, channel_id, idea_text, target_duration_sec (15|30|45|60 enum), status (queued/running/complete/error), output_data jsonb, source_pipeline_run_id (nullable, for future Feature #22), created_at, completed_at, deleted_at, prompt_version.
- Zod schemas matching prompt-required shape: `ShortsOutputSchema = {script: {beats: [{timeSec, line, brollCue, isCut, kind}], coldOpen, loopSetup: {description, rewatchTrigger enum}}, thumbnailBrief: {composition (9:16 phone-mockup), focalPoint (safe-zone for vertical), palette, overlayText}, metadata: {title ≤100, description 200-300, hashtags string[3..5] (must include "#Shorts")}, performance: {predictedViewMultiple, retentionEstimate, hookStrength}, meta: {promptVersion}}` with cross-validation refines (loop_setup_check, cuts-per-duration band, word-count band 2.0-2.7 wps).

### Step 2 — Service + prompt
- `lib/prompts/shorts.ts`: Opus 4.7 single-shot system prompt with **dual** `cache_control` breakpoints — one on shared static blocks (Shorts mechanics + [CUT] system + loop rubric), another on niche/channel context. Attribution `// Adapted from AgriciDaniel/claude-youtube (MIT) — sub-skills/shorts.md`.
- `lib/prompts/shorts-mismatch.ts`: Haiku 4.5 classifier for "long-form intent" detection.
- `lib/services/shorts/mismatch.ts`: niche-mismatch service with 24h cache. Heuristics: idea length, mentioned topic-depth, "documentary"/"deep-dive" keyword indicators.
- `lib/services/shorts/orchestrator.ts`: single Opus call. SSE parsing checkpoints emit progress events.
- `lib/services/shorts/throttle.ts`: 30/day global throttle per user (not per channel).
- `lib/services/shorts/regenerate.ts`: per-section regen logic.

### Step 3 — API endpoints
- `POST /api/shorts { ideaText, targetDurationSec, channelId, forceShort? }` SSE — entire pipeline streams as one event sequence.
- `GET /api/shorts` paginated history.
- `GET /api/shorts/[shortRunId]` single run.
- `DELETE /api/shorts/[shortRunId]` soft-delete.
- `POST /api/shorts/[shortRunId]/regenerate-section { section: 'script'|'thumbnail'|'metadata' }` SSE.
- `forceShort=true` bypasses niche-mismatch detection (logged but not rate-limited).

### Step 4 — UI
- `/shorts` history list + `<ShortsHistoryRow>` + empty state.
- `/shorts/new` input form + `<DurationPicker>` (15s/30s/45s/60s, default 30s).
- `/shorts/[shortRunId]` results page: cold-open callout, [CUT]-divided script with M:SS timestamp pills as section dividers, loop-setup callout at bottom, 9:16 phone-mockup thumbnail brief (vertical aspect ratio), Shorts metadata card (title + description + hashtags including #Shorts), performance prediction with view-multiple + retention + hook strength.
- Error variants: niche-mismatch banner with "Use long-form pipeline" CTA; LLM error with retry; over-word-limit warning.

### Step 5 — Integration & testing
- Single-shot Opus joint context: one Anthropic call generates all sections (verified by request count).
- Prompt-cache hit verification: 2nd call shows `cache_read_input_tokens > 0` on both cache breakpoints.
- Niche-mismatch flow: idea "10-minute documentary about..." → Haiku flags long-form → returns 422 NICHE_MISMATCH with suggestion.
- 30/day throttle: 31st short returns 429 RATE_LIMITED with retryAfterSec.
- [CUT] markers at intervals ≤3s (80%+ in range [1.0, 3.0]).
- Loop-setup rubric satisfied: last 1-2s references opener (verified by anchor-substring check).
- Word-count band 2.0-2.7 wps for chosen duration.
- 9:16 thumbnail focal-point in safe-zone (not in cropped corners).
- #Shorts hashtag mandatory in metadata.
- Soft-deleted runs don't count toward throttle.
- forceShort=true bypass works (logged, monitored).
- Per-section regenerate counts as throttle slot.

## Cross-feature contracts

- Reads `channels.niche, top_videos_json` (Phase 1.5) for voice samples.
- Independent of `pipeline_runs` (separate `shorts_runs` table).
- Independent of Feature #22 cross-platform (this is shorts-from-idea; that's shorts-from-long-form via clip extraction).
- Future: `source_pipeline_run_id` field reserved for Feature #22 integration.
- "Send to calendar" CTA feature-flagged behind Feature #20 shipping.

## Verification

- [ ] `POST /api/shorts` SSE emits beats with `[CUT]` markers at intervals ≤3s (80%+ in [1.0, 3.0])
- [ ] `loop_setup_check` returns true when last beat references opener (anchor-substring verified)
- [ ] 31st short within 24h returns 429 RATE_LIMITED with retryAfterSec
- [ ] Niche-mismatch detection on "10-min documentary" idea returns 422 NICHE_MISMATCH with `useLongForm: true` suggestion
- [ ] Word-count band 2.0-2.7 wps for 30s duration → ~75 words target
- [ ] Cold-open ≤2s (timeSec[0] ≤ 2.0)
- [ ] Loop-setup at last 1-2s (timeSec[-1] ≥ duration - 2.0)
- [ ] #Shorts hashtag present in metadata.hashtags array
- [ ] 9:16 thumbnail focal point in safe-zone (not in top/bottom-corner clip regions)
- [ ] Soft-deleted runs don't count toward 30/day throttle
- [ ] Single Anthropic call per shorts run (verified by request counter)
- [ ] Dual `cache_control` breakpoints on system prompt; 2nd run shows `cache_read_input_tokens > 0`
- [ ] CRIT-2: Opus 4.7 single-shot + Haiku 4.5 for mismatch classifier
- [ ] CRIT-1: zero YouTube API calls in shorts pipeline (uses cached channel data)
- [ ] CRIT-4 attribution: `sub-skills/shorts.md`

## Out of scope

- Multi-channel shared shorts throttle (per-user not per-channel)
- Cascading regenerate (script regen does not auto-invalidate metadata)
- Escalation to Opus on Haiku mismatch false-positive (revisit if rate >5%)
- Per-niche word-count band (fixed 2.0-2.7 Phase 2)
- TikTok / Instagram Reels output (YouTube Shorts only)
- Vertical AI video generation (Phase 3+)
