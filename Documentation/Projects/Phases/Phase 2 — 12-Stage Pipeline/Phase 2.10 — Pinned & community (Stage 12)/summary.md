# Phase 2.10 — Pinned comment + community drafts (Stage 12) — Summary

**Status:** Complete · **Stage:** 12 of 12 (FINAL) · **Model:** Haiku 4.5
**Spec:** `Documentation/Overviews and Summaries/13-pinned-community-drafts/spec.md`

The terminal engagement-copy stage: one Haiku call produces a pinned comment, a
pre-publish community teaser, a post-publish hype post, and 3–5 suggested reply
templates. It **completes the run** (`status='complete'`) and unlocks the
**12-stage markdown bundle export**. **This closes Phase 2.**

## Build decisions (A/A/A + capstone)

1. **Bus transport**; the run endpoint is fire-and-forget and, on success,
   marks the run complete + emits `run_complete` (reused the existing bus event
   rather than adding `kit_ready` — the ship-it UI keys off `status==='complete'`).
2. **Direct single-draft regenerate**, not the spec's preview→commit two-step —
   consistent with every other stage's regenerate (titles/thumbnails/seo/ab).
3. **Lint-retry loop** (≤3) scans drafts against a forbidden-phrase list (the
   Stage-8 cliché/hostage/AI-tell phrases); after 3 failures → `LINT_RETRIES_EXHAUSTED`.

## Files delivered

- `lib/validation/engagement.ts` — `PinnedComment`, `CommunityPost` (pre/post variant refines), `SuggestedReplyTemplate` (3–5, trigger enum), `EngagementDrafts` + metadata (model literal, lintRetryCount), char caps (pinned ≤800, community ≤500).
- `lib/services/engagement-lint.ts` — `scanForbidden`/`isClean`/`scanDrafts` (pure, unit-tested).
- `lib/prompts/engagement.ts` — Haiku system (cacheable, CRIT-4 synthesized attribution to `repurpose.md` + `shorts.md` + `script.md`), forbidden-hits re-prompt injection.
- `lib/services/engagement.ts` — handler (1 call → coerce 4 artifacts + computed lint badges + lint-retry ≤3), `runEngagementManual` (→ `markStageComplete` + **`markRunComplete`**), `regenerateEngagementDraft` (direct), `registerStageHandler`.
- `lib/services/engagement-bundle.ts` — `assembleKitMarkdown` (12 H2 sections in stage order + MIT footer; returns `missingStages`), `kitFilename`.
- `lib/db/engagement.ts` — read/write `engagement_drafts_data`.
- Routes: `POST /api/pipeline/engagement` (202 bus, completes the run), `/regenerate` (JSON, draftType), `GET /api/runs/[runId]/export?format=markdown` (409 `RUN_INCOMPLETE` if any stage null).
- UI: `Stage12Card` + `stage12/parts` (pinned + community pre/post draft cards with lint badges, suggested-replies panel, **ship-it capstone** with a 12-deliverable checklist + Download-bundle when `status==='complete'`) + `lib/hooks/useEngagement.ts`.
- `tests/services/engagement.test.ts` — 10 tests. Wiring: barrel import + `Stage12Card` in `RunView`.

## Deviations / notes

- **`run_complete` instead of a new `kit_ready` event** (UI keys off `status`).
- **Direct regenerate** (no preview/commit two-step) — Phase-1 simplification, consistent with the codebase.
- The export bundle renders each stage's data as a JSON block under its H2 (12 sections) + the MIT footer — functional; bespoke per-stage prose rendering is a polish item.
- No migration (`engagement_drafts_data` pre-existed).

## Verification (task.md checklist)

- [x] After Stage 12, `pipeline_runs.status === 'complete'` (`runEngagementManual` → `markRunComplete`)
- [~] Bus event on completion — uses **`run_complete`** (not `kit_ready`); SSE subscriber + ship-it UI react to it
- [x] `GET …/export?format=markdown` returns 12 H2 sections in order + MIT footer (tested)
- [x] Export returns 409 `RUN_INCOMPLETE` (with `missingStages`) if any stage data is null (tested)
- [~] `/regenerate` — **direct persist** (preview/commit two-step deferred); overwrites only the targeted draftType, leaving the other 3 byte-identical
- [x] Lint retry loop max 3 → `LINT_RETRIES_EXHAUSTED` (forbidden-phrase scan, tested)
- [x] Concurrent POST → 409 `STAGE_IN_PROGRESS`
- [x] Suggested reply templates: 3–5 entries (schema, tested)
- [x] Pinned ≤800 / community pre+post ≤500 chars (schema, tested)
- [x] System prompt `cache_control` (EST 1500 ≥ 1024) (tested)
- [x] CRIT-2: `claude-haiku-4-5-20251001` literal (tested)
- [x] CRIT-4: synthesized attribution to `repurpose.md` + companions

**Gate:** `pnpm typecheck` + `lint` clean; `pnpm test` → **179 passed** (10 new); routes load on the dev server. UI not click-tested.

## Follow-ups / known gaps

- `// TODO(phase-2):` preview/commit two-step regenerate; the dedicated `kit_ready` event + analytics `run.completed`; richer per-stage prose in the bundle; zip/PDF export; "mark as published" flow (Feature #17).
- **Phase 2 (the 12-stage pipeline) is now complete** — all of Stages 3–12 are real.
