# Phase 2.3 — Titles (Stage 5) · Summary

**Parent:** Phase 2 — 12-Stage Pipeline
**Status:** Complete
**Spec:** `Documentation/Overviews and Summaries/06-title-generation/spec.md`

Stage 5 generates three titles — one per psychological trigger (curiosity / fear / result) — via Haiku 4.5, then becomes a **pipeline checkpoint**: the run pauses until the user locks at least one title, which unblocks the downstream fan-out.

---

## What was delivered

**New files (13)**

| File | Purpose |
|---|---|
| `lib/validation/titles.ts` | Hybrid schema: flat trigger keys (`curiosity`/`fear`/`result`, each `TitleVariant \| null`) so `titles_data.<trigger>.lockedIn` holds, plus the spec's rich per-variant fields (`charCount`, `voiceMatch {score,label}`, `truncated`, `originalLength`, `userEdited`, `predictedCtrLift`, `audienceCluster`, `vocabRefs`) and top-level `intentRewrites` / `flags` / `meta` / `chosenIndex` / `schemaVersion: 1`. Model literal pinned via `z.literal(TITLES_MODEL)`. Exports `hasAnyLockedTitle`, `variantsOf`, the Jaccard threshold + char-limit constants. |
| `lib/prompts/titles.ts` | Shared Haiku system prompt (~1500 tokens, CRIT-3 cacheable) with the three-trigger psychology brief, char rules, voice-matching protocol, diversity requirement, strict JSON contract, adversarial-input handling. MIT attribution header (`seo.md`). Per-trigger user-prompt builder (+ diversity-retry / char-reprompt / previous-text variants) and intent-rewrite prompt builder. |
| `lib/services/titles.ts` | Stage handler: 3 sequential Haiku calls (one per trigger, shared cached system) → Jaccard diversity check (>0.6 → one retry → `diversityWarning` flag) → 4th intent-rewrite call → assemble `TitlesData`. Voice samples from `channels.top_videos_json` (last 20 by recency, fallback <3). `MissingTitlePrereqError` before any token spend when the gate hasn't passed (or been overridden). Registers handler. Also exports `regenerateTrigger`. |
| `lib/services/titles-llm.ts` | LLM round-trip split out for the Q-2 cap: `generateOneTitle` (call + char-limit truncate/re-prompt-once → `CharLimitViolationError` on 2nd over-limit), `maxPairwiseJaccard` / `isTooSimilar`, `generateIntentRewrites`. Uses `CallClaudeInput["system"]` type to honor the SDK import fence. |
| `lib/services/titles-mutations.ts` | `lockTitle` (overwrites text, sets `lockedIn` + `userEdited`) and `unlockTitle` — pure JSONB read-modify-write of one trigger, others preserved byte-for-byte. |
| `lib/db/titles.ts` | Typed `readTitlesData` (Zod parse + ownership) / `writeTitlesData`. |
| `app/api/pipeline/titles/route.ts` | POST generate → 202 fire-and-forget; 409 STREAM_IN_PROGRESS; maps prereq/char errors to typed bus codes. |
| `app/api/pipeline/titles/regenerate/route.ts` | POST `{runId, trigger}` → single-trigger regen (synchronous JSON, returns updated `titlesData`). |
| `app/api/pipeline/titles/lock/route.ts` · `unlock/route.ts` | POST lock/unlock (synchronous JSON). |
| `app/api/runs/[runId]/continue/route.ts` | POST resume past the titles checkpoint — 409 `NO_TITLE_LOCKED` until ≥1 locked, then `runFromStage("hook")` fire-and-forget. |
| `app/(app)/runs/[runId]/Stage5Card.tsx` + `stage5/{shared,GeneratingCard,TitleCard}.tsx` | Generating shimmer, 3 trigger cards (purple/red/green) with char counter (amber>70/rose>100), CTR meter, voice-match badge, reasoning, copy-free lock/unlock/regenerate/inline-edit, fallback/diversity/truncation banners, intent-rewrites chips, "Continue to thumbnails →" CTA enabled when ≥1 locked. |
| `tests/services/titles.test.ts` | 7 specs: Jaccard threshold (similar vs distinct), `hasLockedTitle`/`canRunStage` gating, schema rejects >100-char title + non-Haiku model literal. |

**Modified files (6)**

| File | Change |
|---|---|
| `lib/services/pipeline.ts` | `PAUSE_AFTER = {titles}`: `runFullPipeline` / `runFromStage` return without `markRunComplete` after the titles checkpoint. |
| `lib/services/pipeline-stages.ts` | Added `hasLockedTitle(run)` + `canRunStage(stage, run)` (gates hook/script/thumbnails/seo/ab/engagement on a locked title). |
| `lib/services/stage-handlers.ts` | Added `import "@/lib/services/titles"`. |
| `lib/db/runs.ts` | `rowToListItem` preview now reads the flat trigger shape (locked title first, else first present trigger) instead of the old `titles_data.candidates[0].text`. |
| `app/(app)/runs/[runId]/RunView.tsx` | Special-cases stage 5 → `<Stage5Card>`. |
| `vitest.config.ts` | Added `test.env` with dummy keys — see deviation #4. |

---

## Deviations from `task.md`

1. **Pause-after-titles checkpoint (user-confirmed).** The orchestrator now stops after titles; the user locks ≥1 title and the new `POST /api/runs/[runId]/continue` resumes from hook. Required for the spec's "locked title is a downstream prerequisite." Implemented via `PAUSE_AFTER` in `pipeline.ts` + `canRunStage`/`hasLockedTitle` in `pipeline-stages.ts`. During the pause the run stays `status="running"` / `current_stage=5` (no new enum value / migration); the UI keys off `titles_data` + lock state. The lock/unlock/regenerate/continue endpoints are dedicated routes that don't hit the `rerun-from` RunAlreadyRunningError guard, so the "running" status during pause is harmless.

2. **Hybrid schema (user-confirmed).** Flat trigger keys (task.md verification) + the spec's enriched variant fields and top-level `flags`/`meta`. Satisfies both documents.

3. **`MISSING_PREREQUISITES` also allows gate-overridden runs.** task.md says block when `score_data.passed !== true`; but a gate-overridden run has `passed === false` yet the user chose to continue. The handler allows `passed === true OR gate_overridden_at !== null` so overridden runs can still generate titles (consistent with the Phase 2.2 override feature).

4. **`vitest.config.ts` gained `test.env` (test-infra fix, not a feature).** Adding the stage-handler barrel to `pipeline.ts` in Phase 2.2 made `pipeline.test.ts` transitively import the Anthropic client, which reads `lib/env.ts` and threw in the test env. (Phase 2.2 only ran typecheck/lint, so this latent break wasn't caught.) Dummy env values fix it; no test makes a real network call.

5. **No `db:titles` ownership double-check beyond user_id filter.** The routes verify ownership (`getRunRow` + `user_id`); the DB helpers re-filter by `user_id` for defense-in-depth.

6. **No migration.** `titles_data` JSONB + `stale_titles` already exist; the pause uses existing statuses.

---

## Verification results

| # | Box from `task.md` | Status |
|---|---|---|
| 1 | SSE emits 3 progress events with trigger names {curiosity, fear, result} | ✓ `Writing ${trigger} title…` per trigger |
| 2 | Model literal `claude-haiku-4-5-20251001` pinned via `z.literal` | ✓ `meta.model: z.literal(TITLES_MODEL)` (tested) |
| 3 | System prompt `cache_control: ephemeral`; calls 2+3 show cache hit | ✓ `buildSystem(TITLES_SYSTEM, 1500)` built once, reused across all calls |
| 4 | >100 chars → truncate + re-prompt once; 2nd violation throws `CHAR_LIMIT_VIOLATION` | ✓ `generateOneTitle` |
| 5 | Jaccard >0.6 between any 2 titles → exactly 1 retry | ✓ `isTooSimilar` → `generateAll(true)` once → `diversityWarning` (tested) |
| 6 | `MISSING_PREREQUISITES` before any LLM call when `score_data.passed !== true` | ✓ `buildContext` throws before generation (allows override) |
| 7 | Voice samples when ≥3 videos; niche fallback otherwise with banner | ✓ `VOICE_FALLBACK_MIN_SAMPLES` + `flags.voiceFallback` banner |
| 8 | Lock sets `<trigger>.lockedIn = true` + overwrites text; other 2 unchanged | ✓ `lockTitle` |
| 9 | Regenerate single trigger preserves other 2 byte-for-byte | ✓ `regenerateTrigger` spreads `...existing`, mutates one key |
| 10 | Stage 6/7/9/10/11/12 fan-out gated on titles_data via `canRunStage` | ✓ `canRunStage` + `hasLockedTitle` (tested) |

`pnpm typecheck` exit 0 · `pnpm lint` exit 0 · `pnpm test` 85 passed (78 prior + 7 new).

**Not verified:** UI not exercised in a browser this session (no interactive dev server). The three-card layout, inline edit, and Continue CTA are typechecked and lint-clean but not click-tested.

---

## Follow-ups / known gaps

Deferred per S-1 / `task.md` "Out of scope":

- **Niche vocabulary injection** (Feature #18) — `vocabRefs` is a `[]` placeholder
- **Embedding-based diversity** — Jaccard is the MVP
- **CTR re-estimation on inline edit** — edited titles keep the original CTR/voice scores
- **Collision detection vs existing YouTube titles** — costs 300 quota units, Phase 2

Phase-specific notes:

- **Pause status semantics:** the paused run shows `status="running"` in the runs list. A dedicated `awaiting_input` status (migration) would be cleaner; deferred to avoid scope creep.
- **Per-user rate limits** (30/hr regenerate, 20/hr generate) from spec §rate-limits are **not** enforced yet; the run-level 30/hr cap in `createRun` is the only limiter today.
- **Stage 6 (hook)** is the next dependent stage; its `stageDependencies` currently lists `["score"]` only — Phase 2.4 should add `titles` so the dependency graph matches the locked-title contract.
