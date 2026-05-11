# PRD — Competitor Outlier Analysis (Stage 3)

## Feature Name
Competitor Outlier Analysis

## Overview
The first content stage of the pipeline. Pulls live YouTube data on competitor channels in the user's niche, identifies videos that performed at 5×+ their publishing channel's median over the last 30 days, and extracts what made each outlier different from that channel's normal output. Outputs feed downstream stages (scoring, titles, hook, script).

**Problem solved:** Creators currently scroll through competitor channels manually for hours, eyeballing which videos popped. They miss subtle patterns and rely on vibes. This stage automates the search and adds a *delta extraction* — the algorithm-relevant difference between the outlier and that channel's baseline.

## User Stories
- As a creator, I want to see which videos in my niche just popped, so I can ride patterns the algorithm is currently rewarding.
- As a creator, I want to understand *why* an outlier performed better than that channel's normals, so I can transfer the pattern to my own video.
- As a creator, I want outliers limited to my niche, so I'm not distracted by viral videos from unrelated topics.
- As a creator, I want this analysis to take 30 seconds, not 4 hours.

## Functional Requirements
- Run scoped to the active channel's stored competitor set
- Search YouTube Data API for videos from each competitor channel published in the last 30 days
- For each candidate video, fetch view count, duration, publish date, title, description, thumbnail URL
- Compute the publishing channel's median view count from its recent uploads (cached per competitor)
- Filter to videos where `views ≥ 5 × publishing_channel_median`
- Cap to top 15 outliers ranked by view-multiple
- For each outlier, run delta extraction via LLM: compare title, format, length, thumbnail style against that channel's normal output
- Persist `competitor_data` JSON to the `pipeline_runs` row containing: outliers list (with title, channel, views, multiple, thumbnail URL, publish date) and delta extraction per outlier
- Emit summary patterns: most common emotional triggers, most common length bucket, most common title structure
- All YouTube calls go through the cached wrapper per CLAUDE.md CRIT-1

## User Interface

### Screens
This stage renders as a card within `/runs/[runId]`. Not a standalone page.

### Card layout
- Header: "Competitor Outliers" + status indicator + "Regenerate" button when complete
- Summary line: "Found N outliers in last 30 days, average X× channel median"
- Pattern callouts: chips for top emotional triggers, length bucket, title structure
- Outlier list: scrollable list of cards, each showing thumbnail, title, channel, view multiple, publish date, expandable delta extraction
- Click on outlier opens its YouTube URL in new tab

### Key interactions
- Outlier cards are scannable at a glance; details expand on click
- "Regenerate" re-runs the search with fresh data (warns if cache is recent)

## States to Handle

### Happy path
Stage runs → YouTube cached search returns candidates → median computed → filter applied → top 15 selected → LLM extracts deltas → result rendered.

### Error states
- Zero outliers found in last 30 days → not an error; render "No outliers in your niche this month" with suggestion to re-run later
- Competitor set is empty → stage cannot run; route user to onboarding to add competitors
- YouTube API quota exceeded → stage errors with quota-friendly message; pipeline halts with retry option
- LLM delta extraction fails for individual outliers → render outlier without delta; flag the missing extraction
- Cache returns stale data older than its TTL → re-fetch transparently

### Empty states
- No outliers found → empty-list message with reasoning ("Your competitor set hasn't published 5× outliers in the last 30 days")
- Competitor set has only 1–2 channels → still run, but warn the user that statistical signal is weak

### Loading states
- Card shows spinner with sub-step text: "Scanning N competitor channels…", "Computing baselines…", "Finding outliers…", "Extracting patterns…"

## Edge Cases
- Competitor channel was deleted or made private since onboarding → skip with a warning, don't fail the stage
- Competitor channel has fewer than 10 videos in last 30 days → use 90-day median as fallback
- A single channel produces all 15 outliers → cap at 5 per channel to maintain diversity
- Outlier video is a YouTube Short (<60s) → flag separately; do not blend with long-form outliers
- Outlier video is a livestream VOD with anomalous view count → flag and demote
- View-count race: video published <72h ago has views inflating quickly → use a recency-weighted multiple, not raw current views
- All outliers in the niche are from one creator dominating → render with explicit dominance warning
- User just onboarded; competitor set is auto-suggested but not validated → run anyway, results may be lower quality

## Out of Scope
- Real-time alerts when a new outlier appears (Phase 2)
- Building the outlier corpus across all niches for training the hybrid scorer (Feature #14, separate cron)
- Tracking outlier performance over time
- Suggesting new competitors to add based on adjacent-niche outliers
- Pulling competitor analytics that require OAuth (CTR, AVD)
- Translating non-English outliers
