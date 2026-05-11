# PRD — Channel Onboarding

## Feature Name
Channel Onboarding

## Overview
A one-time setup flow where the user connects their YouTube channel and the app derives the niche, top-performing videos, channel-median view count, and a competitor set. This grounds every future kit generation in the user's actual channel context instead of generic prompts.

**Problem solved:** Without channel context, every idea is scored and packaged in a vacuum. Creators currently re-describe their niche on every prompt or get generic AI output that doesn't match their audience.

## User Stories
- As a creator, I want to paste my channel URL and have the app understand my niche, so I don't have to manually re-describe my channel each time I drop an idea.
- As a creator, I want to review what the app detected about my channel before I commit, so I can correct misclassifications.
- As a creator, I want to edit my niche description if my detected niche is wrong, so kits target the right audience.
- As a returning user, I want my channel context to persist across sessions, so I'm not re-onboarded every login.
- As a multi-channel operator, I want to add multiple channels and switch between them, so I can run the pipeline against the right channel for each idea.
- As a competitor researcher, I want to onboard a channel I don't own, so I can analyze competitor positioning. (Flagged as competitor-mode, not own-channel-mode.)

## Functional Requirements
- Accept channel URL in any of: `youtube.com/@handle`, `youtube.com/channel/UC…`, `youtube.com/c/customname`, full video URL (extract channel from it)
- Validate URL format against an allowlist before any external call
- Fetch channel metadata via YouTube Data API: title, description, subscriber count, country, custom URL, total views
- Fetch the channel's last 50 public videos with view counts, durations, publish dates
- Compute the channel's median view count (used downstream as the outlier threshold)
- Extract niche from channel description + last-20 video titles via LLM
- Identify 5–10 competitor channels in the same niche via LLM-suggested search queries + YouTube search
- Persist all of the above to the `channels` table
- Allow the user to edit detected niche text after detection
- Allow the user to remove competitors from the auto-suggested list and add their own
- Support multiple channels per user account; expose an active-channel switcher

## User Interface

### Screens
1. **`/onboard` (URL input)** — single text input, "Continue" button, brief copy explaining what the app is about to fetch.
2. **`/onboard/processing`** — streaming progress with five labeled steps (validating URL, fetching channel, analyzing recent videos, extracting niche, identifying competitors). Each step shows a checkmark or spinner.
3. **`/onboard/review`** — read-only summary of detected channel + editable niche text + editable competitor list (remove with X, add with input field). "Confirm and continue" CTA.
4. **App-wide channel switcher** — dropdown in the header showing all connected channels and an "Add channel" entry.

### Key interactions
- Pasting a URL auto-detects whether it's a channel, custom URL, or video URL
- Editing the niche field is freeform text, max 200 characters
- Removing a competitor is a single click; adding one requires pasting a competitor channel URL (validated the same way)
- Clicking "Confirm and continue" routes to `/runs/new`

## States to Handle

### Happy path
URL valid → channel fetched → niche extracted → competitors identified → user reviews and confirms → `channels` row written → user routed to idea workspace.

### Error states
- Invalid URL format → show inline validation error before submit
- Channel not found (404 from YouTube) → "We couldn't find that channel. Check the URL."
- Channel is private or terminated → explicit message, suggest a different URL
- YouTube API quota exceeded → "We're temporarily over capacity, please try again in a few hours" + retry button
- Niche extraction fails or returns nonsense → fall back to user-provided niche field on the review screen with explanation
- Competitor identification returns zero results → review screen with empty competitor list, encourage user to add manually

### Empty states
- No channels yet → user is forced into `/onboard` after auth
- No competitors detected → review screen shows "We couldn't find competitors automatically. Add a few you'd like us to track."

### Loading states
- Per-step indicators on `/onboard/processing` (each step takes 2–10s, total 15–45s)
- Skeleton UI on review screen while channel data is finalizing

## Edge Cases
- Channel with fewer than 10 videos → median is statistically unstable; warn the user and offer to use mean instead
- Brand-new channel with hidden subscriber count → store `null`, downstream stages must handle missing subs
- Channel handle contains non-ASCII characters (emoji, foreign script) → ensure URL parsing handles them
- Channel has been renamed and the old URL redirects → follow the redirect once, persist the canonical URL
- User pastes a Shorts URL or playlist URL → extract the parent channel
- User pastes a URL of a channel they don't own → flag as `mode: "competitor"` on the channel record; don't claim ownership in UI
- User onboards the same channel twice → idempotent; second onboard refreshes data, doesn't create a duplicate row
- Channel has more than 50 videos but only 5 in the last 90 days → use last 5 for median, flag low-cadence

## Out of Scope
- OAuth-based channel verification (proving ownership)
- Importing YouTube Studio analytics (Phase 2)
- Automated nightly channel-data sync (Phase 2)
- Importing the user's full back catalog beyond 50 videos
- Connecting non-YouTube platforms (TikTok, Instagram)
- Channel branding asset extraction (logo, thumbnail style)
