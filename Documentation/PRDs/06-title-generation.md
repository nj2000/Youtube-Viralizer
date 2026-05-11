# PRD — Title Generation (Stage 5)

## Feature Name
Title Generation

## Overview
Generates three title variants for the user's idea, each explicitly labeled with a different psychological trigger (curiosity gap, fear, specific result), plus an intent-specific-language rewrite that converts generic phrasing into the kind of language YouTube's NLP matches to specific audience clusters.

**Problem solved:** Most creators write one title and ship. They have no way to A/B test angles meaningfully because they only generated one option. This stage forces three deliberately different angles, so the downstream A/B test (Stage 11) yields real learning instead of random variation.

## User Stories
- As a creator, I want three titles each engineered for a different psychological trigger, so my A/B test produces real signal about what works for my audience.
- As a creator, I want my titles rewritten in intent-specific language, so YouTube matches them to the right audience cluster.
- As a creator, I want each title labeled clearly, so I know which trigger it tests.
- As a creator, I want titles to stay under YouTube's 100-character limit, so they don't truncate in the feed.
- As a creator, I want titles to feel like *me*, not generic AI output.

## Functional Requirements
- Input: idea text, score rationale (Stage 4), competitor outlier patterns (Stage 3), channel niche, channel's recent video titles (for voice-matching)
- Output: exactly 3 titles, each with:
  - Title text (≤ 70 chars target, hard limit 100)
  - Trigger label: `curiosity` | `fear` | `result`
  - One-sentence rationale explaining the trigger choice
- Plus an intent-rewrite metadata: for each title, a paragraph explaining how the language matches a specific audience cluster
- Persist `titles_data` to `pipeline_runs` row
- Re-generation produces 3 *new* options (must differ meaningfully from prior set if previously generated)
- Voice-matching: titles should echo verbal patterns observed in the channel's existing videos

## User Interface

### Screens
Renders as a card within `/runs/[runId]`.

### Card layout
- Header: "Title Variants" + status + "Regenerate" button
- 3 title cards stacked, each showing:
  - Trigger badge (color-coded: curiosity = purple, fear = red, result = green)
  - Title text in large readable font
  - Character count (e.g., "62/100")
  - Expandable rationale and intent-cluster explanation
  - Copy-to-clipboard button on each title

### Key interactions
- Click a title to copy
- Expand a title's rationale to read the trigger and audience-cluster reasoning
- "Regenerate" produces a fresh set of 3

## States to Handle

### Happy path
Stage runs → 3 titles generated → all under char limit → rendered with badges.

### Error states
- LLM returns fewer than 3 titles → re-prompt once; if still fewer, render what was returned with warning
- LLM returns titles over 100 chars → truncate at word boundary, flag in UI
- LLM returns titles missing trigger labels → re-prompt with explicit format instruction
- All three titles use the same trigger (LLM ignored diversity requirement) → re-prompt with stricter instruction

### Empty states
- Not applicable — stage either succeeds or errors.

### Loading states
- Card shows spinner with text "Generating three angles…"

## Edge Cases
- Idea topic is sensitive (death, illness, finance) → fear-trigger title must avoid clickbait; rationale should reflect ethical framing
- Channel has no recent videos to match voice → fall back to niche-typical voice with a warning
- Idea contains a brand name or trademark → preserve verbatim, do not paraphrase
- Idea contains numbers or specifics that should be preserved (e.g., "$1000 in 30 days") → numbers must appear in the result-trigger title
- Channel's existing voice is highly informal or includes signature phrases → match informality without forcing signatures
- All three trigger options would produce nearly identical phrasing for the topic → generate three but flag low diversity
- User regenerates 5+ times → after 3 regenerations, suggest the user revise the idea text rather than keep regenerating

## Out of Scope
- Multi-language title generation
- Emoji insertion (left to user discretion)
- Title localization for different regions
- Searching YouTube for already-existing identical titles to avoid collision
- Sentiment scoring of titles
- Generating 5+ angles (v1 is exactly 3 to match YouTube's native A/B testing slot count)
