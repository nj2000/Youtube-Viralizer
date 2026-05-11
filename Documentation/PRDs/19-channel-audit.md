# PRD — Channel Audit

## Feature Name
Channel Audit

## Overview
A standalone, on-demand four-dimension health check for the user's channel: SEO health, performance trends, content cohesion, monetization readiness. Lifted directly from `claude-youtube`'s `audit` subskill. Independent of the kit pipeline — runs on the channel as a whole, not on a single idea.

**Problem solved:** Creators who get the kit pipeline working still don't know what's structurally broken about their channel. Audit surfaces issues like inconsistent thumbnail style, dead playlists, bad description boilerplate, or weak monetization placement.

## User Stories
- As a creator, I want a quarterly health check on my channel, so I notice problems I've grown blind to.
- As a creator, I want recommendations prioritized by impact, so I know what to fix first.
- As a creator, I want to compare my channel against niche benchmarks, so I know where I lag.
- As a creator, I want each finding to link back to specific videos or settings, so I can act on it.

## Functional Requirements
- Input: active channel context (from onboarding) + last 25 videos with metadata + niche
- Audit dimensions:
  - **SEO**: title quality, description completeness, tag consistency, chapter usage, intent-specific language usage
  - **Performance**: AVD trend over last 25 videos, CTR if accessible, view distribution (median vs. outliers), velocity changes
  - **Content cohesion**: niche drift, thumbnail style consistency, upload cadence regularity, playlist organization
  - **Monetization readiness**: ad placement (mid-roll candidates), affiliate link placement, brand-deal-friendliness, subscriber-to-view ratio
- Output:
  - One-line verdict per dimension: green / yellow / red
  - 3–7 prioritized findings overall with severity, evidence (specific video links), and suggested fix
  - Niche benchmark comparison (how the channel sits vs. niche typical)
- Persists `audit_runs` table; user can run audit on demand, max 1 per channel per 7 days (rate limit)

## User Interface

### Screens
- **`/audit`**: dedicated page accessible from main nav
- **`/audit/run`**: trigger an audit (button + brief explanation)
- **`/audit/[runId]`**: results view with four dimension panels and prioritized findings list

### Layout
- Dashboard-style summary at top: 4 dimension lights
- Findings list ordered by severity, expandable for evidence
- Niche benchmark sidebar

### Key interactions
- "Run audit" button (rate-limited)
- Click finding evidence to open the relevant video in YouTube
- Export audit as markdown report

## States to Handle

### Happy path
User triggers audit → channel data fetched → audit runs → findings rendered.

### Error states
- Rate-limited (audit run in last 7 days) → show prior result + "Wait N days for next audit" message
- YouTube quota exceeded → defer; user retries later
- Channel has fewer than 5 videos → audit unavailable; minimum threshold message

### Empty states
- New user without onboarded channel → route to onboarding first
- Audit has never been run → CTA to run first audit

### Loading states
- Streaming progress with sub-steps per dimension

## Edge Cases
- Channel has multiple distinct content tracks → audit treats each track separately if detectable; flag "multi-track channel"
- Channel had recent identity pivot → flag "recent pivot detected" and run audit on post-pivot videos only
- Channel is private or terminated mid-audit → halt with explanation
- Niche benchmark unavailable for this niche → run dimensional audit without comparison sidebar
- Audit results are highly negative → soften framing; lead with strengths before weaknesses

## Out of Scope
- Auto-fixing audit findings
- Audit alerts (email when something degrades)
- Multi-channel comparative audit
- Competitor audit (analyzing someone else's channel)
- Pulling YouTube Analytics OAuth metrics
