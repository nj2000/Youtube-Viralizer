# Spec — Feature #16: Compound-Effect Forecast

> **Status:** Approved · **Phase:** 2 · **Tier:** 3 (Enhancement) · **Build Order:** §3.5
> **Source PRD:** `Documentation/PRDs/16-compound-forecast.md`
> **Mockup:** `Documentation/Mockups/16-compound-forecast.html`

This spec is the engineering contract. It supersedes the PRD on any conflict. Code is built from this document.

> **Phase-2 reframe vs. PRD.** The PRD frames this feature as a **30-day per-video forecast** that synthesizes Stage 4, 5, 9, and 15 outputs. Phase 2 ships a different shape: a **channel-level 12-month compound forecast** that models the cumulative impact of consistent uploads at the user's current quality cadence. Per-video 30-day projection is deferred to Phase 3 once Features #15 (AVD) and #17 (calibration) are mature enough to support it. See §10 for the deferred work and §1 for the rationale.

---

## 1. Overview

A channel-level dashboard that answers a single question: **"If I keep publishing at my current cadence and quality, where am I in 12 months?"**

The forecast takes three editable inputs — `cadence` (videos/month), `avgQualityScore` (mean of recent pipeline scores), `nicheElasticity` (multiplier from the niche outlier corpus) — and produces a 12-month month-by-month projection of subscribers and total views, with `worst | expected | best` confidence bands and predicted milestone dates (10K, 100K, 1M subs; monetization eligibility; channel-best video).

It is purely server-side computation against existing Supabase data. No LLM. No SSE. The pipeline produces the forecast in **<500 ms** by running a deterministic compounding formula 12 times.

**Why it matters.** Creators consuming Stage 4 scores in isolation have no way to translate "I'm hitting 89s" into business outcomes ("you'll cross 100K subs by month 8 if you sustain this"). The forecast does that translation. It is the synthesis layer for the rest of Phase 2 — it reads channel signal (#01), pipeline scores (#03), niche elasticity (#14), AVD trajectory data (#15), and calibration drift (#17) into one number a creator can reason about.

**What this spec does NOT do (Phase 2):**

- Does not produce a per-video 30-day trajectory (PRD's original framing — deferred).
- Does not run an LLM. The model is a closed-form heuristic; explanations are templated.
- Does not retrieve live YouTube subscriber counts on every request — it uses the cached `channels.subscriber_count` from spec #01.
- Does not learn per-niche elasticity coefficients from a trained model — it reads them from `outlier_corpus` (Feature #14) with a graceful fallback to `1.0`.

---

## 2. User Stories

Phase 2 covers the following stories. Stories deferred to Phase 3 are listed in §10.

- As a creator, I see a single 12-month projection of my channel's subscribers and total views, so I can decide whether my current cadence is worth sustaining.
- As a creator, I see confidence bands (worst / expected / best), so I'm not misled by a single point estimate.
- As a creator, I edit the cadence, quality score, and niche-elasticity sliders inline, so I can model "what if I post twice a week" or "what if I average a 92 instead of 89."
- As a creator, I see predicted dates for milestones (10K, 100K, 1M subs; YPP eligibility), so I have concrete waypoints to plan around.
- As a creator, I see how the forecast compares to my actual last-90-days trajectory and to niche-peer medians, so I can sanity-check whether the projection is plausible for me.
- As a returning user, the forecast is cached for 6 hours so revisiting the page is instant, and re-runs are cheap.
- As a creator with <5 published runs, I see an explicit empty state telling me what to do (publish more, then return), instead of a misleading projection on thin data.
- As a creator, I optionally save a snapshot of the current forecast so I can compare against it next month and see whether reality matched the model.

---

## 3. Data Model

### 3.1 Read-only inputs (already exist)

The forecast depends on four upstream data sources. None are owned by this feature; this section documents the contract.

| Source | Field(s) read | Required | Fallback if missing |
|---|---|---|---|
| `channels` (#01) | `id`, `subscriber_count`, `median_views`, `niche`, `is_new_channel`, `low_cadence` | Yes | If `subscriber_count IS NULL`: forecast still runs, projecting from 0 with reduced confidence. |
| `pipeline_runs` (#03) | `score_data->>'finalScore'` (or `value` — see §6.3 flagged decision), `created_at`, `status` | ≥5 runs in last 90 days with `status = 'complete'` | <5 runs → return `INSUFFICIENT_HISTORY` error code. |
| `outlier_corpus` (#14) | `niche_elasticity_coefficient` keyed by `channels.niche` | No | Default to `1.0`. |
| `avd_predictions` (#15) | `predicted_avd_pct`, `confidence` (most recent run, optional) | No | Skip AVD-derived score boost. Set `flags.avdMissing = true`. |
| `calibration_state` (#17) | `score_to_outcome_correction_factor` per channel | No | Default correction factor to `1.0`. Set `flags.calibrationMissing = true`. |

The forecast is **read-only** against these sources. It does not write to them.

### 3.2 `forecasts` table (new)

The forecast is computed on demand and cached, but the user can optionally **persist a snapshot** for time-series tracking (§5.4). Snapshots live in their own table:

```sql
create table public.forecasts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  channel_id      uuid not null references public.channels(id) on delete cascade,
  inputs          jsonb not null,
    -- { cadence, avgQualityScore, nicheElasticity, baselineSubscriberCount,
    --   recentRunsHash, niche, generatorVersion }
  outputs         jsonb not null,
    -- { projection: [...], milestones: [...], delta: {...}, flags: {...} }
  generated_at    timestamptz not null default now(),
  label           text,                                        -- optional user-supplied snapshot name
  is_pinned       boolean not null default false               -- pinned snapshots survive cleanup
);

create index forecasts_channel_generated_idx
  on public.forecasts (channel_id, generated_at desc);

create index forecasts_user_id_idx on public.forecasts (user_id);

alter table public.forecasts enable row level security;

create policy "forecasts_select_own" on public.forecasts
  for select using (auth.uid() = user_id);
create policy "forecasts_insert_own" on public.forecasts
  for insert with check (auth.uid() = user_id);
create policy "forecasts_delete_own" on public.forecasts
  for delete using (auth.uid() = user_id);
-- No update policy: snapshots are immutable; users delete and re-snapshot.
```

**Lifecycle / cleanup.** Unpinned snapshots older than 180 days are deleted by a nightly job. Pinned snapshots are retained indefinitely. Each user can pin up to **12 snapshots per channel** (one per month); attempting to pin a 13th returns `PIN_LIMIT_REACHED`.

### 3.3 `forecast_cache` (Redis or Supabase row, ephemeral)

Forecast results are cached server-side keyed by the **inputs hash** so repeated GETs from the same dashboard within 6 hours don't recompute:

```sql
-- Optional: if not using Redis, store in Postgres with the existing kv-cache table
-- pattern from spec #01 (youtube_api_cache).
create table public.forecast_cache (
  cache_key   text primary key,                 -- sha256(channelId|cadence|avgScore|elasticity|recentRunsHash|generatorVersion)
  payload     jsonb not null,                   -- the ForecastResult shape from §4
  expires_at  timestamptz not null              -- now() + interval '6 hours'
);

create index forecast_cache_expires on public.forecast_cache (expires_at);
```

**Cache key composition** (deterministic order, lowercase hex):

```
sha256(
  channelId + "|" +
  cadence.toFixed(2) + "|" +
  avgQualityScore.toFixed(2) + "|" +
  nicheElasticity.toFixed(3) + "|" +
  recentRunsHash + "|" +
  generatorVersion
)
```

`recentRunsHash` is `sha256(...sortedRunIds, ...sortedScores)` over the 30 most recent completed runs in the last 90 days. Adding/removing/rescoring a run busts the cache automatically. `generatorVersion` is a hardcoded string in `lib/services/forecast.ts` (e.g. `"v1.0.0"`); bumping it rolls all caches.

### 3.4 Typed JSON schemas (Zod)

Located in `lib/validation/forecast.ts`:

```typescript
import { z } from "zod";

export const ForecastInputsSchema = z.object({
  cadence: z.number().min(1).max(30),                    // videos per month
  avgQualityScore: z.number().min(60).max(100),          // mean of recent pipeline scores
  nicheElasticity: z.number().min(0.5).max(2.0),         // multiplier from outlier corpus
});

export const ProjectionPointSchema = z.object({
  monthIndex: z.number().int().min(0).max(12),
  subscribers: z.object({
    best: z.number().int().nonnegative(),
    expected: z.number().int().nonnegative(),
    worst: z.number().int().nonnegative(),
  }),
  totalViews: z.object({
    best: z.number().int().nonnegative(),
    expected: z.number().int().nonnegative(),
    worst: z.number().int().nonnegative(),
  }),
  monetizationStatus: z.enum(["ineligible", "eligible-watch-time", "eligible-subs", "eligible"]),
});

export const MilestoneSchema = z.object({
  name: z.enum([
    "subs_1k", "subs_10k", "subs_100k", "subs_1m",
    "ypp_eligible",                       // YouTube Partner Program
    "channel_best_video",
    "watch_hours_4k",
  ]),
  label: z.string(),                      // pre-computed display string, e.g. "10K subscribers"
  predictedDateBest: z.string().datetime().nullable(),
  predictedDateExpected: z.string().datetime().nullable(),
  predictedDateWorst: z.string().datetime().nullable(),
  alreadyAchieved: z.boolean(),
});

export const DeltaSchema = z.object({
  vsLast90DaysActual: z.object({
    actualSubsGained: z.number().int(),
    projectedSubsGainedSamePeriod: z.number().int(),
    pctDifference: z.number(),                            // signed, e.g. +12.5 = forecast 12.5% above actual
  }).nullable(),
  vsNichePeers: z.object({
    peerMedianSubsGain12mo: z.number().int(),
    forecastSubsGain12mo: z.number().int(),
    pctDifference: z.number(),
  }).nullable(),
});

export const ForecastFlagsSchema = z.object({
  insufficientHistory: z.boolean(),
  avdMissing: z.boolean(),
  calibrationMissing: z.boolean(),
  elasticityFallback: z.boolean(),                        // true when nicheElasticity defaulted to 1.0
  cadenceUnstable: z.boolean(),                           // stddev of inter-publish gaps > mean
  lowConfidence: z.boolean(),                             // any of the above
});

export const ForecastResultSchema = z.object({
  channelId: z.string().uuid(),
  generatedAt: z.string().datetime(),
  generatorVersion: z.string(),
  inputs: ForecastInputsSchema.extend({
    baselineSubscriberCount: z.number().int().nonnegative().nullable(),
    niche: z.string(),
  }),
  projection: z.array(ProjectionPointSchema).length(13),  // monthIndex 0..12 inclusive
  milestones: z.array(MilestoneSchema),
  delta: DeltaSchema,
  flags: ForecastFlagsSchema,
});

export type ForecastInputs = z.infer<typeof ForecastInputsSchema>;
export type ForecastResult = z.infer<typeof ForecastResultSchema>;
export type ProjectionPoint = z.infer<typeof ProjectionPointSchema>;
export type Milestone = z.infer<typeof MilestoneSchema>;
```

**Read-side enforcement.** `lib/db/forecasts.ts` parses every `outputs` JSONB through `ForecastResultSchema` before returning. A parse error throws `INTERNAL_ERROR` and is logged.

---

## 4. API Endpoints

All routes are under `app/api/`. All require an authenticated session — middleware on the `(app)` route group rejects unauthenticated requests with `401 { code: "UNAUTHENTICATED" }`. Field naming: snake_case at the DB and external boundary, camelCase in TS. Zod schemas perform the transform.

### 4.1 `GET /api/channels/[channelId]/forecast` — compute or read forecast

**Auth:** required. **IDOR:** the channel row is selected `where user_id = auth.uid() and id = :channelId`; missing rows return `404 NOT_FOUND` (don't leak existence).

**Query params:**

| Param | Type | Default | Notes |
|---|---|---|---|
| `cadence` | number (1–30) | derived from channel's last-90-days actual upload rate | videos per month |
| `avgScore` | number (60–100) | derived from `pipeline_runs.score_data->>'finalScore'`, last 30 completed runs | mean |
| `elasticity` | number (0.5–2.0) | from `outlier_corpus.niche_elasticity_coefficient[channel.niche]`, fallback `1.0` | multiplier |
| `noCache` | `1` \| absent | absent | development affordance — bypasses the 6h cache |

**Response: 200 OK**

```typescript
ForecastResult                  // see §3.4
```

The response is **not streamed** (compute is fast; SSE adds latency for no benefit). Standard JSON.

**Errors:**

| HTTP | Code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Param out of bounds, non-numeric, etc. |
| 403 | `INSUFFICIENT_HISTORY` | <5 completed runs in the last 90 days. Body includes `runCount`. |
| 404 | `NOT_FOUND` | Channel does not exist or does not belong to caller. |
| 500 | `INTERNAL_ERROR` | Bug or unexpected state. |

**Cache behavior.**

1. Compute cache key per §3.3.
2. SELECT from `forecast_cache` where `cache_key = ? and expires_at > now()`. If hit, return immediately.
3. Else compute (§5), write to cache with `expires_at = now() + 6h`, return.

**Cache invalidation** (besides natural TTL):

- `recentRunsHash` changes → key changes → automatic miss.
- `generatorVersion` bump → key changes → automatic miss.
- A new pipeline_run completes for this channel → no proactive invalidation; the next forecast read picks up the new hash.

### 4.2 `POST /api/channels/[channelId]/forecast/snapshot` — persist snapshot

**Auth:** required.

**Request body:**

```typescript
{
  inputs: ForecastInputs,        // the inputs the user is snapshotting against
  label?: string,                // optional, max 80 chars
  pin?: boolean                  // default false; pin survives 180-day cleanup
}
```

**Behavior.** Re-computes the forecast (or pulls from cache) using the supplied inputs, then persists to `forecasts`. Server-side recompute prevents a malicious client from snapshotting a forged result.

**Response: 200 OK**

```typescript
{ snapshotId: string, generatedAt: string }
```

**Errors:**

- `400 { code: "VALIDATION_FAILED" }`
- `403 { code: "INSUFFICIENT_HISTORY" }`
- `403 { code: "PIN_LIMIT_REACHED" }` — only when `pin: true` and 12 pinned snapshots already exist for the channel
- `404 { code: "NOT_FOUND" }`

### 4.3 `GET /api/channels/[channelId]/forecast/snapshots` — list time-series

**Auth:** required.

**Query params:**

- `limit` (int, 1–60, default 12)
- `pinnedOnly` (`1` | absent)

**Response: 200 OK**

```typescript
{
  snapshots: Array<{
    id: string,
    generatedAt: string,
    label: string | null,
    isPinned: boolean,
    inputs: ForecastInputs,
    summary: {
      // Compact view for the time-series chart — full ForecastResult fetched per-snapshot on detail click.
      month12ExpectedSubs: number,
      month12ExpectedTotalViews: number,
      avgQualityScoreAtSnapshot: number,
    }
  }>
}
```

### 4.4 `DELETE /api/forecasts/[snapshotId]` — remove a snapshot

**Auth:** required.

**Response: `204 No Content`** on success; `404 NOT_FOUND` otherwise.

### 4.5 Error envelope

All non-200 JSON responses use the standard envelope per CLAUDE.md API-2:

```typescript
{ error: string, code: "VALIDATION_FAILED" | "INSUFFICIENT_HISTORY" | "NOT_FOUND" | "PIN_LIMIT_REACHED" | "INTERNAL_ERROR" }
```

Never leak Postgres errors, internal IDs other than the user's own, or stack traces.

---

## 5. Business Logic

### 5.1 Input derivation — defaults

When the frontend issues `GET .../forecast` with no params, the API derives defaults from existing data:

```typescript
async function deriveDefaultInputs(channel: Channel): Promise<ForecastInputs & { meta: ... }> {
  // ── Cadence: actual videos published in last 90 days, divided by 3 ───────────
  const recentVideos = channel.top_videos_json
    .filter(v => isWithinLast90Days(v.publishedAt));
  const cadence = clamp(recentVideos.length / 3, 1, 30);   // videos/month

  // ── avgQualityScore: mean of last 30 completed runs in last 90 days ──────────
  const runs = await db.pipelineRuns.list({
    channel_id: channel.id,
    status: "complete",
    completed_after: ninetyDaysAgo(),
    order: "completed_at desc",
    limit: 30,
  });
  const scores = runs
    .map(r => r.score_data?.finalScore)               // see §6.3 flagged decision
    .filter((s): s is number => typeof s === "number");
  if (scores.length < 5) {
    throw new ApiError(403, "INSUFFICIENT_HISTORY", { runCount: scores.length });
  }
  const avgQualityScore = mean(scores);

  // ── nicheElasticity: outlier corpus lookup ───────────────────────────────────
  const elasticity = await db.outlierCorpus.getElasticity(channel.niche) ?? 1.0;

  return {
    cadence: round(cadence, 1),
    avgQualityScore: round(avgQualityScore, 1),
    nicheElasticity: round(elasticity, 2),
    meta: {
      elasticityFallback: elasticity === 1.0 && !(await db.outlierCorpus.hasNiche(channel.niche)),
      cadenceUnstable: cadenceStdDevExceedsMean(recentVideos),
    },
  };
}
```

**Cadence stability check.** Compute the inter-publish gap (days) for each consecutive pair in the last 90 days. If `stddev(gaps) > mean(gaps)`, set `flags.cadenceUnstable = true` (the SVG client widens bands visually; the math still uses the mean).

### 5.2 Projection formula

The projection is a **deterministic monthly compound model** with explicit assumptions documented inline. Phase 2 favors transparency over sophistication.

**Notation.**

- `S₀` = `channel.subscriber_count ?? 0` — baseline subscriber count.
- `V₀` = `channel.median_views ?? 0` — baseline median views per video.
- `c` = `cadence` (videos/month).
- `q` = `avgQualityScore` (60..100).
- `e` = `nicheElasticity` (0.5..2.0).
- `M` = month index, 0..12 inclusive (M=0 is "today").
- `χ` = monthly churn rate, **constant 0.5%** (`0.005`) per CLAUDE.md TS-3 simplicity.

**Per-month subscriber recurrence:**

```
cadenceFactor(c)   = log10(1 + c) / log10(31)       // diminishing returns past ~10 vid/mo
scoreFactor(q)     = ((q - 60) / 40) ^ 1.4          // 60 → 0; 100 → 1; superlinear above 80
growthRate(c,q,e)  = 0.06 × cadenceFactor × scoreFactor × e
                                                    // 0.06 = baseline 6% MoM at perfect inputs

S_M (expected)     = round(S_{M-1} × (1 + growthRate − χ))
S_0 (expected)     = S₀
```

**Total views recurrence.** Each month's incremental views = (subscribers reachable) × (views/sub bayesian factor) + (cadence × per-video baseline). To keep the formula auditable:

```
viewsPerSubMonthly = 0.30                            // 30% of subs watch a given video
nonSubMultiplier   = 1.5 + (q - 80) × 0.05           // quality lifts non-sub reach
viewsThisMonth_M   = round(
                       (S_{M-1} × viewsPerSubMonthly × c × 0.4)        // sub-driven
                     + (V₀ × c × nonSubMultiplier × scoreFactor × e)   // non-sub-driven
                     )
totalViews_M       = totalViews_{M-1} + viewsThisMonth_M
totalViews_0       = 0
```

**Confidence bands.** Apply a horizon-widening multiplier to the expected line:

```
σ_M = 0.30 + 0.04 × M                                // 30% at M=0, 78% at M=12
S_M_best  = round(S_M_expected × (1 + σ_M))
S_M_worst = round(S_M_expected × (1 − σ_M × 0.7))    // floor narrower than ceiling
                                                     // (downside is less elastic than upside)
totalViews_M_best  = round(totalViews_M_expected × (1 + σ_M))
totalViews_M_worst = round(totalViews_M_expected × (1 − σ_M × 0.7))
```

The asymmetry (`× 0.7` on the worst side) reflects the empirical observation that a missed forecast usually misses on the upside (a video flopped) more often than the downside (a video over-performed by 80%).

**`monetizationStatus` per month.** Derived from `S_M_expected` and a separate watch-hours model.

```
watchHoursThisMonth_M = (viewsThisMonth_M × estimatedAvgViewSec) / 3600
estimatedAvgViewSec   = 480 × (q / 80)               // 8min @ q=80, scales with quality
totalWatchHours_M     = totalWatchHours_{M-1} + watchHoursThisMonth_M

if S_M_expected ≥ 1000 and totalWatchHours_M ≥ 4000  → "eligible"
elif S_M_expected ≥ 1000                             → "eligible-subs"
elif totalWatchHours_M ≥ 4000                        → "eligible-watch-time"
else                                                 → "ineligible"
```

**Calibration correction.** If `calibration_state.score_to_outcome_correction_factor[channelId]` exists (Feature #17), multiply `growthRate` by that factor. Default = `1.0`. Set `flags.calibrationMissing = (factor === 1.0 && no row exists)`.

**AVD enrichment (optional).** If `avd_predictions` for this channel returned a `predicted_avd_pct ≥ 60`, multiply `nonSubMultiplier` by `1.10`. If `< 40`, multiply by `0.90`. If absent, no adjustment + `flags.avdMissing = true`.

**Numerical guards.**

- All `Math.round()` calls use `Math.max(0, ...)` to floor at zero.
- If `S_{M-1} === 0` and growthRate is positive: seed with a small constant `+1` per video published that month so a brand-new channel can move off zero.
- If any intermediate exceeds `Number.MAX_SAFE_INTEGER / 2`, throw `INTERNAL_ERROR`. Practical channels never hit this.

### 5.3 Milestone detection

For each milestone in the catalog, find the first month index where the threshold is crossed in each band (`best | expected | worst`).

```typescript
const MILESTONE_CATALOG: Array<{
  name: Milestone["name"];
  label: string;
  threshold: (point: ProjectionPoint) => boolean;
}> = [
  { name: "subs_1k",            label: "1K subscribers",            threshold: p => p.subscribers.expected >= 1_000 },
  { name: "subs_10k",           label: "10K subscribers",           threshold: p => p.subscribers.expected >= 10_000 },
  { name: "subs_100k",          label: "100K subscribers",          threshold: p => p.subscribers.expected >= 100_000 },
  { name: "subs_1m",            label: "1M subscribers",            threshold: p => p.subscribers.expected >= 1_000_000 },
  { name: "ypp_eligible",       label: "YouTube Partner Program",   threshold: p => p.monetizationStatus === "eligible" },
  { name: "watch_hours_4k",     label: "4,000 watch hours",         threshold: p => true /* checked separately, see below */ },
  { name: "channel_best_video", label: "Beats your top video",      threshold: p => p.totalViews.expected >= channel.topVideoViews },
];

function detectMilestones(projection: ProjectionPoint[], today: Date): Milestone[] {
  return MILESTONE_CATALOG.map(m => {
    if (alreadyAchieved(m, S₀, V₀)) {
      return { name: m.name, label: m.label, predictedDateExpected: null, predictedDateBest: null, predictedDateWorst: null, alreadyAchieved: true };
    }
    const findCrossing = (band: "best" | "expected" | "worst"): Date | null => {
      for (const point of projection) {
        if (m.threshold({ ...point, subscribers: { ...point.subscribers, expected: point.subscribers[band] } })) {
          return addMonths(today, point.monthIndex);
        }
      }
      return null;                                  // not reached within 12 months in this band
    };
    return {
      name: m.name,
      label: m.label,
      predictedDateExpected: findCrossing("expected")?.toISOString() ?? null,
      predictedDateBest:     findCrossing("best")?.toISOString() ?? null,
      predictedDateWorst:    findCrossing("worst")?.toISOString() ?? null,
      alreadyAchieved: false,
    };
  });
}
```

`alreadyAchieved` is true if the baseline already crosses the threshold (e.g. the channel has 24K subs and the milestone is `subs_10k`). The UI hides already-achieved milestones from the upcoming-milestones strip but keeps them in the API for completeness.

### 5.4 Delta computation

```typescript
function computeDelta(
  projection: ProjectionPoint[],
  channel: Channel,
  recentRuns: PipelineRun[],
  nichePeers: NichePeerStats | null,
): DeltaSchema {
  // ── vs last 90 days actual ────────────────────────────────────────────────
  const subs90DaysAgo = await db.channelHistory.subsAtDate(channel.id, ninetyDaysAgo()) ?? null;
  const actualSubsGained = (channel.subscriber_count ?? 0) - (subs90DaysAgo ?? 0);
  const projectedSubsGainedSamePeriod = projection[3].subscribers.expected - projection[0].subscribers.expected;
  const vsLast90DaysActual = subs90DaysAgo === null ? null : {
    actualSubsGained,
    projectedSubsGainedSamePeriod,
    pctDifference: ((projectedSubsGainedSamePeriod - actualSubsGained) / Math.max(1, actualSubsGained)) * 100,
  };

  // ── vs niche peers ────────────────────────────────────────────────────────
  const vsNichePeers = nichePeers === null ? null : {
    peerMedianSubsGain12mo: nichePeers.medianSubsGain12mo,
    forecastSubsGain12mo: projection[12].subscribers.expected - projection[0].subscribers.expected,
    pctDifference: ((projection[12].subscribers.expected - projection[0].subscribers.expected - nichePeers.medianSubsGain12mo) / Math.max(1, nichePeers.medianSubsGain12mo)) * 100,
  };

  return { vsLast90DaysActual, vsNichePeers };
}
```

**Channel history.** A new auxiliary table `channel_history` (one row per channel per day, written by a nightly cron from Feature #14's infrastructure) is required for `subsAtDate`. If it doesn't exist yet (Phase 2 may ship before the cron), `vsLast90DaysActual` is `null` and the UI hides that comparison row.

**Niche peers.** Read from `outlier_corpus.niche_peer_stats` (Feature #14). If absent, `vsNichePeers` is `null`.

### 5.5 Performance budget

Target end-to-end p95: **<500 ms** for a cache miss, **<50 ms** for a cache hit.

- DB reads: 1 query for channel, 1 for last-30 completed runs, 1 for elasticity, 1 for AVD, 1 for calibration, 1 for cache check, 1 for cache write. ~7 round-trips. Use a single batched call where possible.
- Compute: 13 monthly iterations × O(1) arithmetic = trivial.
- No HTTP calls to external services.
- No LLM calls (CLAUDE.md cost rule N/A).

---

## 6. State Management

### 6.1 Server state

Authoritative for: `forecasts` rows, `forecast_cache` entries.

The forecast itself is **derived** state — it can always be recomputed from the inputs. Caching is a perf optimization, not a source of truth. Two consequences:

- The cache may be flushed at any time (e.g. by a `generatorVersion` bump) without data loss.
- The user-facing snapshot stored in `forecasts.outputs` is the one we trust for time-series. Cache entries are not user-visible.

### 6.2 Client state

- The forecast result is fetched once per dashboard mount and held in component state.
- Slider edits are **debounced 300 ms** then trigger a re-fetch with the new query params. Stale results are discarded by request-id matching.
- Snapshot list is fetched lazily only when the user opens the time-series drawer.
- No global state library is needed.

### 6.3 Optimistic updates

- **Slider drag:** the SVG curve is **NOT** redrawn optimistically on every drag tick — it would require running the formula client-side, which would duplicate logic. Instead, on drag end (debounced 300 ms), the panel shows a thin top-line spinner for 100–400 ms while the new server result loads. The compute is fast enough that loading state is barely visible.
- **Snapshot save:** optimistic; on failure, snap back and toast.
- **Snapshot delete:** optimistic; on failure, restore.

---

## 7. UI/UX Behavior

### 7.1 Routes

| Route | Auth | Purpose |
|---|---|---|
| `/channels/[channelId]/forecast` | required | Full dashboard. Renders the SVG area chart, sliders, milestone strip, comparison chart, and snapshot drawer. |
| `/runs/[runId]` (compact embed) | required | Optional compact card embedded after the AVD predictor card per Mockup State 9 — links to the full dashboard. |

### 7.2 Initial fetch

On mount, the dashboard issues `GET /api/channels/[channelId]/forecast` with no query params. The server derives defaults (§5.1) and returns the result. The sliders are then initialized to the values the server used.

### 7.3 Headline projection block

Mockup State 1, top section. Renders:

- Headline 12-month expected subscriber count or expected total views (toggle pill).
- Three-pill grid: `Worst | Expected | Best`.
- Comparison string: "**5.5×** your channel's recent median of 12.4K views" or "**+38K** subs vs your last 90 days at this rate".

### 7.4 SVG area chart

The chart is an SVG with `viewBox="0 0 720 280"`. The output schema is designed for direct SVG rendering — the client converts the 13 `ProjectionPoint` entries into x/y coordinates with a deterministic mapping:

```typescript
// Client-side, in components/forecast/TrajectoryChart.tsx
const X_OFFSET = 40, X_RIGHT = 700;
const Y_TOP = 40, Y_BOTTOM = 260;
const xFor = (m: number) => X_OFFSET + ((X_RIGHT - X_OFFSET) * m) / 12;
const yFor = (subs: number, max: number) =>
  Y_BOTTOM - ((Y_BOTTOM - Y_TOP) * subs) / max;

const max = Math.max(...projection.map(p => p.subscribers.best));
const expectedPath = projection.map((p, i) =>
  `${i === 0 ? "M" : "L"} ${xFor(p.monthIndex)},${yFor(p.subscribers.expected, max)}`
).join(" ");
const bandPath = `${
  projection.map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(p.monthIndex)},${yFor(p.subscribers.best, max)}`).join(" ")
} ${
  [...projection].reverse().map(p => `L ${xFor(p.monthIndex)},${yFor(p.subscribers.worst, max)}`).join(" ")
} Z`;
```

**Hover.** Mousing over the chart snaps to the nearest `monthIndex` and renders a tooltip with the three values. Use a transparent `<rect>` overlay per month for hit-testing.

**Y-axis.** Auto-scaled to `nicest(max)` (round up to 100K, 250K, 500K, 1M, etc.).

**Channel-median reference line.** Horizontal dashed line at `channel.median_views` (rendered against a separate "views per video" chart toggle, not subscribers).

### 7.5 Inputs panel — sliders

Per Mockup State 1, the right-side inputs panel:

| Slider | Range | Step | Display format |
|---|---|---|---|
| Cadence | 1 – 30 vid/mo | 0.5 | `8.5 vid/mo` |
| Avg score | 60 – 100 | 1 | `89 / 100` |
| Niche elasticity | 0.5 – 2.0 | 0.05 | `1.20× niche multiplier` |

**Reset button.** Each slider has a small "↺" that snaps back to the server-derived default.

**Slider behavior.** On drag, update local state immediately for visual feedback. On drag-end (debounced 300 ms), issue a new `GET .../forecast?cadence=X&avgScore=Y&elasticity=Z`. Show a 1-line subdued top spinner during the fetch.

### 7.6 Milestone strip

Mockup State 1 bottom strip. Renders all milestones from `milestones[]` where `alreadyAchieved === false`, sorted by `predictedDateExpected ASC`.

For each milestone:

- Card with status pill (`Hit · Day N` if within 30 days, `Channel best · Day N` for the next-best record, `Stretch · Day N+` if only `predictedDateBest` resolves).
- Predicted date in user's locale (`formatDate(predictedDateExpected, "MMM d, yyyy")`).
- Tooltip on hover shows worst / best dates.

Already-achieved milestones are hidden from this strip but visible in a "Achievements" tab in the snapshot drawer.

### 7.7 Comparison chart

Mockup State 1, second SVG. Three-line chart:

- **This forecast** (yt-500 line) — `projection.subscribers.expected`.
- **Your last 90 days actual** (ink-300 dashed) — interpolated from `channel_history`. Renders only if `delta.vsLast90DaysActual !== null`.
- **Niche peers** (violet line) — interpolated from `outlier_corpus.niche_peer_stats`. Renders only if `delta.vsNichePeers !== null`.

End-point dot labels show absolute values.

### 7.8 Risk callouts

Each `flags.*` boolean drives a chip in the risk-callout strip:

| Flag | Chip text | Color |
|---|---|---|
| `cadenceUnstable` | "Channel cadence irregular" | amber |
| `elasticityFallback` | "No niche calibration yet — using 1.0×" | amber |
| `avdMissing` | "AVD prediction missing — confidence widened" | amber |
| `calibrationMissing` | "Calibration loop not yet active" | gray |
| `lowConfidence` | "Reduced confidence" badge in card header | amber |

Per the mockup State 1 risk callouts list — also include positive callouts when high-signal data is present ("AVD prediction is high-confidence" with a green check).

### 7.9 Snapshot drawer

A right-hand drawer toggled from the dashboard header. Renders:

- "Save snapshot" button → POST `.../snapshot` with current inputs and an optional label/pin.
- List of past snapshots from GET `.../snapshots?limit=12`. Each row: timestamp, label, summary stats, `pin/unpin`, `delete`.
- Time-series sparkline of `month12ExpectedSubs` over snapshots — lets the user see whether their forecast trajectory is improving over real time.

### 7.10 Compact card

Mockup State 9. A condensed forecast card embedded in `/runs/[runId]` after the AVD predictor card. Renders only:

- Headline 12-month expected subs.
- Mini 110-px-tall area chart (single band).
- Source-share chips (Browse / Suggested / Search / Subs).
- "Open dashboard →" CTA.

The compact card uses the same API endpoint; rendering is purely a CSS choice.

### 7.11 Loading state

Mockup State 2. Initial mount before the forecast resolves: card with a pulsing dot, dashed skeleton chart, and four sequential checklist items (Loaded virality score → Loaded AVD → Sampling trajectories → Generating risk callouts). Phase 2 actually skips Anthropic calls entirely, so "sampling" is a UX flourish not a real step — keep <200 ms total.

### 7.12 Reduced-confidence state

Mockup State 3. When `flags.avdMissing` or `flags.calibrationMissing` or `flags.elasticityFallback` is true:

- Card header shows amber "Reduced confidence" badge.
- Banner above the chart explains which signal is missing.
- "Run AVD predictor →" or "Refresh elasticity" CTA links to the upstream feature.

### 7.13 Empty / insufficient-history state

Mockup State 4. When `INSUFFICIENT_HISTORY`:

- Card shows the empty-state icon + "Forecast unavailable for new channels".
- Subtext: "We need at least 5 published videos with completed pipeline runs to anchor the forecast. You currently have **N runs**."
- CTAs: "View virality score" (links to most recent run) and "Continue anyway" (Phase-2 dev affordance — runs the forecast with elasticity defaults; not exposed to prod users).

### 7.14 Error state

Mockup State 8 (renamed for Phase 2 — original PRD's `FORECAST_INSUFFICIENT_SIGNALS` becomes our `INSUFFICIENT_HISTORY`):

- Rose-themed banner.
- List of missing inputs (which is Phase-2 minimal — only history; AVD/calibration are soft).
- `code` printed in mono for support.

### 7.15 Re-compute / Recompute button

Top-right of the dashboard. Issues `GET .../forecast?noCache=1`. Useful when the user knows the cache is stale and wants a hard refresh.

---

## 8. Edge Cases

| Case | Behavior |
|---|---|
| Channel has 0 subscribers (`subscriber_count = 0` or null) | Forecast still runs from baseline 0. Growth seed (§5.2 numerical guards) ensures the curve isn't flat. Banner: "Starting from zero — early-month numbers are highly uncertain." |
| Channel has hidden subscriber count (`subscriber_count IS NULL`) | Treated as 0 with a banner: "Subscriber count is hidden on YouTube — projection assumes channel size proportional to median views." |
| <5 completed pipeline runs | `INSUFFICIENT_HISTORY` returned. Empty state shown (§7.13). |
| Exactly 5 runs, but all 5 in the last 7 days | `flags.cadenceUnstable = true`. Forecast computes but bands widened. |
| Pipeline runs span >90 days (active user, sparse cadence) | Filter to last 90 days; if <5 remain, fail with `INSUFFICIENT_HISTORY`. |
| User has 20+ runs all scoring <60 | `avgQualityScore` clamped at 60 (Zod min). Banner: "Quality score below model floor — improve scores in Stage 4 to unlock the forecast." Forecast still computes — flat or declining curve is the honest answer. |
| All recent runs scored 100 | Clamped at 100. Forecast aggressive; `flags.lowConfidence = false`. |
| `outlier_corpus` table doesn't exist yet (Feature #14 not deployed) | `nicheElasticity` defaults to `1.0`, `flags.elasticityFallback = true`. |
| `avd_predictions` table doesn't exist yet (Feature #15 not deployed) | `flags.avdMissing = true`. AVD enrichment skipped. |
| `calibration_state` table doesn't exist yet (Feature #17 not deployed) | `flags.calibrationMissing = true`. Correction factor = 1.0. |
| `channel_history` table doesn't exist yet | `delta.vsLast90DaysActual = null`. UI hides the actual-vs-forecast row. |
| User edits sliders to extreme values (cadence=30, score=100, elasticity=2.0) | Output is mathematically valid but flagged with `flags.lowConfidence = true` (per stddev of inputs from defaults exceeding 2σ). Subtitle: "These are aggressive assumptions — the forecast assumes you sustain them every month." |
| User edits sliders to floor (cadence=1, score=60, elasticity=0.5) | Forecast curve trends near-flat. No flag triggered (this is honest). |
| User pins a 13th snapshot | `403 PIN_LIMIT_REACHED`. Frontend toast: "You've pinned 12 snapshots — unpin one to add a new one." |
| Snapshot saved against stale data, then user re-runs pipelines, then opens snapshot | Snapshot still shows the inputs and outputs at save time. UI shows a banner: "This snapshot was generated 14 days ago. Your current forecast may differ." |
| `recentRunsHash` collision (theoretically possible but astronomical) | Acceptable — at worst a stale forecast for ≤6h until TTL expires. |
| User deletes a channel | RLS cascades: `forecasts.channel_id` references on delete cascade. Snapshot rows deleted automatically. Cache entries orphaned but harmless (TTL flushes). |
| Very long horizon question — "what about month 18?" | Out of scope; the API returns exactly 13 points (M=0..12). |
| Tab closes mid-fetch | AbortController cancels the in-flight request. No persistence; cache may still be written server-side (harmless). |
| Multiple tabs open with different slider positions | Each tab fetches independently; cache hits when inputs match. No cross-tab sync. |
| Cache row exists but is unparseable (data corruption) | Treat as miss, recompute, overwrite. Log warning to Sentry. |
| `score_data->>'finalScore'` is missing on some runs (legacy data) | Filter those out; if remaining count <5, `INSUFFICIENT_HISTORY`. See §6.3 flagged decision below. |
| Channel was onboarded with `is_new_channel = true` (median is null) | `V₀ = 0`. Non-sub-driven views term collapses; forecast is sub-driven only. Add banner: "No median views yet — using sub-driven projection only." |
| Floating-point drift causes monotonicity violation (M+1 < M) | Phase-2 formula is monotonic-by-construction (positive growth, non-negative views). Add a defensive `Math.max(prev, next)` step on totalViews to be safe. |
| User publishes a real video while the forecast is rendering | Next request will pick up the new run via `recentRunsHash`. Current render stays consistent. |

---

## 9. Security Considerations

- **Auth-gated:** `(app)` middleware enforces session presence. Unauthenticated requests return `401 UNAUTHENTICATED`.
- **RLS:** every read/write to `forecasts` is filtered by `auth.uid()`. RLS policies in §3.2 are the second line of defense.
- **IDOR protection:** every endpoint that takes `channelId` or `snapshotId` filters by `user_id = auth.uid()`. Missing rows return `404 NOT_FOUND` (don't leak existence).
- **No external service calls:** The forecast endpoint does not call YouTube, Anthropic, or Resend. CRIT-1 (quota cache) and CRIT-3 (prompt caching) are N/A. CRIT-2 (model routing) is N/A.
- **Rate limiting:** Dashboard re-renders trigger forecast requests on every slider change (debounced). Each user is capped at **60 forecast requests / hour** via the same `redetect_throttle` table (or Redis) used by spec #01. Exceeding returns `429 RATE_LIMITED`.
- **Snapshot abuse:** Each user is capped at **12 snapshot writes / hour / channel** to prevent table abuse. Pin limit (12 pinned/channel) is the long-term cap.
- **Data exposure:** The `outputs` JSONB contains only data the user already has access to (their own pipeline scores, their own subscriber count). No cross-user leakage.
- **Numeric overflow:** Per §5.2 numerical guards, intermediate values are bounded; abnormal values throw `INTERNAL_ERROR` rather than producing nonsensical output.
- **Prompt-injection defense:** N/A — no LLM in this feature.
- **PII:** None. All inputs and outputs are derived from already-public YouTube data plus the user's own session-bound aggregates.
- **CSRF:** All state-changing routes (`POST /snapshot`, `DELETE`) verify the `Origin` header. Read-only `GET` is CSRF-irrelevant by HTTP spec.
- **Cache poisoning:** The cache key includes the channelId, so user A's cache cannot collide with user B's. The cache is server-side and never served cross-user. RLS still applies on `forecasts` reads.
- **Time-series tampering:** Snapshot `outputs` are computed server-side from `inputs` server-side (§4.2). The client cannot forge an output payload.

---

## 10. Future Considerations (Out of Scope for Phase 2)

The following are deferred. Each is tracked elsewhere — do not implement as part of this feature.

- **Per-video 30-day forecast (PRD's original framing).** Once Feature #15 (AVD predictor) ships and Feature #17 (calibration loop) accumulates ≥6 months of paired forecast/outcome data, build a per-video projection layer alongside the channel-level one. The spec for that layer will live separately and reuse the same `forecasts` table with a discriminator column.
- **Trained niche-elasticity coefficients.** Phase 2 reads `outlier_corpus.niche_elasticity_coefficient` as a static value. Phase 3 fits coefficients per niche from outcome data via regression on (cadence × avgScore × actual subs gained). The fitting job lives in Feature #14's nightly cron.
- **Trained projection model.** Phase 2's heuristic formula is hand-tuned. Phase 3 replaces it with a small XGBoost or linear model trained on (channel signal vector → 12-month outcome) pairs once enough channels are tracked over a year.
- **Sub-monthly resolution.** Phase 2 returns 13 monthly points. A weekly granularity (53 points) is deferred — most creators don't need it and chart density suffers.
- **Revenue / monetization forecast.** Knowing month-N views doesn't tell you month-N revenue (CPM varies wildly by niche). Defer until we integrate YouTube Analytics OAuth (Phase 3).
- **Subscriber growth FROM A SPECIFIC video.** PRD mentioned "modeling subscriber growth from this video" — explicitly out of scope.
- **Competitive forecasting.** "Will I out-perform competitor X?" — out of scope; we don't have access to their internal signals.
- **Backtesting accuracy over time.** Feature #17 (calibration loop) handles this. The forecast feature does not own backtesting.
- **Email digest of forecast changes.** "Your 12-month projection went up 8% this week" — Phase 3 retention feature. Resend integration deferred.
- **Multi-channel comparison.** Side-by-side forecasts for users with multiple channels. Defer until Phase 2 stabilizes.
- **Public sharing.** Sharing a snapshot via public URL ("look at my projected growth"). Phase 3 marketing feature; requires careful auth.
- **Confidence band sampling.** Mockup State 2 says "Sampling 1,200 trajectories from 80% confidence interval." This is UX flourish in Phase 2 (the formula is closed-form, not Monte Carlo). Phase 3 actual Monte Carlo would let bands reflect input uncertainty instead of a fixed 30%.

---

## Appendix A — File map

This spec implies the following files exist by the end of implementation:

```
app/
  (app)/
    channels/
      [channelId]/
        forecast/
          page.tsx                          # full dashboard route
  api/
    channels/
      [channelId]/
        forecast/
          route.ts                          # GET — compute or read cached
          snapshot/route.ts                 # POST — persist snapshot
          snapshots/route.ts                # GET — list snapshots
    forecasts/
      [snapshotId]/route.ts                 # DELETE
lib/
  services/
    forecast.ts                             # core compute orchestrator (≤300 lines)
    forecast-projection.ts                  # the recurrence formula (§5.2)
    forecast-milestones.ts                  # milestone detection (§5.3)
    forecast-delta.ts                       # vs-actual + vs-peer delta (§5.4)
  validation/
    forecast.ts                             # Zod schemas (§3.4)
  db/
    forecasts.ts                            # CRUD for snapshots
    forecast-cache.ts                       # 6h cache helpers
    channel-history.ts                      # auxiliary queries (§5.4) — may be a no-op stub if table absent
components/
  forecast/
    ForecastDashboard.tsx                   # composition root
    HeadlineProjection.tsx                  # top section
    TrajectoryChart.tsx                     # SVG area chart with bands (§7.4)
    InputsPanel.tsx                         # cadence/score/elasticity sliders (§7.5)
    MilestoneStrip.tsx                      # milestone cards (§7.6)
    ComparisonChart.tsx                     # 3-line forecast vs. actual vs. peer (§7.7)
    RiskCallouts.tsx                        # flag chips (§7.8)
    SnapshotDrawer.tsx                      # save/list/delete snapshots (§7.9)
    CompactForecastCard.tsx                 # embedded version (§7.10)
    EmptyState.tsx                          # <5 runs (§7.13)
    ReducedConfidenceState.tsx              # missing upstream signals (§7.12)
hooks/
  useForecast.ts                            # debounced fetch + AbortController per slider edit
```

**File-length compliance** (CLAUDE.md Q-2):

- API routes: each <150 lines (thin — push logic into services).
- `lib/services/forecast.ts`: ≤300 lines (compose only; delegate math to `forecast-projection.ts`).
- `lib/services/forecast-projection.ts`: ≤300 lines (pure functions).
- Components: each ≤200 lines; split if exceeded (e.g., `TrajectoryChart` is a candidate to split into `TrajectoryChart.tsx` + `useChartGeometry.ts`).

---

## Appendix B — CLAUDE.md updates required

When this spec is implemented, the following CLAUDE.md sections must be updated:

1. **CRIT-2 model assignment table:** add a row noting that Feature #16 has **no LLM call** so the table does not apply. Phrase: "Feature #16 — Compound forecast — N/A (deterministic compute)". This pre-empts a future dev wondering why no model is assigned.
2. **Phase 2 lockup note in Scope Management (S-1):** add Feature #16 to the explicit Phase 2 list with the channel-level scope ("12-month projection, NOT per-video 30-day").
3. **Architecture Rules (A-1):** add to the forbidden list: "API route `app/api/channels/[id]/forecast/route.ts` may not call services other than `lib/services/forecast.ts`." Reinforces the orchestration boundary.
4. **External Services (EXT-2):** confirm that this feature does NOT call YouTube — important because the dashboard re-fetches frequently as sliders move; an accidental YouTube call here would burn quota fast.
5. **Common Mistakes section:** add an entry the first time a real bug surfaces (per existing convention). Likely candidate: "Cache key forgot to include `generatorVersion` — bumping the formula didn't invalidate user caches" or "Forgot `Math.max(0, ...)` floor on subscribers; viral-loss month produced negative subs."
6. **Stack lock-in:** no new dependencies added by this feature. (No charting library — pure SVG.) Confirm.
7. **Data Model invariants:** when `pipeline_runs.score_data` schema is finalized in spec #03/#05, ensure the field is named consistently across these specs. See the flagged decision in §6.3 below — this spec assumes `score_data->>'finalScore'`; spec #03 currently uses `value`. Reconcile during implementation.

---

## Flagged Decisions

The following decisions are non-obvious and should be reviewed before implementation:

1. **PRD scope deviation: channel-level vs. per-video.** The PRD describes a 30-day per-video forecast. This spec ships a 12-month channel-level forecast in Phase 2 instead, because (a) the channel-level model is feasible without trained AVD/calibration data; (b) the per-video model needs Feature #15 maturity which Phase 2 doesn't yet have; (c) the channel-level view answers a more strategic question the PRD's Functional Requirements list ("comparison to channel's recent video median" implies channel-level grounding). Confirm acceptance.
2. **`score_data` field name: `finalScore` vs. `value`.** This spec uses `score_data->>'finalScore'`. Spec #03 line 996 references `score_data->>'value'`. Both names appear in upstream spec drafts. Resolution: pick one before implementing #16 and update the loser's references. Recommend `finalScore` for clarity ("score" alone is too generic).
3. **Constant churn rate (0.5%/month).** Phase 2 uses a single hardcoded value. Real channels vary 0.1%–2%. We accept this until Feature #17 has enough data to fit a per-channel rate. If the forecast feels systematically pessimistic in early dogfooding, lower to 0.3%.
4. **Confidence-band asymmetry (`× 0.7` on worst).** Empirically motivated but not data-driven yet. Revisit after 90 days of forecast/outcome pairs in Feature #17.
5. **`monetizationStatus` thresholds.** Encoded as YouTube's published 2026 thresholds (1K subs + 4K watch-hours). Update if YouTube changes these.
6. **`generatorVersion` in cache key.** Bumping it invalidates ALL caches for ALL users. Useful for emergency rollouts of formula fixes; potentially disruptive (everyone refetches at once). Accept the trade-off; document the bump procedure in `lib/services/forecast.ts` header.
7. **No Monte Carlo.** Mockup says "Sampling 1,200 trajectories." The real implementation is deterministic. The loading text is UX flavor. If marketing requires Monte Carlo for credibility, add it in Phase 3 — it's a 1-day implementation but adds 200 ms to the compute.
8. **Cache TTL of 6 hours.** Long enough that dashboard revisits within a day are cheap; short enough that newly-completed pipelines flow through within a workday. Could go to 24h once we trust the `recentRunsHash` invalidation; start conservative.
9. **`forecasts` retention of 180 days for unpinned snapshots.** Adjust if storage pressure appears.
10. **No SSE.** PRD's Mockup State 2 implies streaming. We chose plain JSON because compute is fast (<500 ms). Reconsider only if Phase 3 Monte Carlo pushes compute past 2 s.
11. **Slider debounce of 300 ms.** Tested empirically against typical drag latency. Reduce to 150 ms if it feels laggy in user testing.
12. **Hard cap of 12 pinned snapshots.** Mirrors the 12-month forecast horizon (one pin per month is the common case).
13. **`channel_history` table** is referenced for the actual-vs-forecast delta but its full spec lives elsewhere (likely Feature #14 or #17). If it doesn't exist by Feature #16's implementation, the delta gracefully degrades to `null`.
14. **No client-side recomputation.** All formula math runs server-side. Pro: single source of truth. Con: every slider edit costs a round-trip. Accept the trade-off; the 6h cache absorbs reuse.
15. **Forecast horizon fixed at 12 months.** Not user-configurable. Could become a query param (`horizonMonths`) if a use case appears, but bands widen quickly past 12 — beyond which the forecast loses meaning.
