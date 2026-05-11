# PRD — Anti-Pattern Lint + Title-Transcript Drift Check (Stage 8)

## Feature Name
Anti-Pattern Lint + Title-Transcript Drift Check

## Overview
Scans the generated script for the specific 2026-algorithm anti-patterns (filler intros, keyword vomit, hostage-negotiation engagement asks) and verifies that the first two minutes of the script actually deliver on the chosen title's promise. Surfaces issues before the user films instead of after publish.

**Problem solved:** YouTube's NLP penalizes mismatch between title and spoken content. This stage catches it pre-production. Anti-patterns also slowly bleed retention; the lint forces the script to clean up.

## User Stories
- As a creator, I want my script automatically checked for retention-killing patterns, so I don't film something the algorithm will penalize.
- As a creator, I want to know if my script doesn't deliver on my title within the first 2 minutes, so I can rewrite before filming.
- As a creator, I want each issue surfaced with the exact location in the script, so I can fix it quickly.
- As a creator, I want lint issues categorized by severity, so I know what's critical to fix vs. nice-to-have.

## Functional Requirements
- Input: chosen title (Stage 5), chosen hook (Stage 6), full script (Stage 7)
- Lint checks (each returns matched location + severity):
  - `filler-intro`: matches "hey guys welcome back," "what's up everybody," "today we're going to be talking about" patterns
  - `engagement-hostage`: matches "smash that like button," "hit subscribe before we get into it," upfront engagement demands
  - `keyword-vomit`: detects spammy keyword stacking (more than 3 niche keywords in same sentence)
  - `meta-statement`: "in this video we will cover" type statements that delay payoff
  - `vague-promise`: title-promise language not matched in first 2 minutes
- Drift check: extract title's core promise, scan first ~300 words of script, return `passed` | `partial` | `failed` with explanation
- Severity scale: `critical` (will hurt algorithm), `warning` (will hurt retention), `info` (style note)
- Persist `lint_data` to `pipeline_runs` row including issue list (with location, severity, suggested fix) and drift verdict
- Lint runs automatically after Stage 7 completes
- Re-run available if user manually edits the script (post-launch flow)

## User Interface

### Screens
Renders as a card within `/runs/[runId]`, immediately after the script card.

### Card layout
- Header: "Script Quality Check" + status + "Re-run lint"
- Top-line verdict: total issue count by severity (e.g., "0 critical, 2 warnings, 1 info")
- Drift verdict badge: green (passed), yellow (partial), red (failed) with explanation
- Issue list, each row showing:
  - Severity badge
  - Issue type (e.g., "filler-intro")
  - Excerpt of the matched script text (truncated, with "show in script" link)
  - Suggested fix
- Clicking "show in script" scrolls to and highlights the script card location

### Key interactions
- Issues are scannable; click for context
- "Re-run lint" available after script regeneration

## States to Handle

### Happy path
Lint runs → 0 critical, ≤2 warnings, drift passed → green status.

### Warning path
Lint runs → 1+ warnings or partial drift → yellow status; user reviews issues.

### Error states (gating)
- 1+ critical issues OR drift failed → red status; downstream stages still run but with persistent warning banner
- LLM upstream error → retry per CLAUDE.md EXT-3
- Script missing → error: "Lint requires a script. Re-run Stage 7."

### Empty states
- No issues found → "Clean. Script passes all checks."

### Loading states
- Card shows spinner with text "Checking for retention killers…"

## Edge Cases
- Script intentionally uses "hey guys welcome back" as ironic callback → lint flags it, user can dismiss
- Channel voice includes a signature phrase that matches a filler pattern → lint flags but suggests user override based on documented voice
- Script is multi-language or includes non-English phrases → lint runs only on English content; flag non-English sections separately
- Script's title promise is implicit (artistic narrative title) → drift check uses semantic matching, not literal keyword
- User edits the script and one block now contradicts another → lint is single-pass; manual re-run picks up new issues
- All issues are below `critical` severity but the script is still bad → lint can't catch every quality issue; this is documented as a limitation

## Out of Scope
- Auto-fixing detected issues (Phase 2 — currently only flags + suggests)
- Style-of-voice analysis (matching user's actual cadence)
- Predicting retention curves from lint output (Phase 2 AVD predictor)
- Plagiarism / originality detection
- Fact-checking script claims
- Profanity filtering
- Brand-safety / advertiser-friendliness scoring
