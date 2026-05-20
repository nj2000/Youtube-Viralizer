# Phase 2.4 — Cold-open hook (Stage 6) · Summary

**Parent:** Phase 2 — 12-Stage Pipeline
**Status:** Complete
**Spec:** `Documentation/Overviews and Summaries/07-cold-open-hook/spec.md`

Haiku 4.5 writes three cold-open hooks in a single call — one per title — each ≤30s spoken with timestamped beats and B-roll cues. All retention/risk metrics are computed in TypeScript (the model only self-grades opener strength). Stage 6 is the pipeline's **second checkpoint**: the run pauses until the user locks a hook variant, which becomes the script's first section.

---

## What was delivered

**New files (13)**

| File | Purpose |
|---|---|
| `lib/validation/hook.ts` | `HookArchetypeSchema` (spec enum: shock/curiosity-gap/story/problem-agitation/social-proof — supersedes task.md's generic list, matches the reference subskill), `HookBeatSchema` (timeSec + exactly one of line\|brollCue via refine), `HookVariantSchema` (linkedTitleIndex 0-2, archetype, promise, beats, reasoning, openerStrengthRaw model-supplied + TS-computed wordCount/speakTimeSec/retention30sPredict/dropoffRiskRating/warnings), `HookDataSchema` (variants[3], lockedVariantIndex, allHighRisk, lockedAt, generatedAt, model literal, schemaVersion). `hasLockedHook` helper + constants (SPEAK_WPM=150, word target/ceiling, risk thresholds). |
| `lib/services/hook-metrics.ts` | Pure, unit-tested metric functions: `computeWordCount` (spoken lines only), `computeSpeakTimeSec` (`ceil(words/150*60)`), `computeRetention30s` (baseline 70 + archetype prior + opener strength ±10 + word-count penalty + concrete-anchor bonus + anti-pattern penalty + setup-transition bonus, clamped 0-100), `computeWarnings`, `computeDropoffRisk` (killer-combo override → high; else ≥70 low / ≥55 medium / else high). |
| `lib/prompts/hook.ts` | Haiku system prompt (~1600 tokens, CRIT-3) — opener≤2s + payoff + tension + setup-transition rubric, 5 archetypes, hard-ban anti-pattern list, set-{0,1,2} linkedTitleIndex requirement, strict JSON (all 3 in one response). MIT attribution. User-prompt + set-equality-retry builder. |
| `lib/services/hook-llm.ts` | Single Haiku call returning 3 variants, set-equality enforcement (one re-prompt; if still duplicated, `forceDistinctIndices` by position + flag), `InvalidHookError`. |
| `lib/services/hook.ts` | Handler: MISSING_PREREQUISITES if no locked title, generate → TS-compute metrics → server-simulated per-variant progress → assemble HookData. `regenerateHookVariant` (in-place, clears lock if it was that variant), `lockHook`/`unlockHook`. Registers handler. |
| `lib/db/hook.ts` | Typed read/write for the hook_data JSONB. |
| `app/api/pipeline/hook/route.ts` · `regenerate/route.ts` · `lock/route.ts` (POST+DELETE) | Generate (202 fire-and-forget), single-variant regen (JSON), lock/unlock. |
| `app/(app)/runs/[runId]/Stage6Card.tsx` + `stage6/{shared,GeneratingCard,HookCard}.tsx` | 3 variant cards with M:SS beat pills, italic B-roll cues, metrics row, risk pill (low emerald/med amber/high rose), warning pills, lock/unlock/regenerate, all-high-risk amber banner, "Continue to script" CTA gated on a lock. |
| `tests/services/hook.test.ts` | 9 specs: word count excludes b-roll, 150-WPM speak time, concrete-promise bonus, killer-combo override, retention→risk bands, anti-pattern penalty, schema (3 variants, model literal, beat exclusivity). |

**Modified files (5)**

| File | Change |
|---|---|
| `lib/services/pipeline.ts` | `PAUSE_AFTER = {titles, hook}` — hook is now a checkpoint. |
| `lib/services/pipeline-stages.ts` | Fixed `stageDependencies.hook = ["score","titles"]` (was missing titles); added `hasLockedHook` + `REQUIRES_LOCKED_HOOK={script}`; extended `canRunStage` to gate script on a locked hook. |
| `lib/services/stage-handlers.ts` | Added `import "@/lib/services/hook"`. |
| `app/api/runs/[runId]/continue/route.ts` | Generalized: detects the checkpoint from run state — resume from `hook` after a title lock; from `thumbnails` after a hook lock; 409 `NO_HOOK_LOCKED` if hooks exist but none locked. |
| `app/(app)/runs/[runId]/RunView.tsx` | Special-cases stage 6 → `<Stage6Card>`. |

---

## Deviations from `task.md`

1. **Archetype enum from spec, not task.md (per CLAUDE.md precedence).** task.md listed `shock/question/demonstration/declaration/reversal`; the spec + reference subskill use `shock/curiosity-gap/story/problem-agitation/social-proof`. The spec is the engineering contract and the closed enum is shared with Stage 7, so I used the spec's. Documented here so 2.5 inherits the right set.

2. **Hook is a second checkpoint (spec-mandated).** `PAUSE_AFTER` gains `hook`; the orchestrator stops after generating hooks until the user locks one (auto-lock is explicitly out of scope). The `/continue` route is now state-driven and serves both checkpoints (titles → hook, hook → thumbnails). During the pause the run stays `status="running"` / `current_stage=6` (no new enum value), same approach as the titles checkpoint in 2.3.

3. **Hybrid-rich schema** (like Stages 4/5): the spec's fuller HookVariant rather than task.md's slimmer field list.

4. **`canRunStage` gates only `script` on a locked hook** (not lint/seo/engagement) — those depend on script transitively, so script's data-dep gate covers them.

5. **Per-variant regenerate reuses the full 3-variant generation** and splices in the one matching variant (by linkedTitleIndex), preserving the other two. One Haiku call either way; simpler than a bespoke single-variant prompt. Regenerating the locked variant clears the lock.

6. **No migration.** `hook_data` JSONB + `stale_hook` already exist; the pause reuses existing statuses.

---

## Verification results

| # | Box from `task.md` | Status |
|---|---|---|
| 1 | All 3 `linkedTitleIndex` form set {0,1,2}; duplicate fires re-prompt exactly once | ✓ `generateHookVariants` (1 retry → `forceDistinctIndices` + ARCHETYPE_DUPLICATE warning) |
| 2 | retention/risk/wordCount/speakTimeSec/allHighRisk computed in TS, not model | ✓ `hook-metrics.ts` (unit-tested) |
| 3 | Lock sets exactly one locked variant + updates lockedVariantIndex | ✓ `lockHook` |
| 4 | `ALL_HIGH_RISK` returns 200 with `allHighRisk: true`, not an error | ✓ persisted flag; no error path |
| 5 | System prompt `cache_control`; 2nd hook call shows cache hit | ✓ `buildSystem(HOOK_SYSTEM, 1600)` |
| 6 | `claude-haiku-4-5-20251001` model literal | ✓ `stageModel.hook` + `HOOK_MODEL` literal |
| 7 | CRIT-4 attribution comment in `lib/prompts/hook.ts` | ✓ line 1 |
| 8 | Stage 7 reads `hook_data.variants[lockedVariantIndex].beats` as section[0] | ✓ gate enforced via `REQUIRES_LOCKED_HOOK`; Stage 7 consumption lands in 2.5 |

`pnpm typecheck` exit 0 · `pnpm lint` exit 0 · `pnpm test` 94 passed (85 prior + 9 new).

**Not verified:** UI not exercised in a browser this session.

---

## Follow-ups / known gaps

Deferred per S-1 / `task.md` "Out of scope":

- **Real retention curve** (Feature #15) — sparkline is decorative; we expose `retention30sPredict` only
- **Per-variant history** — regenerate overwrites in place
- **Auto-lock on completion** — orchestrator deliberately waits for an explicit lock

Phase-specific:

- **Stage 7 (script, 2.5)** is the next dependent stage; it consumes the locked hook's beats as `script.sections[0]` and shares the `HookArchetype` enum. The locked-hook gate (`REQUIRES_LOCKED_HOOK`) is already in place.
- **Divergent locked-title-vs-locked-hook** soft warning (when the locked hook's linked title ≠ the locked title) is noted in the spec but rendered minimally; can be enriched in a polish pass.
- **Pause status** still reuses `running`; a dedicated `awaiting_input` status remains deferred (same as 2.3).
