# PRD — Shorts Production Package

## Feature Name
Shorts Production Package

## Overview
A specialized one-shot pipeline for YouTube Shorts (vertical short-form video). Generates a tight script with visual change markers, vertical-thumbnail concept, Shorts-specific SEO metadata, performance prediction, and loop setup. Lifted from `claude-youtube`'s `shorts` subskill.

**Problem solved:** The 12-stage long-form pipeline doesn't fit Shorts. Shorts succeed via different mechanics: hook in <2s, visual change every 1–3s, looping payoff, no chapters, different thumbnail aspect ratio. A dedicated pipeline produces Shorts-appropriate output.

## User Stories
- As a creator, I want a Shorts-specific pipeline, so my Shorts kit isn't a poorly-fit version of the long-form kit.
- As a creator, I want visual change markers in my Shorts script, so I know exactly where to cut.
- As a creator, I want a loop-setup hint, so my Short re-watches and boosts retention.
- As a creator, I want vertical-thumbnail concepts, so my visual brief matches the format.

## Functional Requirements
- Input: short-form idea text, target duration (15s, 30s, 45s, 60s), niche, channel context
- Output:
  - Script: 30–150 words depending on duration, with visual-change markers `[CUT]` every 1–3 seconds
  - Cold-open: ≤2 seconds, must visually distinct
  - Loop setup: how the last 1–2 seconds tie back to the opening, encouraging re-watch
  - Vertical thumbnail brief (9:16 aspect ratio): composition, color palette, overlay text
  - Shorts metadata: title (≤ 100 chars), description (200–300 chars), hashtags (3–5, including #Shorts)
  - Performance prediction: predicted view multiple vs. channel Shorts median
- Persist to `shorts_runs` table (separate from `pipeline_runs`)
- Single combined run, not 12 stages — Shorts moves too fast for staged review

## User Interface

### Screens
- **`/shorts/new`**: input form (idea + duration)
- **`/shorts/[runId]`**: results view with script, thumbnail brief, metadata, prediction in a single view
- **`/shorts`**: history list

### Layout
- Single-column results page; no stage cards
- Script with visual-change markers rendered in a stylized way (e.g., each `[CUT]` as a horizontal divider)
- Loop-setup callout at the bottom
- Copy controls per section

### Key interactions
- Submit idea + duration → streaming output → results
- Per-section copy
- Regenerate the entire package

## States to Handle

### Happy path
User submits → package generates → all sections rendered.

### Error states
- LLM error → retry per CLAUDE.md EXT-3
- Idea is clearly long-form (e.g., "10-minute documentary on…") → flag mismatch; suggest using long-form pipeline instead

### Empty states
- No prior Shorts runs → CTA "Drop your first Short idea"

### Loading states
- Streaming progress with brief sub-steps

## Edge Cases
- Duration target is too short for the topic → flag and suggest a longer Short
- Topic is sensitive → loop-setup avoids sensational re-watch hooks
- Channel has no Shorts history → prediction uses niche baseline
- Vertical-format-only platforms (TikTok, Reels) → not supported in v1; YouTube Shorts only
- Multi-cut scripts that exceed visual production budget → flag and offer a lower-cut variant

## Out of Scope
- Generating Shorts from clips of long-form videos (Feature #22 cross-platform repurposing handles this)
- Auto-uploading to YouTube
- Music/audio recommendations
- Trending sound integration
- Vertical video AI generation (Phase 3+)
- Multi-platform posting (TikTok, Instagram)
