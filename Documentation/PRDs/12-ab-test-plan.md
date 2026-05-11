# PRD — A/B Test Plan with Measurement (Stage 11)

## Feature Name
A/B Test Plan with Measurement

## Overview
Generates an explicit testing plan for the three title-thumbnail variants from Stages 5 and 9, naming which psychological signal each variant tests and what the creator should learn from the result. YouTube's native A/B testing picks a winner by watch time, but doesn't tell you *why* — this stage frames the test so the result produces transferable learning, not just a one-time choice.

**Problem solved:** Creators run A/B tests with near-identical variants and learn nothing. Or they pick a winner without understanding why it won, then can't apply the lesson to future videos. This stage forces hypothesis-driven testing.

## User Stories
- As a creator, I want a test plan that names the hypothesis behind each variant, so I learn something about my audience from each test.
- As a creator, I want to know which variant to ship if I can't run a test, so the system makes a recommendation by default.
- As a creator, I want the plan to specify how long to run the test, so I don't pull it too early or late.
- As a creator, I want guidance on what to do with the result, so the test outcome translates into next-video decisions.

## Functional Requirements
- Input: 3 titles (Stage 5), 3 thumbnails (Stage 9), idea text, channel size hint
- Output:
  - Hypothesis statement per variant: which trigger or visual element each tests (e.g., "Tests whether fear-driven titles outperform curiosity for this audience")
  - Recommended ship-default: which single variant to use if no A/B test is run + reasoning
  - Test duration recommendation: based on channel velocity (e.g., "run 7 days" for high-velocity channels, "14 days" for slower)
  - Sample-size note: realistic expectation of how confident the result will be at the user's typical view volume
  - Decision rule: how to interpret the result (e.g., "if curiosity variant wins by ≥10% lift, generalize to next 5 videos and re-test")
  - Cross-test learning: what the result will tell you about the channel's audience
- Persist `ab_plan_data` to `pipeline_runs` row

## User Interface

### Screens
Renders as a card within `/runs/[runId]`.

### Card layout
- Header: "A/B Test Plan" + status + "Regenerate"
- Recommended-default callout at top (which variant to ship if not testing)
- 3 variant cards (matching titles + thumbnails by index), each showing:
  - Variant label (1, 2, 3)
  - Hypothesis (one sentence)
  - What you'll learn if this wins
- Test mechanics: duration, expected confidence, decision rule
- Cross-test learning summary

### Key interactions
- Copy plan as markdown for storage in the user's own notes
- Click a variant to highlight matching title + thumbnail in their respective stage cards

## States to Handle

### Happy path
Stage runs → plan generated → rendered with hypotheses and decision rules.

### Error states
- Stages 5 or 9 missing → error: "A/B plan requires titles and thumbnails. Re-run earlier stages."
- LLM returns plan missing decision rule or hypothesis → re-prompt
- Channel size unknown (subscriber count is null) → use generic confidence guidance

### Empty states
- Not applicable.

### Loading states
- Card shows spinner with text "Engineering the A/B plan…"

## Edge Cases
- Channel is too small to reach statistical significance in any reasonable timeframe → plan recommends shipping the default variant + collecting data over multiple videos
- Channel has YouTube's native A/B testing disabled (eligibility) → plan provides manual swap-after-N-days alternative
- Variants 1 and 2 are nearly identical post-generation → plan flags low diversity and recommends regenerating titles/thumbnails
- User has existing data showing a strong preference for one trigger (e.g., always curiosity) → plan acknowledges and suggests testing a less-comfortable variant for learning value
- Channel is in a niche where audience prefers very stable branding → plan suggests testing one variant against the channel default rather than three new variants

## Out of Scope
- Actually running the A/B test (YouTube does this natively or in YouTube Studio)
- Tracking the test result inside our app (no integration with YouTube Analytics in v1)
- Calibration loop based on test outcomes (Feature #17, Phase 2)
- Multi-variate testing beyond title+thumbnail
- Statistical analysis of historical channel test results
