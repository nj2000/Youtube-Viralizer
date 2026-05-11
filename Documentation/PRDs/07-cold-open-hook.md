# PRD — Cold-Open Hook Generator (Stage 6)

## Feature Name
Cold-Open Hook Generator

## Overview
Generates three first-30-seconds hook variants for the chosen video, each tied to one of the three title angles from Stage 5, plus a drop-off-risk rating per variant. The cold-open is where 33% of viewers leave if it's weak — this stage engineers it tightly.

**Problem solved:** Creators default to "hey guys welcome back" intros that bleed audience in the first 8 seconds. The hook generator produces openings that earn the viewer's attention by Sec 30, with explicit drop-off risk feedback so the creator picks consciously.

## User Stories
- As a creator, I want three hook options matched to my three titles, so the chosen title and hook are coherent.
- As a creator, I want each hook scored for drop-off risk, so I know which is safest to film.
- As a creator, I want hooks short enough to film in one take, so I'm not over-engineering my intro.
- As a creator, I want hooks that don't sound AI-generated, so my audience doesn't disengage from synthetic phrasing.

## Functional Requirements
- Input: 3 titles (from Stage 5), idea text, niche, optional channel voice samples
- Output: 3 hook variants, each with:
  - Hook text (target 50–80 words, ≈30s spoken)
  - Linked title (1:1 mapping to Stage 5 titles by index)
  - Drop-off risk rating: `low` | `medium` | `high`
  - Risk rationale (one sentence)
  - Hook archetype label: `shock` | `problem-agitation` | `story` | `curiosity-gap` | `social-proof`
- Persist `hook_data` to `pipeline_runs` row
- Each hook must avoid the anti-patterns: "hey guys welcome back," "make sure to like and subscribe before we get into it," meta-statements about the video itself
- Hooks must include a concrete promise that the rest of the video must fulfill (used by Stage 8 drift check)

## User Interface

### Screens
Renders as a card within `/runs/[runId]`.

### Card layout
- Header: "Cold-Open Hooks" + status + "Regenerate"
- 3 hook cards in same order as titles, each showing:
  - Linked title (small, top of card)
  - Hook text in readable typography
  - Drop-off risk badge (color: low=green, medium=yellow, high=red)
  - Archetype label
  - Risk rationale (expandable)
  - Word count + estimated speak time
  - Copy-to-clipboard button

### Key interactions
- Hooks are scannable side-by-side or stacked
- Copy a hook with one click
- Regenerate produces a new set tied to the same 3 titles

## States to Handle

### Happy path
Stage runs → 3 hooks generated → each tied to a title → rendered with risk badges.

### Error states
- Stage 5 titles missing → error: "Hooks require titles. Re-run Stage 5 first."
- LLM returns hook over word limit → flag in UI but render
- LLM returns hook missing archetype label → re-prompt once
- All three hooks rated `high` risk → re-prompt; if persistent, surface clearly so user knows the idea may not have a good hook

### Empty states
- Not applicable.

### Loading states
- Card shows spinner with text "Engineering three intros…"

## Edge Cases
- Topic is technical and requires exposition before payoff → use story or problem-agitation archetype, not shock
- Topic is sensitive → shock archetype must be subtle; never sensationalize
- Hook contains a claim that's hard to verify → flagged in rationale so creator can substantiate in script
- Channel voice is highly conversational with signature catchphrases → preserve catchphrases verbatim if they appear in voice samples
- Hook would require b-roll the creator can't realistically capture → this is acceptable; hook decisions about feasibility are creator's call
- All three hooks accidentally use the same archetype → re-prompt with stricter diversity requirement

## Out of Scope
- Scripting the visual cuts or b-roll for the hook
- Generating teleprompter-formatted text
- Predicting actual viewer retention curves (handled in Phase 2 AVD predictor)
- Generating Shorts-specific hooks (separate flow in #21)
- Voice cloning or audio generation
