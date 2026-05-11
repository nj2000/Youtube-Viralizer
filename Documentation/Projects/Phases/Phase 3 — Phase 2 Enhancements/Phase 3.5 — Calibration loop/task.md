# Phase 3.5 — Calibration loop

**Parent:** Phase 3 — Phase 2 Enhancements
**Status:** Not Started
**Estimated:** 12-16 hours
**Depends on:** Phase 2 (pipeline_runs), Phase 3.1 (corpus side-feed)
**Spec:** `Documentation/Overviews and Summaries/17-calibration-loop/spec.md`

## Goal

Close the prediction-vs-actual loop. User marks a run as published with its YouTube URL → polling cron pulls performance every 12h × 4d → 24h × 7d → weekly × 30d → computes per-run delta + per-channel personal-fit multipliers fed back to Feature #14 hybrid scoring + Feature #15 AVD predictor. Weekly Haiku-extracted learnings surface as recent lessons.

## What to Build

### Step 1 — Data layer (4 new tables)
- `published_polling_state` enum: `active|completed|stale`.
- `published_runs` table: id, run_id FK, youtube_video_id, published_at, polling_state, last_polled_at, performance_snapshots jsonb (array of {ts, views, ctr, avd_sec, retention_curve}), final_calibration_at, deleted_at. Partial unique index on (run_id WHERE deleted_at IS NULL).
- `calibration_results` table (per-run): predicted_score, actual_views, actual_ctr, actual_avd_sec, score_delta, ctr_delta_bp, avd_delta_sec, gate_outcome ('passed'|'failed_naturally'|'overridden'). Service-role writes only.
- `calibration_models` table (per-channel): channel_id, dimension (8-value enum: score_global, hook_weight, listicle_penalty, curiosity_bias, fear_bias, result_bias, length_bias, niche_overfit), multiplier float clamped [-0.50, +0.50], sample_size, updated_at. UPSERT key (channel_id, dimension).
- `calibration_learnings` table: weekly Haiku-extracted insights, UPSERT keyed by headline hash to dedupe.

### Step 2 — Polling architecture
- Vercel Cron sweep every 15min; hourly aggregate cron. New env var `CALIBRATION_CRON_SECRET`.
- `getVideoForCalibration(videoId)` — `videos.list` (1 unit, no Analytics OAuth in MVP — defers AVD/CTR depth to Phase 3). 1h cache.
- `nextPollAt(publishedRuns)` decaying schedule: 4 polls in first 4 days × 12h, then 7 polls × 24h, then ~4 polls × weekly out to day 30 → ~15 polls total per run.
- `runSweep` uses `SELECT FOR UPDATE SKIP LOCKED` with 50-row cap to avoid concurrent worker contention.
- `POST /api/internal/calibration/sweep` cron entrypoint (signature-verified).
- `POST /api/internal/calibration/aggregate` hourly cron — runs delta math + multiplier recompute.

### Step 3 — Calibration computation
- `computePerPollDelta`: predicted vs actual on score/CTR/AVD.
- `computeConfidenceWeight`: channel velocity check + age weighting (frozen<7d → 0.0, <14d → 0.3).
- `recomputeChannelModel`: Bayesian shrinkage with `k=5` prior, clamped ±0.50. Worked example: observed=+0.40, n=2 → shrunk=0.114. Badge visibility gates at 5 finalized runs.
- Side-write to `outlier_corpus` from user's published-and-completed runs (feeds Feature #14).

### Step 4 — API endpoints
- `POST /api/runs/[runId]/mark-published { youtubeVideoUrl }` — URL validation rejects Shorts and Live URLs; ownership check; inserts `published_runs` row.
- `GET /api/runs/[runId]/calibration` — per-run delta + history.
- `GET /api/channels/[channelId]/calibration` — aggregate (scatter plot data, multipliers, drift signals, recent learnings).
- `GET /api/channels/[channelId]/calibration/quota` — polls remaining today.
- `DELETE /api/runs/[runId]/published-link` — privacy opt-out (purges published_runs + calibration_results for that run).
- `POST /api/runs/[runId]/exclude` — exclude from calibration aggregates (keep audit row).

### Step 5 — Weekly learnings extraction
- `lib/prompts/calibration-learnings.ts`: Haiku 4.5 system prompt with `cache_control`. Prompt-injection defense (user-controlled YouTube comment data wrapped in XML block). Attribution.
- `lib/services/calibration/learnings.ts` `extractLearnings(channelId)`: reads last 5 finalized published_runs + calibration_results. UPSERT keyed by sha256(headline) to dedupe.
- Hourly aggregate cron triggers learnings extraction per channel on 7d gate.

### Step 6 — UI
- `/performance` shell + KPI strip (overall accuracy, multiplier deltas).
- Scatter plot SVG: predicted vs actual finalScore with diagonal perfect-prediction line.
- Drift panel: which dimensions over/under-predict ("Your hooks are stronger than the model thinks").
- Personal-fit multipliers card.
- Recent learnings (3-5 cards).
- Per-video calibration table.
- Drilldown page + progress/frozen/low-confidence/empty cards.
- `<MarkAsPublishedButton>` + `<MarkAsPublishedModal>`: URL paste, validation, confirm.
- Polling/quota banners + "±N% accuracy" score badge.

### Step 7 — Integration & testing
- Outlier_corpus self-feed: user's own outliers (≥5× their channel median post-publish) write to Feature #14 corpus.
- Feature #14 reads `calibration_models.multiplier` in score weight calc.
- Polling auto-stops at 30 days post-publish.
- Feature #16 reads aggregate calibration accuracy.
- Privacy controls: DELETE /published-link purges all related rows.
- RLS: user A cannot read user B's `published_runs` / `calibration_results`.
- CLAUDE.md updates: `CALIBRATION_CRON_SECRET` env var, Vercel Cron in stack lock-in, Haiku learnings row in CRIT-2.

## Cross-feature contracts

- Reads `pipeline_runs.score_data, avd_data, ab_plan_data` from Phase 2.2/3.3/2.9.
- Reads `channels.youtube_channel_id` (Phase 1.5) — verifies ownership match on mark-published.
- Writes `outlier_corpus` (Phase 3.1) — own outliers self-feed.
- Writes `calibration_models` — Feature #14 reads multipliers in score weight calc; Feature #15 reads in heuristic adjustment.
- Feature #16 reads aggregate accuracy for trajectory adjustments.

## Verification

- [ ] Polling schedule emits ~15 polls per run total (4 in first 4d × 12h + 7 in 4-11d × 24h + 4 in 11-30d × weekly)
- [ ] `calibration_models.multiplier` clamped to [-0.50, +0.50] (Zod refine)
- [ ] Bayesian shrinkage with k=5: observed=+0.40, n=2 → shrunk=0.114 ± 0.001 (numeric test)
- [ ] `mark-published` rejects Shorts URLs (`/shorts/`) and Live URLs (`/live/`)
- [ ] DELETE `/published-link` purges `published_runs`, `calibration_results`, side-fed `outlier_corpus` rows for that run
- [ ] User A cannot read user B's `published_runs` (RLS verified)
- [ ] Polling auto-stops at day 30 (no `last_polled_at` updates after that)
- [ ] Webhook with invalid `CALIBRATION_CRON_SECRET` returns 401
- [ ] `videos.list` consumes 1 YouTube unit per poll; ~15 polls per run = ~15 units/run lifetime (well within EXT-2 budget)
- [ ] Side-write to outlier_corpus only on `published_runs.polling_state='completed'`
- [ ] Weekly learnings extraction Haiku call uses `cache_control`; 2nd call shows cache hit
- [ ] Personal-fit badge gates at ≥5 finalized runs

## Out of scope

- YouTube Analytics OAuth (Phase 3 — defers AVD/CTR depth, MVP uses videos.list only)
- 90-day secondary calibration window (mockup advertises but deferred to Phase 2.5)
- Real-time webhook from YouTube on stats changes (poll-only Phase 2)
- Calibration export / public sharing
- Multi-tab broadcast on calibration update
