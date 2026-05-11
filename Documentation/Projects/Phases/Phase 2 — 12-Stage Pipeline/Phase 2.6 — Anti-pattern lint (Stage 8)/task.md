# Phase 2.6 — Anti-pattern lint + drift (Stage 8)

**Parent:** Phase 2 — 12-Stage Pipeline
**Status:** Not Started
**Estimated:** 5-7 hours
**Depends on:** Phase 2.5 (script_data)
**Spec:** `Documentation/Overviews and Summaries/09-antipattern-lint-drift/spec.md`

## Goal

Haiku 4.5 scans the script + titles for 20 closed-set anti-pattern rules + a separate drift-check pass comparing locked title to first 25% of script. Issues are accept/dismiss/apply-all. Non-blocking — orchestrator advances to Stage 9 regardless. Auto-triggered after Stage 7.

## What to Build

### Step 1 — Data layer
- `lib/validation/lint.ts`: `LintRuleIdSchema` closed enum of exactly 20 IDs (cliche/welcome-back, cliche/dont-forget-to-subscribe, cliche/in-this-video, ai-tell/it-is-important-to-note, ai-tell/excessive-em-dash, ai-tell/delve-into, ai-tell/in-conclusion, hostage-engagement/like-and-subscribe-or-else, keyword-vomit/repeated-primary-keyword, pacing/over-15s-without-cut, pacing/wall-of-text, drift/title-promise-not-met-by-2min, drift/topic-shift-mid-section, seo/keyword-once, retention/no-rehook-at-section-break, retention/missing-loop-payoff, hook/over-30s, structure/missing-cold-open-marker, tone/voice-mismatch — exact 20). `LintSeveritySchema = z.enum(['error','warning','info'])`. `LintIssueSchema = {id, ruleId, severity, sectionIndex, lineRange:{start,end}, excerpt, suggestedFix, accepted, dismissed}`. `LintDataSchema = {issues, drift: {score 0-100, problemDescription?}, summary: {errors, warnings, infos, blocking: bool, passed: bool}, schemaVersion: z.literal(1)}` with cross-check that derived `blocking` matches `errors > 0`.

### Step 2 — Rule taxonomy + drift
- Constants in `lib/services/lint/rules.ts`: `RULE_SPECS[]` with pattern + suggestedFix template per rule. `LINT_THRESHOLDS` (em-dash >1 per paragraph, primary-keyword >3× in first 100 words, no-cut >15s, wall-of-text >200 words, drift threshold 40, voice-mismatch requires ≥10 top videos).
- `lib/services/lint/drift.ts`: separate Haiku call comparing locked title to first 25% of script word count, returns drift score + problemDescription. `extractOpening` helper. `computeInputsHash` (script+titles+hook hash for auto-trigger dedup).

### Step 3 — Service + prompt
- `lib/prompts/lint.ts`: Haiku 4.5 system prompt with `cache_control` (≥1024 tokens, all rule definitions + examples). Attribution `// Synthesized from claude-youtube/sub-skills/script.md + seo.md (MIT — Daniel Agrici)`.
- `lib/services/lint.ts`: two-pass orchestrator — anti-pattern Haiku call + drift Haiku call (separate calls for prompt-cache cleanliness). Auto-trigger from Stage 7 completion checks `inputsHash` dedup (skip if cached lint matches).
- `applyAllFixes` algorithm (spec §5.8): sort issues by `lineRange.start` ascending → greedily accept by original-range non-overlap → apply patches in descending order to keep offsets stable → auto-dismiss conflicting issues.
- `drift/accept` is invalid — drift fixes require Stage 7 re-run, not substring patch. UI offers "Re-run Stage 7", "Re-pick title", "Override & continue".

### Step 4 — API endpoints
- `POST /api/pipeline/lint { runId }` SSE (auto-triggered from Stage 7).
- `POST /api/pipeline/lint/rerun { runId, force? }` SSE — bypass inputsHash dedup with `force=true`; returns `NO_CHANGES` if same inputs.
- `POST /api/pipeline/lint/issue { runId, issueId, action: 'accept'|'dismiss' }` — drift issues reject accept with 400.
- `POST /api/pipeline/lint/apply-all { runId }` — greedy non-overlap conflict resolution.
- `POST /api/pipeline/lint/skip { runId }` + `POST /api/pipeline/lint/override { runId }` — advance pipeline despite blocking issues.
- Per-user 30 lint runs/hour rate limit.

### Step 5 — UI
- LintCard variants: streaming (per-rule scan progress), clean (zero issues, green pass), with issues (issue rows with severity badge, excerpt with highlighted offending text bg-rose-500/15 or bg-amber-500/15, suggested rewrite preview, accept/dismiss/edit-in-script buttons), drift detected (separate amber banner from rule issues; "Re-run Stage 7" CTA primary).
- Summary stats at top: total issues, breakdown by severity, "would block publish? yes/no" pill (presentational only — orchestrator advances anyway).
- "Skip lint & continue" + "Override & continue" CTAs visible.

### Step 6 — Integration & testing
- Stage 8 is non-blocking: orchestrator advances to Stage 9 even when `summary.blocking=true`.
- Auto-trigger from Stage 7 with same inputsHash returns cached `lint_data` without LLM call.
- Apply-all on overlapping issues produces non-overlapping accepted set + auto-dismissed set (spec §5.8 worked example).
- `drift/*` rules reject accept (400); dismiss valid.
- `LintRuleIdSchema` rejects unknown IDs (verified by negative test on 20 known + 1 unknown).
- Drift score ≤40 passes; >40 sets `passed=false` on summary.

## Cross-feature contracts

- Reads `pipeline_runs.script_data`, `titles_data` (locked), `hook_data` (locked).
- Writes `pipeline_runs.lint_data` — consumed by Feature #18 future (forbidden phrases) but not by other pipeline stages.
- `pipeline_runs.status` does NOT transition to error on lint issues — Stage 8 is purely advisory.

## Verification

- [ ] `LintRuleIdSchema` accepts exactly 20 IDs and rejects others (negative test)
- [ ] Apply-all on 3 overlapping issues produces 1 accepted + 2 auto-dismissed (spec §5.8 example)
- [ ] Auto-trigger with same inputsHash returns cached `lint_data` without LLM call (network-level verified)
- [ ] `drift/*` issue with `action: 'accept'` returns 400 BLOCKED; `action: 'dismiss'` succeeds
- [ ] Orchestrator advances to Stage 9 even when `lint_data.summary.blocking = true`
- [ ] Drift threshold = 40: score 40 passes, 41 sets passed=false
- [ ] System prompt has `cache_control: ephemeral`; 2nd call shows `cache_read_input_tokens > 0`
- [ ] `tone/voice-mismatch` rule silently skipped when `channels.top_videos_json.length < 10`
- [ ] CRIT-2: `claude-haiku-4-5-20251001` literal verified

## Out of scope

- Niche-specific rules (Feature #18 extends forbidden_phrases)
- Open-set rules (schemaVersion 1 hard-codes 20 IDs; Phase 2 may relax)
- Auto-rewrite engine (UI shows suggested rewrite; user accepts patch manually)
