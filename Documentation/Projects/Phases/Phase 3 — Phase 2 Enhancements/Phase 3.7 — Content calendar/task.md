# Phase 3.7 — Content calendar generator

**Parent:** Phase 3 — Phase 2 Enhancements
**Status:** Not Started
**Estimated:** 10-14 hours
**Depends on:** Phase 1.6 (pipeline_runs status sync), Phase 3.6 (audit optional for optimal slots)
**Spec:** `Documentation/Overviews and Summaries/20-content-calendar/spec.md`

## Goal

Visual content calendar (month/week/list views) tracking ideas + scheduled runs + completed publishes. Plan generator: Opus 4.7 produces a 4-12 week strategic plan with idea suggestions, seasonal CPM timing, format mix. Drag-drop reschedule. Trigger keeps `calendar_items.status` synced with `pipeline_runs.status`.

## What to Build

### Step 1 — Data layer (4 new tables + 1 buffer)
- `calendar_items` table: id, user_id, channel_id, run_id (nullable FK), idea_text, title, scheduled_date, status enum (idea/drafting/scoring/scripting/lint/ready/published — 7 values), format enum (long_form/short/community_post), notes, predicted_score_band, theme_id, created_at, updated_at. RLS auth.uid().
- `calendar_plans` table: provenance + forward FK to items.
- `calendar_themes` table: theme reuse across re-rolls.
- `calendar_unavailable_dates`: user-marked holiday/break dates (per-country observed-holidays seed).
- `calendar_plan_buffer`: short-lived (30-min TTL) buffer for streaming-suggested items not yet accepted.
- `sync_calendar_item_status` Postgres trigger: when `run_id` non-null, status reads from `pipeline_runs.status`; direct writes rejected.

### Step 2 — Plan generation (Opus 4.7 per CRIT-2)
- `lib/prompts/calendar.ts` + `calendar-replace.ts`: Opus 4.7 system prompt with `cache_control`. Attribution `// Adapted from AgriciDaniel/claude-youtube (MIT) — sub-skills/calendar.md`. Multi-week strategic plan format.
- `lib/services/calendar-plan.ts` orchestrator: 3/hour throttle, integration with Feature #19 audit data (optimal slots, cadence, weak dimensions to address) — graceful fallback when audit missing.
- `lib/services/calendar/holidays.ts`: lazy UPSERT from per-country observed-holidays static map; user-marked entries take precedence.
- JSONL streaming parser for SSE.
- `replace` prompt for skip+replace flow (single substitution).
- Post-lint pass on generated plan.

### Step 3 — Plan acceptance + skip-replace
- Buffered persistence model: suggested items live in `calendar_plan_buffer` (planId keyed). Only materialize on accept.
- `POST /api/plans/[planId]/accept` — selected indices materialize to `calendar_items`.
- `POST /api/plans/[planId]/discard` — cleans buffer.
- `POST /api/plans/[planId]/skip-and-replace { itemIndex }` — generates substitute, replaces in buffer. 20/hr throttle.
- `POST /api/channels/[channelId]/calendar/generate { startDate, weeks, cadence }` SSE.
- `POST .../retry` SSE — re-run generation with same params + feedback.

### Step 4 — CRUD API
- `GET /api/channels/[channelId]/calendar?start=&end=&view=month|week|list` — windowed list.
- `POST /api/channels/[channelId]/calendar` — manual create item.
- `PATCH /api/calendar/[itemId]` — edit/reschedule via new date/status change. Pipeline-controlled status (`run_id != null`) rejects direct status writes.
- `DELETE /api/calendar/[itemId]` — soft-delete.
- `POST /api/calendar/[itemId]/send-to-pipeline` — graduate idea to `pipeline_runs`.
- `GET/POST/PATCH/DELETE /api/channels/[channelId]/calendar/unavailable-dates`.
- `GET /api/channels/[channelId]/calendar/agenda?days=7` — upcoming items.

### Step 5 — UI
- Routes `/calendar`, `/calendar/[channelId]` + Toolbar (month picker, view toggle, "+ schedule new", filters) + ThemeBanner.
- MonthGrid + DayCell + ItemChip with status colors per spec design tokens (published=red/yt-600, ready=emerald, in-progress=blue, drafting=amber, idea=neutral).
- WeekView (hourly slots) + ListView (compact reading).
- Drag-and-drop reschedule (optimistic update + conflict modal on holiday/cadence violation with `force` override).
- Sidebar: upcoming-7-days agenda + optimal-slots from audit + cadence heatmap.
- Slide-over for item detail with attribution to source plan.
- Modals: schedule-new, conflict, skip-replace, plan-gen, streaming.
- Insufficient-data banner when audit missing.

### Step 6 — Integration & testing
- Status sync trigger blocks direct writes when `run_id != null`.
- 3/hour plan-gen throttle.
- 20/hour skip-and-replace throttle.
- `cache_control` static-grep verification.
- Predicted-score bands fade when real `pipeline_runs.score_data` exists.
- Cadence-violation soft guardrail with `force` override.
- Holiday detection per country code.
- Graceful degradation when `channel_audits` missing (sidebar collapses; plan uses seasonal CPM bands as fallback).
- Buffered persistence: `calendar_plan_buffer` row survives tab close; accept-after-expiry returns 404 PLAN_NOT_FOUND.
- Shorts exempt from cadence rule.
- CLAUDE.md updates: stack lock-in Opus 4.7 call site comment, Common Mistakes for cron pitfalls.

## Cross-feature contracts

- Reads `pipeline_runs` (Phase 1.6) for items with `run_id`; status sync trigger.
- Reads `channels.*` (Phase 1.5).
- Reads Feature #19 audit data for optimal slots + cadence + weak-dimension addressing (graceful fallback).
- Optional Feature #14 corpus for trending topics (graceful fallback).

## Verification

- [ ] `calendar_items` with `run_id != null` rejects direct status UPDATE (must come via pipeline_runs trigger)
- [ ] `POST /generate` 4th time within hour returns 429 RATE_LIMITED
- [ ] Opus call in calendar.ts has `cache_control` marker on system prompt (static grep)
- [ ] Predicted-score band fades to dimmed when real `pipeline_runs.score_data` exists
- [ ] Cadence violation surfaces soft warning with `force` override option
- [ ] Holiday conflict (date in `calendar_unavailable_dates`) surfaces modal
- [ ] `calendar_plan_buffer` survives tab close; accept-after-expiry returns 404 PLAN_NOT_FOUND
- [ ] 21st skip-replace within rolling hour returns 429
- [ ] Audit-missing fallback: sidebar collapses with CTA "Run channel audit"; plan uses seasonal CPM constants
- [ ] Holiday lazy-UPSERT idempotent on first calendar render; manual entries take precedence
- [ ] Shorts exempt from cadence rule (verified by integration test)
- [ ] CRIT-2: Opus 4.7 for plan generation with explanatory comment (deviation from default Haiku rationale)
- [ ] CRIT-4 attribution: `sub-skills/calendar.md`

## Out of scope

- Auto-scheduling to YouTube
- Multi-channel cross-calendar views
- Per-niche elasticity in cadence guardrails
- Real CPM data from YouTube Analytics (seasonal constants Phase 2)
- iCal export
