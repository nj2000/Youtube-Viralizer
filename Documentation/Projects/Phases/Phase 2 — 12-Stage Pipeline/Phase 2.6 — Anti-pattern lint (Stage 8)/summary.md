# Phase 2.6 — Anti-pattern lint + drift (Stage 8) — Summary

**Status:** Complete · **Stage:** 8 of 12 · **Model:** Haiku 4.5 (both passes, CRIT-2)
**Spec:** `Documentation/Overviews and Summaries/09-antipattern-lint-drift/spec.md`

Haiku 4.5 runs a two-pass QA scan over the finished Stage 7 script — (1) a closed
set of anti-pattern rules, (2) a separate title↔script drift check — and writes
`pipeline_runs.lint_data`. The stage is **non-blocking**: the orchestrator never
halts on lint, and downstream stages run regardless of `summary.blocking`.

## Build decisions (confirmed with the user as A/A/A)

1. **Transport: bus, not dedicated SSE.** The spec (§4.1/§5.3) specified an SSE
   endpoint streaming `issue_found` events via a `streamingJson.ts` parser that
   doesn't exist. Stages 3–6 use the fire-and-forget + `pipeline-bus` pattern,
   and the auto-trigger is already a server-side `runFromStage("lint")` (script
   route), which structurally requires the bus. We honor the spec's *intent*
   (live progress) with bus `progress` events and render results on
   `stage_complete`. No `pipeline-bus.ts` change was needed — the existing
   `progress` event already carries arbitrary messages.
2. **Concurrency: optimistic guard, no advisory lock.** Spec §6.1 wanted
   `pg_advisory_xact_lock`, but `supabase-js` can't hold a transaction without a
   new Postgres RPC + migration, and the existing lock/regen endpoints use plain
   read-modify-write. Accept/dismiss/apply-all use read-modify-write with
   `ISSUE_ALREADY_RESOLVED` (409) guarding double-resolves. True advisory locking
   is `// TODO(phase-2):`.
3. **Hourly rate-limit deferred.** Spec §9's 30-runs/hour limit has no backing
   table and isn't in the verification checklist; the `inputsHash` dedup already
   makes repeat lints free. Deferred `// TODO(phase-2):`.

## Files delivered

**Validation**
- `lib/validation/lint.ts` — `LintRuleIdSchema` (closed enum), `LintIssue`,
  `DriftCheck`, `LintSummary`, `LintData` (`schemaVersion: z.literal(1)`, model
  literal pinned, `superRefine` cross-checking summary counts + `blocking`).

**Prompts**
- `lib/prompts/lint-rules.ts` — `RULE_SPECS` (the rule taxonomy), `LINT_THRESHOLDS`
  (single source of truth, spec §5.5), `DEFAULT_SEVERITY`, `renderRulesForPrompt`.
- `lib/prompts/lint.ts` — `LINT_SYSTEM` (~3500 tok) + `DRIFT_SYSTEM` (~1200 tok),
  both CRIT-3-cacheable; `buildLintUserPrompt`/`buildDriftUserPrompt` (XML-wrapped
  untrusted inputs); CRIT-4 synthesis attribution header.

**Service** (split per Q-2 ≤300 lines)
- `lib/services/lint.ts` — `lintStageHandler` (registered), `resolveLintInputs`,
  `computeInputsHash` (SHA-256 dedup), `runLintManual` (manual/rerun path via
  `markStageComplete`, so re-linting a finished run keeps its terminal status),
  `lintErrorCode`.
- `lib/services/lint-anti-pattern.ts` — anti-pattern Haiku call, JSON-array parse
  + 1 reformat retry, severity-policy override, `(ruleId,section)` dedup,
  `dropVoiceMismatch`, 200-issue cap, shared `usageOf`.
- `lib/services/lint-drift.ts` — `runDriftPass`, server-computed `passed`,
  derived `drift/*` issues (§5.4).
- `lib/services/lint-mutations.ts` — pure `resolveApplyAll` (§5.8),
  `recomputeSummary`, `applyExcerptFix`, `applyIssueAction`, `applyAllFixes`,
  error classes.
- `lib/services/lint-actions.ts` — route-facing `acceptOrDismissIssue`,
  `applyAll`, `overrideLint`, `skipLint`, `isLintFresh`.
- `lib/services/lint-script.ts` — script→text helpers, `extractOpening`,
  `passesDrift`.
- `lib/db/lint.ts` — `readLintData`/`writeLintData`/`clearLintData`.

**Routes** (`app/api/pipeline/lint/`)
- `route.ts` (run), `rerun/`, `issue/`, `apply-all/`, `skip/`, `override/`.

**UI** (`app/(app)/runs/[runId]/`)
- `Stage8Card.tsx` + `stage8/{shared,GeneratingCard,CleanCard,IssueRow,DriftBanner,ResultsCard,ErrorCard}.tsx`.
- `lib/hooks/useLint.ts` — accept/dismiss/apply-all/rerun/skip/override/run actions.

**Wiring / tests**
- `lib/services/stage-handlers.ts` — added `import "@/lib/services/lint"`.
- `app/(app)/runs/[runId]/RunView.tsx` — `Stage8Card` branch.
- `tests/services/lint.test.ts` — 25 tests.

## Deviations from spec/task (and why)

- **Closed enum is 19 IDs, not "20".** The spec's literal `LintRuleIdSchema`
  block and the §5.2 rule table both enumerate 19; only the "exactly 20" label is
  an off-by-one. We implemented the exact enum (spec is authoritative). The
  verification test asserts `LINT_RULE_IDS.length === 19`.
- **Apply-all §5.8 worked example is 2 accepted + 1 dismissed**, not the task
  checkbox's "1 accepted + 2 dismissed". We implemented the spec algorithm and
  test **both** the §5.8 A/B/C example (2+1) and a fully-overlapping triple (1+2),
  so the checkbox's intent is covered.
- **Excerpt-anchored patching**, not char-offset splicing. The spec assumed a flat
  `sections[].content` string; the real Stage 7 schema is paragraph-structured
  (`paragraphs[].text`). Accept/apply-all locate the paragraph containing the
  verbatim `excerpt` and replace it — robust to the structure. `lineRange` is kept
  for UI highlighting and §5.8 conflict resolution.
- **Global-rule accepts are advisory.** All global rules (drift/seo/structure/
  retention/tone) produce non-substitutable suggestions, so they're surfaced via
  the drift banner / row but don't physically patch; `drift/*` accepts are
  rejected (400).
- **Status machine.** The spec's `linting`/`lint_complete`/`lint_skipped` statuses
  don't exist in this codebase; lint state is the presence/shape of `lint_data`.
  `skip` is advisory (publishes `stage_complete`); `override` persists
  `overridden=true` + `blocking=false`.

## Verification (task.md checklist)

- [x] `LintRuleIdSchema` accepts exactly the closed set, rejects others — **19 IDs**
      (docs say 20; off-by-one flagged). Negative test passes.
- [x] Apply-all conflict resolution (§5.8) — both the spec example (2+1) and a
      fully-overlapping triple (1+2) tested.
- [x] Same-`inputsHash` returns cached `lint_data` without an LLM call — handler
      dedup short-circuits before any `callClaude`; hash mechanism unit-tested.
      (Live network "no call" is a manual check.)
- [x] `drift/*` accept → 400 `INVALID_ACTION`; dismiss succeeds — tested.
- [x] Orchestrator advances past lint when `blocking=true` — `runStage` gates only
      on `score`; lint throws nothing. (In this codebase the post-lint stages are
      seo/ab/engagement; thumbnails(9) already precedes script in `PIPELINE_ORDER`.)
- [x] Drift threshold = 40 passes, 41 fails — `passesDrift` tested.
- [x] System prompts carry `cache_control: ephemeral` (EST tokens ≥ 1024) — tested.
      (`cache_read_input_tokens > 0` on the 2nd call is a live-API manual check.)
- [x] `tone/voice-mismatch` skipped when `top_videos_json.length < 10` — `dropVoiceMismatch` tested.
- [x] CRIT-2: `claude-haiku-4-5-20251001` literal — `stageModel.lint` tested.

**Gate:** `pnpm typecheck` + `pnpm lint` clean; `pnpm test` → **128 passed** (25 new).
**Not click-tested:** the UI was built + typechecked + lint-clean but not exercised
in a browser (no browser access this session).

## Follow-ups / known gaps

- `// TODO(phase-2):` advisory locking (pg RPC) + the 30-runs/hour rate limit.
- Live verification of prompt-cache hits and the no-LLM dedup path (needs a real
  Anthropic key + a populated run).
- Stages 9–12 remain stubs; re-running lint via `runLintManual` deliberately does
  **not** cascade into them (lint has no downstream dependents).
