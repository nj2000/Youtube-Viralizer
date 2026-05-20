# Phase 2.5 — Retention script (Stage 7)

**Parent:** Phase 2 — 12-Stage Pipeline
**Status:** Complete
**Estimated:** 10-14 hours (most complex stage)
**Depends on:** Phase 2.3 (locked title), Phase 2.4 (locked hook)
**Spec:** `Documentation/Overviews and Summaries/08-retention-script/spec.md`

## Goal

The largest stage. Opus 4.7 generates a full retention-engineered script with section structure, [SKELETON]/[PERSONALITY] markers, open loops (Marvel-post-credit psychology), retention curve, true delta streaming. Target durations 5/8/12/20 min (default 8). Drift check vs locked title (non-blocking).

## What to Build

### Step 1 — Data layer
- Migration: add `pipeline_runs.script_target_minutes` (int), `script_locked_title_index`, `script_locked_hook_index`. Add `script_gen_throttle` table (channel-scoped 30 scripts/24h, section-regen 60/24h) + `anthropic_spend_daily` table ($50/day cap default constant + new env var `ANTHROPIC_DAILY_BUDGET_USD`).
- Add partial unique index on script_gen_throttle.
- Zod schemas: `ScriptSectionSchema` (title, startSec, endSec, paragraphs: `[{text, marker: 'skeleton'|'personality'|null, brollCues}]` — **marker is a paragraph FIELD, NOT inline brackets**), `RetentionCurveSchema` ({timeSec, predicted: 0-100}[]), `OpenLoopSchema` (setupSection, payoffSection, description, anchorSubstring), `ScriptDataSchema` ({sections, totalWordCount, estimatedRuntimeSec, retentionCurve, openLoops, drift: {score, problemDescription?}, schemaVersion}).

### Step 2 — Voice fingerprint + rubric
- `lib/services/voice-fingerprint.ts`: Haiku 4.5 call on `channels.top_videos_json` titles (NOT real personality calibration — that's Feature #19), 7-day cache.
- Section taxonomy lookup table per `targetMinutes` (5min=750 words=4 sections, 8min=1200=6 sections, 12min=1800=8 sections, 20min=3000=10 sections). Model cannot invent sections.
- Open-loop rubric: verifiable anchor-substring check + minimum-distance constraint (≥2 sections between setup and payoff).
- Rehook helpers: at section boundaries, retention rehook insertion.

### Step 3 — Service + prompt
- `lib/prompts/script.ts`: ~5500-token Opus 4.7 system prompt with `cache_control` (CRIT-3 critical — saves $$$). Attribution `// Adapted from AgriciDaniel/claude-youtube (MIT) — sub-skills/script.md`. Voice fingerprint and user message stay outside cache breakpoint.
- `lib/services/script.ts`: TRUE delta streaming via Anthropic `messages.stream()` (unlike Stage 4's simulated). New event types: `section_chunk`, `section_complete`, `rehook_inserted`, `loop_opened`, `loop_closed`. Cold-open hook MUST be verbatim in `sections[0].paragraphs[0].text` (whitespace-normalized).
- Format violation: exactly 1 re-prompt (max 2 total attempts), then FORMAT_VIOLATION error.
- Retention curve heuristic computed server-side: decay + rehook bonus + loop bonus + demo-density penalty + rehook-gap penalty.
- Drift check: 2 separate Haiku calls comparing locked title to first 25% of script. Drift score 0-100; ≤40 passes; >40 flags `drift: {score, problemDescription}` (non-blocking, returns in `complete` payload not as error).
- Daily $50 budget cap (via `anthropic_spend_daily`); 30 full scripts/24h channel throttle; 60 section regens/24h.

### Step 4 — API endpoints
- `POST /api/pipeline/script { runId, targetMinutes? }` SSE — true streaming of section_chunk events as Opus generates. Auto-queues Stage 8 (lint) on completion.
- `POST /api/pipeline/script/regenerate-section { runId, sectionIndex }` — does NOT auto-queue Stage 8 (only full-script regen does).
- `POST /api/pipeline/script/relock { runId }` — clears `script_data` to null (destructive, no archive; section_history table deferred to Phase 2).
- `GET /api/pipeline/script/plain-text { runId }` — exports script as plain-text with bracketed `[SKELETON]`/`[PERSONALITY]` markers in prose form.
- Multi-tab concurrency: second simultaneous call returns 409 STREAM_IN_PROGRESS.

### Step 5 — UI
- Pre-run gate: target-minutes picker (5/8/12/20, default 8).
- Streaming view: skeleton sections with section_chunk events filling in progressively; rehook_inserted / loop_opened markers shown as inline icons.
- Full script view: left-rail section nav, retention curve SVG (gradient under line), section-by-section content with marker pills, B-roll cues in italic, per-section regenerate button.
- Plain-text export view (toggle).
- Banners: drift detected (non-blocking, amber), format violation retry, daily budget exhausted.

### Step 6 — Integration & testing
- True delta streaming: messages.stream() emits ≥50 `section_chunk` events for an 8-min script.
- Markers stored as `marker: 'skeleton' | 'personality' | null` paragraph fields, NOT inline `[SKELETON]` text.
- Auto-trigger Stage 8 on full-script complete; section-regen does NOT.
- Format violation re-prompts exactly 1 time then errors.
- Drift score ≤40 passes; >40 flags non-blocking.
- Multi-tab returns 409 STREAM_IN_PROGRESS.
- Daily budget cap enforces.
- Prompt-cache hit verified on ~5500-token system block.

## Cross-feature contracts

- Reads locked title (Stage 5), locked hook (Stage 6 — verbatim into sections[0].paragraphs[0]), idea_text, competitor_data, score_data, channels.niche, channels.top_videos_json.
- Writes `pipeline_runs.script_data` — consumed by Stage 8 (lint), Stage 10 (SEO chapters), Stage 12 (engagement). Feature #15 reads structure for AVD prediction.
- Auto-triggers Stage 8 on full-script completion (`'scripted'` event).
- Adds new pipeline_runs columns (`script_target_minutes`, `script_locked_title_index`, `script_locked_hook_index`); two new tables (`script_gen_throttle`, `anthropic_spend_daily`).

## Verification

- [ ] `messages.stream()` emits at least 50 `section_chunk` events for an 8-min script (verified by event counter)
- [ ] `[SKELETON]` and `[PERSONALITY]` stored as `marker` field on paragraph objects, NOT inline brackets in `text`
- [ ] Retention curve has data points every 30s of script duration
- [ ] Format violation re-prompts exactly 1 time then throws `FORMAT_VIOLATION`
- [ ] `DRIFT_DETECTED` is in `complete.drift` payload (not error code) when drift score >40
- [ ] Cold-open hook from Stage 6 appears verbatim (whitespace-normalized) in `sections[0].paragraphs[0].text`
- [ ] Full script completion auto-queues Stage 8; per-section regen does NOT auto-queue
- [ ] Re-pick action clears `script_data` to null (no archive)
- [ ] 31st full script in 24h returns 429 RATE_LIMITED; 61st section regen returns 429
- [ ] Daily Anthropic spend >$50 returns 503 BUDGET_EXCEEDED
- [ ] Multi-tab concurrent POST returns 409 STREAM_IN_PROGRESS
- [ ] System prompt ~5500 tokens has `cache_control: ephemeral`; 2nd run shows `cache_read_input_tokens > 0`
- [ ] CRIT-2: `claude-opus-4-7` for script + `claude-haiku-4-5` for drift + voice fingerprint
- [ ] CLAUDE.md updates: new env var `ANTHROPIC_DAILY_BUDGET_USD`, stack lock-in mentions drift Haiku calls

## Out of scope

- 10/15-min length options (5/8/12/20 only Phase 1)
- Section history / archive (re-pick is destructive in Phase 1)
- Per-channel real personality calibration (Feature #19)
- Per-channel WPM tuning (150 wpm constant Phase 1)
- Embedding-based drift (Haiku-call drift for Phase 1)
