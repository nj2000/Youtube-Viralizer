# PRD — Cross-Platform Repurposing

## Feature Name
Cross-Platform Repurposing

## Overview
Takes a generated long-form kit and produces derivative outputs for other platforms: Shorts clip suggestions (timestamped from the script), blog outline, LinkedIn post, X (Twitter) thread, email newsletter draft, podcast outline, and community post. One source video → seven downstream pieces of content. Lifted from `claude-youtube`'s `repurpose` subskill.

**Problem solved:** Creators waste their best content by publishing it once on YouTube and never repurposing. The long-form video has 10× the embedded value if extracted. This stage automates the extraction.

## User Stories
- As a creator, I want my long-form video repurposed automatically, so I get more reach without more filming.
- As a creator, I want each platform's output formatted natively (X thread vs. LinkedIn post are not the same), so I can post directly without rewriting.
- As a creator, I want Shorts clip suggestions with timestamps, so I know exactly which 30s of the long-form to cut.
- As a creator, I want to skip platforms I don't use, so the output isn't bloated.

## Functional Requirements
- Input: completed `pipeline_runs` row (script + title + thumbnail brief)
- Outputs:
  - **Shorts clips**: 3 suggested timestamps + clip script + caption (each 15–60s)
  - **Blog outline**: H1, H2 sections, key points per section, suggested intro and outro
  - **LinkedIn post**: 1200–1800 chars, hook line, story arc, CTA-light close
  - **X thread**: 6–12 tweets, each ≤ 280 chars, threaded narratively
  - **Email newsletter**: subject line, preview text, body (300–600 words), CTA
  - **Podcast outline**: episode title, talking-point bullets, intro and outro hooks (assumes 15–30 min audio adaptation)
  - **Community post (YouTube)**: 200–500 chars cross-promoting the long-form
- Per-platform toggles: user enables only the platforms they use
- Persist `repurpose_data` per run

## User Interface

### Screens
- New tab on `/runs/[runId]`: "Repurpose" tab next to the main pipeline view
- Each platform output is a separate sub-card
- Per-platform copy buttons + character counts

### Layout
- Tab interface within the run view
- Platform-by-platform sub-cards with native formatting where possible (e.g., X thread shown as connected tweets)
- Copy or regenerate per-platform

### Key interactions
- Toggle platforms on/off in user settings
- Copy each output natively
- Regenerate per platform

## States to Handle

### Happy path
User clicks "Repurpose" tab → platform outputs generate → rendered.

### Error states
- Source kit incomplete (missing script) → cannot repurpose; route user to complete the kit first
- LLM error → retry per CLAUDE.md EXT-3
- Per-platform char-limit violations → truncate at boundary, flag

### Empty states
- No platforms enabled → CTA "Enable platforms in settings to generate repurposed content"

### Loading states
- Per-platform sub-card spinner

## Edge Cases
- Long-form video is highly visual (relies on screen recording) → blog and podcast outlines may be weak; flag
- Shorts clip suggestions overlap or exceed the script's actual length → cap to non-overlapping, fit within script
- Email newsletter intersects with channel's separate newsletter strategy → produce as draft, user adapts
- X thread exceeds character limits per tweet → split or trim
- LinkedIn post tone clashes with creator's professional vs. casual brand → match channel voice samples

## Out of Scope
- Auto-posting to any platform
- Scheduling across platforms
- TikTok, Instagram Reels, Facebook (v1 is the listed seven platforms only)
- Translating outputs to other languages
- Image/asset generation per platform (Phase 3)
- Analytics tracking across platforms
