# PRD — Compound-Effect Forecast

## Feature Name
Compound-Effect Forecast

## Overview
Models the cumulative effect of CTR × AVD × suggested-traffic snowball, producing a single forecast for the video's likely view trajectory over 30 days. Synthesizes signals from Stages 4 (score), 5 (titles), 9 (thumbnails), and 15 (AVD predictor) into one number with a confidence range.

**Problem solved:** Creators see individual signals (score, AVD prediction, A/B test) but can't translate them into a single answer to the question "how big will this video be." The forecast collapses the signals into a usable estimate.

## User Stories
- As a creator, I want a single estimated view count for my video, so I can decide if it's worth filming.
- As a creator, I want a confidence range, so I'm not misled by a single point estimate.
- As a creator, I want the forecast to update if I regenerate any input stage, so it stays consistent with my current kit.
- As a creator, I want the forecast grounded in my channel's historical performance, so it's realistic for me.

## Functional Requirements
- Input: virality score (Stage 4 / Feature #14), titles (Stage 5), AVD prediction (Feature #15), competitor outliers (Stage 3), channel size, channel velocity (avg views per video over last 60 days)
- Output:
  - 30-day forecast view count (single number + confidence range)
  - Trajectory curve: estimated views by day for first 30 days
  - Breakdown of contributing factors: estimated CTR contribution, AVD contribution, suggested-traffic contribution
  - Comparison to channel's recent video median
  - Risk callouts: which signal drove the most uncertainty
- Persists to `compound_forecast_data` on `pipeline_runs`
- Runs after Features #14 and #15 are available

## User Interface

### Screens
New card within `/runs/[runId]`, after the AVD predictor card.

### Card layout
- Header: "30-Day Forecast" + status
- Headline number with confidence range (e.g., "estimated 45,000–95,000 views in 30 days")
- Trajectory curve as a small chart
- Factor-contribution breakdown (small bars)
- Comparison line: "Your channel's recent median: 18k"
- Risk callouts as warning chips

### Key interactions
- Hover the trajectory curve for per-day estimates
- Click a factor to see which stage drives it

## States to Handle

### Happy path
All upstream stages complete → forecast computed → rendered with trajectory.

### Error states
- Any of Features #14 or #15 missing → forecast shows reduced-confidence estimate or error
- Channel velocity unknown → use niche velocity baseline; flag

### Empty states
- New channel with insufficient history → "Forecast unavailable for new channels until you have 5+ videos"

### Loading states
- Card shows spinner with text "Modeling 30-day trajectory…"

## Edge Cases
- Channel had a recent viral outlier that distorts the median → median should be replaced by mode or trimmed mean
- Channel cadence is highly irregular → forecast confidence widens
- Topic is timely (news, trends) → forecast skews to a faster-burn shape (most views in first 7 days)
- Topic is evergreen → forecast skews to a slower-burn shape (views accumulate over 30+ days)
- Forecast is dramatically optimistic or pessimistic vs. channel norm → surface explicit explanation of why

## Out of Scope
- Long-tail forecasting (90+ day projections)
- Modeling sponsorship or revenue forecasts
- Modeling subscriber growth from this video
- Competitive forecasting (will the video out-perform a specific competitor video)
- Backtesting accuracy over time (Feature #17 calibration handles this)
