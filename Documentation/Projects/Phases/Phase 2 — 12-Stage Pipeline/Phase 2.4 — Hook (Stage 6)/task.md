# Phase 2.4 — Cold-open hook (Stage 6)

**Parent:** Phase 2 — 12-Stage Pipeline
**Status:** Complete
**Estimated:** 5-7 hours
**Depends on:** Phase 2.3 (≥1 locked title)
**Spec:** `Documentation/Overviews and Summaries/07-cold-open-hook/spec.md`

## Goal

Haiku 4.5 generates 3 cold-open hook variants, each ≤30 seconds spoken (≤75 words at 150 WPM). Timestamped beats with B-roll cues. Retention prediction heuristic + dropoff risk rating. User locks one variant which becomes script Section 0.

## What to Build

### Step 1 — Data layer
- `lib/validation/hook.ts`: `HookBeatSchema = {timeSec, line, brollCue (italic-rendered)}`. `HookArchetypeEnum = ['shock', 'question', 'demonstration', 'declaration', 'reversal']`. `HookVariantSchema = {beats: HookBeat[], openerStrengthRaw (model self-reported), archetype, wordCount (TS-computed), speakTimeSec (TS-computed), retention30sPredict 0-100 (TS-computed), dropoffRiskRating ('low'|'medium'|'high', TS-computed), warnings: WarningTag[], linkedTitleIndex 0|1|2}`. `HookDataSchema = {variants: HookVariant[3], lockedVariantIndex: 0|1|2|null, allHighRisk: bool, lockedAt}`.

### Step 2 — Service + prompt
- `lib/prompts/hook.ts`: Haiku 4.5 system prompt with `cache_control`. Attribution `// Adapted from AgriciDaniel/claude-youtube (MIT) — sub-skills/hook.md`. Hook structure rubric: opener ≤2s + payoff promise + tension spike + setup transition.
- `lib/services/hook.ts`: single Anthropic call returns beats + promise + reasoning + openerStrengthRaw + archetype. TS computes wordCount, speakTimeSec (wordCount/2.5 wps), retention30sPredict (archetype prior + opener strength + word-count penalty + concrete-claim bonus + anti-pattern penalty + setup-transition bonus), dropoffRiskRating (derived from retention with "killer combination" override forcing high), warnings tags (over-word-limit, no-concrete-promise, archetype-duplicate, killer-combo). Server-side simulated streaming.
- Set-equality enforcement: `linkedTitleIndex` across 3 variants must form set {0,1,2}; if duplicate, single re-prompt with stricter diversity instruction.

### Step 3 — API endpoints
- `POST /api/pipeline/hook { runId }` SSE — emits 3 progress events + complete.
- `POST /api/pipeline/hook/regenerate { runId, variantIndex }` — in-place per-variant SSE.
- `POST /api/pipeline/hook/lock { runId, variantIndex }` — sets `lockedVariantIndex`.
- `DELETE /api/pipeline/hook/lock { runId }` — clears `lockedVariantIndex`.

### Step 4 — UI
- 3 hook variant cards with timestamped beat lines (`0:00`, `0:03`, `0:07` style M:SS pills), B-roll cues in italic `text-ink-400`.
- Metrics row: word count, speak time, retention sparkline (decorative, real curves are Feature #15), trigger archetype badge.
- Warning pills: rose for killer-combo / all-high-risk; amber for over-word-limit / no-concrete-promise.
- Lock-in button per card (CTA color matches linked title's trigger). Divergent-lock soft warning when locked-title-trigger ≠ locked-hook-trigger.

### Step 5 — Integration & testing
- `ALL_HIGH_RISK` is non-blocking — variants persist, stream completes, warning surfaces as `allHighRisk: true` + amber banner.
- Set-equality re-prompt path: duplicate `linkedTitleIndex` triggers exactly 1 retry, then accepts with warning.
- Divergent locked-title-vs-locked-hook: persists with soft warning; Stage 7 follows the hook's linked title.
- Stage 7 reads locked hook as `script.sections[0].paragraphs[0]` (verbatim).
- TS-computed fields are not from model: `retention30sPredict`, `dropoffRiskRating`, `wordCount`, `speakTimeSec`, `warnings`, `allHighRisk`.

## Cross-feature contracts

- Reads `pipeline_runs.titles_data` (≥1 locked), `idea_text`, `competitor_data`, `channels.niche`.
- Writes `pipeline_runs.hook_data` — consumed by Stage 7 (script's opening).
- Closed `HookArchetypeEnum` shared with Stage 7 (script can reference it but doesn't depend on it).

## Verification

- [ ] All 3 variants `linkedTitleIndex` form set {0,1,2}; duplicate fires re-prompt exactly once
- [ ] `retention30sPredict`, `dropoffRiskRating`, `wordCount`, `speakTimeSec`, `allHighRisk` computed in TS — not read from model output
- [ ] Lock endpoint sets exactly one `variant.lockedIn = true` and updates `lockedVariantIndex`
- [ ] `ALL_HIGH_RISK` returns 200 OK with `allHighRisk: true` (not error)
- [ ] System prompt has `cache_control`; 2nd hook call shows cache hit
- [ ] CRIT-2: `claude-haiku-4-5-20251001` model literal verified
- [ ] CRIT-4 attribution comment in `lib/prompts/hook.ts`
- [ ] Stage 7 reads `hook_data.variants[lockedVariantIndex].beats` as script section[0]

## Out of scope

- Real retention curve (decorative sparkline only; Feature #15 ships real curve)
- Per-variant history (Phase 2; overwrite in place for Phase 1)
- Auto-lock on stage completion (orchestrator waits for explicit user lock before Stage 7)
