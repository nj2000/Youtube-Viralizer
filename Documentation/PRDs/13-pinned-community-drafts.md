# PRD — Pinned Comment + Community Post Drafts (Stage 12)

## Feature Name
Pinned Comment + Community Post Drafts

## Overview
Generates a pinned-comment text engineered to spark replies and a community-tab post engineered to tease the upcoming video before publish. Both extend engagement signals beyond the video itself, which the algorithm rewards.

**Problem solved:** Most creators ignore pinned comments and community posts entirely, leaving easy engagement and pre-publish hype on the table. When they do post, they default to "What did you think?" — generic and low-engagement.

## User Stories
- As a creator, I want a pinned comment that asks a specific question tied to my video, so viewers reply with substance.
- As a creator, I want a community post draft I can publish before the video to tease it, so I prime my subscribers to watch.
- As a creator, I want both drafts written in a voice that fits my channel, so they don't feel generic.
- As a creator, I want each draft short enough to use as-is, so I'm not editing for 10 minutes.

## Functional Requirements
- Input: chosen title (Stage 5), script (Stage 7), niche, channel voice samples (if available)
- Outputs:
  - Pinned-comment draft: 1–3 sentences, ends with a specific question (not a generic ask), avoids hostage engagement language
  - Community-post draft: 2–5 sentences for pre-publish teaser, includes one open-loop question or claim referencing the video without spoiling it
  - Both with clear voice match
  - Optional poll suggestion for the community post (if niche supports it): 2–4 poll options
- Persist `engagement_drafts_data` to `pipeline_runs` row
- Drafts must avoid: "smash that like button," "if you enjoyed," generic "let me know in the comments"

## User Interface

### Screens
Renders as a card within `/runs/[runId]`. Lowest priority within Phase 1; ship after stages 1-11 are stable.

### Card layout
- Header: "Engagement Drafts" + status + "Regenerate"
- Two sub-sections: Pinned Comment, Community Post
- Each shows draft text + character count + copy button
- Poll suggestion (if generated) shown as a separate sub-card

### Key interactions
- Copy each draft individually
- Regenerate produces new versions

## States to Handle

### Happy path
Stage runs → both drafts generated → rendered with copy buttons.

### Error states
- Title or script missing → error: "Drafts require title and script. Re-run earlier stages."
- LLM returns draft with hostage-engagement language → Stage 8 lint patterns are applied here too; re-prompt if matched
- Draft too long → truncate at sentence boundary, flag

### Empty states
- Not applicable.

### Loading states
- Card shows spinner with text "Drafting engagement copy…"

## Edge Cases
- Niche where polls are inappropriate (sensitive topics) → omit poll, render only post text
- Topic is too internal or technical for community engagement → drafts simpler, less question-heavy
- Channel doesn't use community tab actively → still generate; user can ignore
- Pinned comment idea overlaps with the video's CTA → re-prompt for distinctness
- Voice samples unavailable → drafts default to platform-typical informal voice

## Out of Scope
- Auto-posting to YouTube community tab via API
- Scheduling community posts
- Multiple draft variants per type (single best draft only in v1)
- Reply templates for likely viewer comments
- Sentiment monitoring of replies
- Generating Stories or other YouTube formats
