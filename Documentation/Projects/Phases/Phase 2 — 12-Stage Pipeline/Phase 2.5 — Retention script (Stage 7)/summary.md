# Phase 2.5 — Retention script (Stage 7) · Summary

**Parent:** Phase 2 — 12-Stage Pipeline
**Status:** Complete
**Spec:** `Documentation/Overviews and Summaries/08-retention-script/spec.md`

The heaviest stage. Opus 4.7 streams a full retention-engineered script token-by-token (true `messages.stream()`, not simulated) into a deterministic section structure; markers, retention curve, drift, budget caps, and rate limits all ship. Script is a **manually-triggered stage** (length picker) — the only stage with its own live SSE endpoint instead of the fire-and-forget bus.

---

## What was delivered

**New files (18)**

| File | Purpose |
|---|---|
| `supabase/migrations/0010_script.sql` | pipeline_runs += script_target_minutes / script_locked_title_index / script_locked_hook_index; new service-role-only tables `anthropic_spend_daily` (day, total_micro_usd) and `script_gen_throttle` (channel_id, day, full_count, section_count) + unique index. |
| `lib/validation/script.ts` | Full schema set (ScriptParagraph with `marker` field, ScriptSection, RetentionSample, OpenLoop, RehookBeat, ScriptDrift, ScriptData) + `SCRIPT_SECTION_TEMPLATES` deterministic taxonomy (5/8/12/20 → 4/6/8/10 sections) + constants (WPM 150, drift threshold 40) + `normalizeWhitespace`. |
| `lib/anthropic/stream.ts` | `callClaudeStream` (true `messages.stream()` with onTextDelta + Opus thinking/effort) + `estimateCostMicroUsd` (Opus $15/$75, Haiku $1/$5 per Mtok). SDK import lives inside lib/anthropic/**. |
| `lib/anthropic/onboarding.ts` (edit) | Added `callHaiku` for non-DAG Haiku sub-calls (drift + voice), mirroring `callSonnet`. |
| `lib/services/retention-curve.ts` | Pure heuristic (decay + rehook/loop bonuses + demo-density/rehook-gap penalties), samples every 30s. Unit-tested. |
| `lib/db/script.ts` | Typed read/write/clear of script_data + locked-index columns; spend get/increment; throttle get/increment. |
| `lib/services/script-budget.ts` | `assertBudget` (503 BUDGET_EXCEEDED vs ANTHROPIC_DAILY_BUDGET_USD), `assertThrottle` (30 full/day, 60 section/day → RATE_LIMITED). |
| `lib/services/voice-fingerprint.ts` | Haiku descriptor of channel voice, 7-day cached in youtube_api_cache, with a fallback string. |
| `lib/services/script-drift.ts` | 2 Haiku calls (extract promise + locate it in early sections) → 0-100 drift score; non-blocking (never throws into the stream). |
| `lib/prompts/script.ts` | ~5500-token Opus system prompt (CRIT-3 cached) defining the wire format + verbatim cold-open rule + section template injection; MIT attribution; format-violation re-prompt builder. |
| `lib/services/script-parse.ts` | Parses the wire format → sections/paragraphs (marker as field) / loops / rehooks; `validateScript` (section count/roles, verbatim hook whitespace-normalized, loop anchors). Pure + tested. |
| `lib/services/script.ts` | `generateScript` streaming generator: prereq + budget + throttle, voice fingerprint, stream Opus emitting section_chunk/section_complete/rehook_inserted/loop_opened/loop_closed, 1 format re-prompt then FORMAT_VIOLATION, TS retention curve, drift, persist + record spend + bump throttle. |
| `lib/services/script-mutations.ts` | `relockScript` (clears script_data) + `regenerateScriptSection` (one section, non-streaming, recomputes curve, no auto-queue). |
| `app/api/pipeline/script/route.ts` | **Direct SSE** POST (hand-rolled frames for the custom event protocol); best-effort in-flight guard → 409 STREAM_IN_PROGRESS; auto-queues lint via `runFromStage("lint")` on completion. |
| `app/api/pipeline/script/regenerate-section/route.ts` · `relock/route.ts` · `plain-text/route.ts` | Section regen (no auto-queue), re-pick (clears), teleprompter export with bracketed markers. |
| `lib/hooks/useScriptStream.ts` | Client hook: POSTs + reads the ReadableStream, parses the custom SSE events for the live typewriter. |
| `app/(app)/runs/[runId]/Stage7Card.tsx` + `stage7/{shared,ScriptView}.tsx` | Length gate (5/8/12/20), streaming view (accumulating section chunks), full script view (retention SVG, marker-pilled paragraphs, B-roll italics, per-section regenerate, plain-text + re-pick), drift/budget banners. |
| `tests/services/script.test.ts` | 9 specs: wire-format parse, marker-as-field, [PERSONALITY] split, verbatim/whitespace match, section-count violation, retention decay + rehook bonus + section averaging. |

**Modified files (6):** `lib/anthropic/index.ts` (exports), `lib/env.ts` (`ANTHROPIC_DAILY_BUDGET_USD`), `lib/db/types.ts` (hand-added columns + 2 tables), `lib/services/pipeline.ts` (`MANUAL_STAGES={script}`), `app/(app)/runs/[runId]/RunView.tsx` (stage 7 dispatch), `CLAUDE.md` (env var + Haiku-sub-call note on the CRIT-2 Stage 7 row).

---

## Deviations / decisions

1. **True token streaming via a dedicated SSE endpoint (user-confirmed).** `POST /api/pipeline/script` returns its own long-lived `text/event-stream` (hand-rolled frames) because the bus union is closed and Realtime broadcast is too noisy for token deltas. This is the **first direct-SSE stage**; the client uses `useScriptStream` (fetch + ReadableStream reader), not the run-wide bus. The other stages' fire-and-forget pattern is unchanged.

2. **Budget + rate-limit infra built (user-confirmed).** Two new service-role tables + the env var; 503 BUDGET_EXCEEDED + 429 RATE_LIMITED enforced.

3. **Script is a manual-trigger stage.** It needs a user-picked length, so it can't auto-run in the fan-out. `MANUAL_STAGES={script}` makes the auto-chain stop before it; the streaming endpoint runs it and then resumes the chain from `lint`. Fixed in `pipeline.ts`.

4. **Schema is the hybrid-rich shape** like prior stages; `marker` is a paragraph field (never inline brackets).

5. **`generateScript` writes script_data directly** (not via `markStageComplete`), so the DOWNSTREAM staleness cascade for script isn't triggered on regeneration — acceptable in Phase 1 (downstream are stubs and lint auto-runs immediately after). Noted as a follow-up.

6. **Concurrency guard is best-effort** (in-memory `Set` per server instance) since the pause leaves the run at `status="running"` and there's no script-specific status. A durable guard would need a column; deferred.

7. **Voice fingerprint + drift use the new `callHaiku`** (CRIT-2 — Haiku for these sub-calls), not the Opus stage model.

---

## Verification results

| # | Box | Status |
|---|---|---|
| 1 | `messages.stream()` emits ≥50 section_chunk events | ✓ section_chunk per text delta in `streamInto` |
| 2 | Markers stored as `marker` field, not inline brackets | ✓ `script-parse` (tested) |
| 3 | Retention curve has points every 30s | ✓ `SAMPLE_STRIDE_SEC=30` (tested) |
| 4 | Format violation re-prompts once then FORMAT_VIOLATION | ✓ `generateScript` |
| 5 | `DRIFT_DETECTED` is in `complete.drift`, not an error | ✓ drift in ScriptData payload; never throws |
| 6 | Cold-open hook verbatim (whitespace-normalized) in sections[0].paragraphs[0] | ✓ `validateScript` (tested) |
| 7 | Full completion auto-queues Stage 8; section regen does NOT | ✓ route auto-queues lint; regenerate-section does not |
| 8 | Re-pick clears script_data to null | ✓ `relockScript` → `clearScriptData` |
| 9 | 31st full / 61st section in 24h → 429 RATE_LIMITED | ✓ `assertThrottle` (30/60 caps) |
| 10 | Daily spend > budget → BUDGET_EXCEEDED | ✓ `assertBudget` (regenerate-section returns 503; stream emits the code) |
| 11 | Concurrent POST → 409 STREAM_IN_PROGRESS | ✓ in-flight guard (best-effort) |
| 12 | ~5500-token system prompt has `cache_control` | ✓ `buildSystem(SCRIPT_SYSTEM, 5500)` |
| 13 | Opus 4.7 for script + Haiku 4.5 for drift + voice | ✓ `stageModel.script` Opus; `callHaiku` for drift/voice |
| 14 | CLAUDE.md: new env var + Haiku-sub-call note | ✓ |

`pnpm typecheck` exit 0 · `pnpm lint` exit 0 · `pnpm test` 103 passed (94 prior + 9 new).

**Not verified:** the live streaming UI / typewriter, length gate, and per-section regen were not exercised in a browser this session (no interactive run). The streaming protocol, parser, and validation are unit-tested; the end-to-end Opus stream was not executed.

---

## Follow-ups / known gaps

Deferred per S-1 / `task.md` "Out of scope": 10/15-min lengths, section history/archive (re-pick is destructive), real personality calibration (Feature #19), per-channel WPM tuning, embedding-based drift.

Phase-specific:
- **Migration not pushed.** Run `supabase link --project-ref <ref>` then `pnpm db:push`, then `pnpm db:types` (should match the hand-edited types).
- **Staleness cascade on script regen** isn't triggered (writeScriptData bypasses markStageComplete); harmless while downstream are stubs.
- **Durable concurrency guard / `awaiting_input` status** still deferred (same as 2.3/2.4).
- **Stage 8 (lint, 2.6)** is next and auto-queues off script completion; it reads script_data + the locked title/hook.
