# Spec — Feature #15: AVD Predictor (Pipeline Tier 3.3, Phase 2)

> **Status:** Approved · **Phase:** 2 · **Tier:** 3.3 (Enhancement) · **Build Order:** §3.3
> **Source PRD:** `Documentation/PRDs/15-avd-predictor.md`
> **Mockup:** `Documentation/Mockups/15-avd-predictor.html`
> **Reference subskill:** none (no direct `claude-youtube` analogue — this is YouTube Viralizer–specific)

This spec is the engineering contract. It supersedes the PRD on any conflict. Code is built from this document.

---

## 1. Overview

The AVD Predictor reads the **finished retention-engineered script** (Stage 7 output, see Spec #08), extracts a deterministic set of **structural features** (rehook density, open-loop activity, B-roll cadence, `[PERSONALITY]` distribution, demonstration-block density, section pacing variance, word density per section), composes them with a **niche-baseline AVD** sourced from the outlier corpus (Feature #14), and emits:

- A point estimate of the predicted Average View Duration in seconds (`predictedAvdSec`) and as a percentage of the script's estimated runtime (`predictedAvdRatio`).
- A symmetric `confidenceInterval` (`lowerSec` / `upperSec`).
- A 30s-stride `retentionCurve` whose shape is anchored to the same script structure that drives Stage 7's preview curve, but re-grounded against the niche corpus and the channel's historical median.
- A list of `riskPoints` — locations where the curve drops more than 10 percentage points within a rolling 60s window, each annotated with a 1-sentence Haiku-generated suggestion.
- A `comparison` block showing this script's predicted ratio vs. the channel's median AVD vs. the niche corpus's top-quartile AVD.
- A `calibration` placeholder reserved for Feature #17 (post-publish actuals join), populated only when actual data exists.

**Persistence target.** A new JSONB column `pipeline_runs.avd_data` is added in this spec's migration (§3.1). The Stage 7 spec (§3.3) reserved a `version` field on `script_data` for forward compatibility — we do **not** mutate `script_data`; we write to a sibling column.

**Critical scoping decision.** The PRD describes "calibrated to my channel's historical retention" and the mockup shows a "Channel-calibrated" badge with reference-video counts. **In Phase 2 we use only the channel's `median_views` from `channels` and the channel's `top_videos_json` view counts as a coarse retention proxy** — we do NOT pull per-video retention curves from YouTube Analytics (that requires OAuth, deferred to Phase 3, see §10). The "Channel-calibrated" badge in the UI is honest about this in its tooltip.

**Why a heuristic, not a trained model.** Phase 1.5/2 ships **zero ML training**. The data we have at predictor-launch is the outlier corpus (Feature #14) — at most a few thousand videos with view counts and metadata, no retention curves. A trained predictor needs labeled retention data which only Feature #17 (post-publish loop) produces. **Phase 3+ will swap the heuristic for a model trained on the calibration table.** This spec writes the heuristic in a way that the swap is a function-replacement, not a rewrite.

**Why this matters.** Stage 7 produces a structurally engineered script. Stage 8 lints it for anti-patterns. Neither answers the question "will this actually hold?" The AVD Predictor is the value bridge from "we engineered it" to "we predict it'll work" — and, via the **Apply Suggestions** flow (§4.3), into "we'll fix it for you." Without it, the kit ends at a script the user can't evaluate before filming.

**Phase boundary:**

- **In scope (Phase 2):** heuristic predictor, retention curve, risk points, suggestions (Haiku 4.5 for suggestion *text* only), apply-suggestions surgical regen of Stage 7 sections, comparison block (this script vs. channel median vs. niche top quartile), calibration placeholder schema.
- **Out of scope:** trained ML model (Phase 3+); per-second curve (per-30s slices only); CTR / traffic-source-mix / subscriber-conversion prediction (§10); auto-rewriting dead zones without explicit Apply (§10); peer-channel anonymized AVD distributions (§10); pulling YouTube Analytics retention data (§10).

---

## 2. User Stories

Phase 2 covers the following stories from the PRD. Stories about per-channel-trained models, peer-distribution comparisons, and auto-rewrite without confirmation are **deferred to Phase 3** and are explicitly out of scope here.

- As a creator, I want a predicted AVD percentage before I film, so I know whether to ship or revise.
- As a creator, I want a predicted retention curve I can read in 5 seconds, so I see *where* it dips, not just whether it does.
- As a creator, I want dead zones flagged with timestamps and a 1-sentence problem description, so I know exactly where to tighten.
- As a creator, I want a 1-sentence suggested fix per dead zone, so the predictor adds value beyond a number.
- As a creator, I want to apply a selected set of suggestions and have the script regenerate that section automatically, so I don't have to hand-edit and re-paste.
- As a creator, I want the predictor calibrated against my channel's median view count (a coarse engagement proxy), so the prediction is realistic for my baseline rather than generic.
- As a creator, I want a comparison strip — me vs. my channel vs. niche top quartile — so I see whether this script is *above* or *below* my normal performance.
- As a creator, the predictor must auto-run after Stage 7 completes, so I don't manually trigger another step in a 12-stage flow.
- As a creator, I want to manually re-run the predictor if I think something's wrong, so I can rule out a transient failure without re-rolling the script.
- As a creator, when I've published a video the predictor was wrong about, I want to see the gap (Feature #17 fills this in), so the prediction's reliability is auditable over time.

---

## 3. Data Model

### 3.1 Migration — `pipeline_runs.avd_data` JSONB column

**This spec owns the migration.** Apply as a numbered Supabase migration (e.g. `supabase/migrations/<timestamp>_add_avd_data.sql`):

```sql
-- 0015_add_avd_data.sql
-- Phase 2 / Tier 3.3 — AVD Predictor (Feature #15)
-- Adds the avd_data JSONB column to pipeline_runs and the supporting status row.

alter table public.pipeline_runs
  add column if not exists avd_data jsonb;

-- The status state machine adds two new transitions: 'predicting_avd' and 'avd_predicted'.
-- These are values, not enum members — pipeline_runs.status is a free `text` column
-- per Tier 0 §0.4. We DO NOT add a CHECK constraint enumerating allowed statuses;
-- the orchestrator (lib/services/pipeline.ts) enforces the FSM in TypeScript.

-- Index for the orchestrator's "find runs that need AVD prediction" query.
create index if not exists pipeline_runs_status_avd_idx
  on public.pipeline_runs (status)
  where status in ('predicting_avd', 'avd_predicted');

-- Partial index supporting Feature #17's calibration scan: rows with avd_data
-- but no actuals attached yet.
create index if not exists pipeline_runs_avd_pending_calibration_idx
  on public.pipeline_runs ((avd_data->'calibration'->>'state'))
  where avd_data is not null
    and (avd_data->'calibration'->>'state') in ('pending', null);
```

**RLS.** No new policies — `pipeline_runs` already enforces `auth.uid() = user_id` via SEC-2 from Tier 0. The new column is read/written through the same row, inherits the same protection.

### 3.2 `pipeline_runs.status` state machine (predictor-relevant transitions only)

Stage 7's spec ends at `'scripted'` and auto-queues `'linting'` (Stage 8). The predictor adds two states between Stage 8 and Stage 9 in the visual pipeline order, but the **trigger is on `'scripted'`**, not on `'lint_done'` — see §5.0.

```
'scripted'           (set by Feature #08 Stage 7 on success)
       │
       ├──► 'linting' / 'lint_done' (Stage 8 — runs in parallel from the orchestrator's POV)
       │
       ▼  (orchestrator auto-queues AVD prediction immediately on 'scripted')
'predicting_avd'
       │
       ├──── prediction succeeds + persisted ─► 'avd_predicted'
       │                                              │
       │                                              ▼ (orchestrator does NOT auto-advance to Stage 9 from here;
       │                                                 Stage 9 trigger fires on 'lint_done', not 'avd_predicted')
       │
       └──── upstream / format / data-missing ─► 'avd_errored'
                                                      │
                                                      ▼ (status stays 'avd_errored', avd_data is null)
```

**Key invariants:**

- Stage 8 (lint) and the AVD predictor run **in parallel** off the same `'scripted'` trigger. They share no state — neither blocks the other.
- The predictor reaching `'avd_predicted'` does **not** advance the pipeline. Stage 9 (thumbnail briefs) keys off `'lint_done'`. This is deliberate: the predictor is a *diagnostic* surface, not a gating stage.
- The "Apply suggestions" flow (§4.3) does NOT transition pipeline status — it transitions Stage 7 (`'scripted' → 'scripting' → 'scripted'`) per Stage 7's spec, and the predictor automatically re-runs on the new `'scripted'` event.
- A run that's `'avd_errored'` can be re-run via `POST /api/pipeline/avd-predict` (manual re-run); the row transitions back to `'predicting_avd'`.

### 3.3 Typed JSON schemas (Zod, validated on every read and write)

Located in `lib/validation/avd.ts`:

```typescript
import { z } from "zod";

/**
 * Classification thresholds. Keep in lib/config.ts as AVD_BANDS so the UI and
 * the predictor agree on band boundaries:
 *   risky:  predictedAvdRatio < 0.50
 *   solid:  0.50 <= predictedAvdRatio < 0.70
 *   viral:  predictedAvdRatio >= 0.70
 */
export const AvdBandSchema = z.enum(["risky", "solid", "viral"]);

/**
 * One sample of the predicted retention curve, returned at 30-second granularity.
 * `timeSec` is the start of the 30s bucket (0, 30, 60, ...). `predictedRetention`
 * is in [0, 100] — the percentage of viewers we predict are still watching at
 * that time.
 *
 * Mockup-driven: the SVG curve is rendered from this array; we sample at 30s
 * stride to give 16-40 points across a 5-20 minute video. Phase 1's Stage 7
 * preview curve (Spec #08 §5.6) uses a *different* schema (RetentionSampleSchema)
 * and is rendered separately in the script card. The two curves intentionally
 * differ — Stage 7's is structural-only; this one is corpus-grounded.
 */
export const AvdRetentionSampleSchema = z.object({
  timeSec:            z.number().int().nonnegative(),
  predictedRetention: z.number().min(0).max(100),
  /**
   * Optional risk classification of THIS sample, populated by the risk-point
   * detector in §5.5. Used by the SVG renderer to draw the colored marker.
   */
  riskFlag: z.enum([
    "none",          // no risk
    "rehook_gap",    // ≥120s since the previous rehook
    "demo_density",  // demonstration section running >180s without break
    "topic_pivot",   // section role boundary into payoff/loop_close
    "monologue",    // ≥90s of skeleton text with no [PERSONALITY] block
  ]).default("none"),
});

/**
 * A risk point — an SVG-renderable annotation on the retention curve.
 * Detected by the algorithm in §5.5 (>10pp drop within a 60s window) plus
 * the structural risk classifiers above.
 */
export const AvdRiskPointSchema = z.object({
  /** Stable id within this prediction. Matches the suggestion's id when applied. */
  id:           z.string().regex(/^risk-[a-z0-9]{6}$/),
  /** Seconds from script start. Aligned to a 30s bucket boundary. */
  timeSec:      z.number().int().nonnegative(),
  /** Predicted retention at this point (0-100). Mirror of the curve sample. */
  retention:    z.number().min(0).max(100),
  /** The drop in percentage points across the 60s window centered on timeSec. */
  dropPp:       z.number().min(0).max(100),
  /** Severity for UI rendering. Drives the marker color in the SVG. */
  severity:     z.enum(["soft", "moderate", "hard"]),
  /**
   * 0-indexed reference into ScriptData.sections — which section this risk
   * lands inside. Used by the "Jump to script" UI (§7.4).
   */
  sectionIndex: z.number().int().min(0).max(7),
  /**
   * Why we flagged it (machine-readable). The UI maps this to a human
   * description. Multiple flags possible (e.g. monologue + demo_density).
   */
  flags:        z.array(AvdRetentionSampleSchema.shape.riskFlag).min(1).max(3),
  /**
   * 30-200 char human description of the problem ("142s of monologue without
   * a rehook"). Generated deterministically from flags+context (NOT by Haiku).
   */
  problem:      z.string().min(30).max(200),
  /**
   * 30-280 char suggested structural fix. Generated by Haiku 4.5 (§5.6) — this
   * is the only LLM call in the predictor pipeline.
   */
  suggestion:   z.string().min(30).max(280),
  /**
   * Estimated retention lift if the suggestion is applied. Computed by the
   * heuristic by simulating the structural change (e.g. "insert rehook at t").
   * Bounded to [+1, +20] — the heuristic is honest about its ceiling.
   */
  expectedLiftPp: z.number().int().min(1).max(20),
});

/**
 * Reference data for the comparison strip. Rendered as the three-bar comparison
 * widget in the right column of State 2.
 */
export const AvdComparisonSchema = z.object({
  /** This script's predicted ratio (0-100). */
  thisScript:        z.number().min(0).max(100),
  /**
   * Channel-median AVD proxy. Derived from channels.median_views via the
   * formula in §5.3. Null only if median_views is null (new channel — first
   * onboarded video).
   */
  channelMedian:     z.number().min(0).max(100).nullable(),
  /**
   * Niche top-quartile AVD proxy. Derived from outlier_corpus (Feature #14)
   * if available; falls back to a niche-agnostic constant (NICHE_TOP_QUARTILE_FALLBACK)
   * defined in lib/config.ts when outlier_corpus is empty for this niche.
   */
  nicheTopQuartile:  z.number().min(0).max(100).nullable(),
  /** True iff the niche corpus had ≥30 videos for this channel's niche. */
  nicheCorpusUsed:   z.boolean(),
  /** Number of videos used to compute channelMedian. 0 if proxy fallback used. */
  channelSampleSize: z.number().int().nonnegative(),
  /** Number of niche corpus videos used. 0 if fallback constant used. */
  nicheSampleSize:   z.number().int().nonnegative(),
});

/**
 * Calibration placeholder. Feature #17 (post-publish loop) writes into this
 * structure once the user confirms publication and YouTube Analytics OAuth
 * is wired (Phase 3). Phase 2 ALWAYS writes `state: "pending"` with empty
 * metrics — the schema is reserved here so #17 doesn't need a data-model
 * migration, just an UPDATE.
 */
export const AvdCalibrationSchema = z.object({
  state: z.enum(["pending", "actuals_attached", "no_publication"]).default("pending"),
  /** ISO datetime when state transitioned to actuals_attached. Null in 'pending'. */
  attachedAt: z.string().datetime().nullable(),
  /** Actual AVD ratio measured post-publish (0-100). Null in 'pending'. */
  actualAvdRatio: z.number().min(0).max(100).nullable(),
  /** Actual AVD seconds. Null in 'pending'. */
  actualAvdSec: z.number().int().nonnegative().nullable(),
  /** Signed prediction error (predicted − actual), in pp. Null in 'pending'. */
  errorPp: z.number().min(-100).max(100).nullable(),
  /**
   * Trailing-window calibration metrics computed by Feature #17 across the
   * channel's last 6 published videos. Surfaced in the right column of State 2
   * ("Mean abs. error · Direction accuracy"). Null until #17 lands.
   */
  trailingMeanAbsErrorPp: z.number().min(0).max(100).nullable(),
  trailingDirectionAccuracy: z.string().regex(/^\d+\/\d+$/).nullable(), // "5/6"
});

/**
 * The full AvdData payload persisted to pipeline_runs.avd_data. Versioned —
 * v1 is the only version in Phase 2; Phase 3 (trained model) will introduce
 * v2 with optional `model.*` fields, kept backwards-compatible.
 */
export const AvdDataSchema = z.object({
  version: z.literal("v1"),

  /** Predicted AVD as a number of seconds. Always integer. */
  predictedAvdSec:   z.number().int().min(0),
  /** Predicted AVD ratio (0-100). predictedAvdSec / estimatedRuntimeSec * 100. */
  predictedAvdRatio: z.number().min(0).max(100),
  /** Classification band. Derived from predictedAvdRatio + AVD_BANDS thresholds. */
  band:              AvdBandSchema,

  /** Symmetric confidence interval. Width derived per §5.4. */
  confidenceInterval: z.object({
    lowerSec: z.number().int().min(0),
    upperSec: z.number().int().min(0),
    /** Width of the interval in pp. Convenience field for the UI ("±4 pp"). */
    halfWidthPp: z.number().int().min(0).max(50),
  }),

  /**
   * 30s-stride retention curve. Length = ceil(estimatedRuntimeSec / 30) + 1.
   * Both endpoints (t=0 and t=estimatedRuntimeSec) are included.
   */
  retentionCurve: z.array(AvdRetentionSampleSchema).min(8).max(80),

  /**
   * 0-10 risk points, ordered by timeSec ascending. Cap at 10 — the UI shows
   * the top 5 inline and offers an "all" expander; beyond 10, a script with
   * that many issues should be regenerated wholesale.
   */
  riskPoints: z.array(AvdRiskPointSchema).max(10),

  comparison: AvdComparisonSchema,
  calibration: AvdCalibrationSchema,

  /**
   * Inputs snapshotted at prediction time, so re-renders are reproducible
   * even if upstream sources mutate. The predictor reads these fields fresh
   * on every run; we persist them here for audit and for Feature #17's
   * calibration math.
   */
  inputs: z.object({
    /** From channels.niche. Truncated to 200 chars (matches column constraint). */
    niche: z.string().max(200),
    /** From channels.median_views. Null for new channels. */
    channelMedianViews: z.number().int().nonnegative().nullable(),
    /** From channels.subscriber_count. Null for hidden-subs channels. */
    channelSubscriberCount: z.number().int().nonnegative().nullable(),
    /** Total runtime of the script in seconds (script_data.estimatedRuntimeSec). */
    scriptRuntimeSec: z.number().int().min(120),
    /** Word count from script_data.totalWordCount. */
    scriptWordCount: z.number().int().min(500),
    /** True iff outlier_corpus had ≥30 videos for the channel's niche at run time. */
    outlierCorpusUsed: z.boolean(),
  }),

  /** Set to true if estimatedRuntimeSec < 120s — see §5.7 short-script handling. */
  scriptTooShort: z.boolean(),

  /** ISO datetime when the prediction was completed. */
  predictedAt: z.string().datetime(),

  /**
   * Model identifier for the suggestion-text generator (the only LLM call).
   * Locked to "claude-haiku-4-5-20251001" in Phase 2 (CRIT-2 — short structured output).
   * The predictor itself is non-LLM; left as null for the heuristic and populated
   * in Phase 3 when a trained model lands.
   */
  suggestionModel: z.literal("claude-haiku-4-5-20251001"),
  predictorModel:  z.null(),

  /** End-to-end wall-clock duration in ms. Includes Haiku call. */
  durationMs: z.number().int().nonnegative(),

  /**
   * Counter of suggestions the user has applied (incremented by §4.3 each time
   * apply-suggestions completes). Phase 2 does NOT preserve historical
   * predictions — applying suggestions overwrites avd_data with the new prediction.
   * The counter is for analytics + UI ("you've applied 3 suggestions on this run").
   */
  appliedSuggestionsCount: z.number().int().min(0),
});

export type AvdData            = z.infer<typeof AvdDataSchema>;
export type AvdRetentionSample = z.infer<typeof AvdRetentionSampleSchema>;
export type AvdRiskPoint       = z.infer<typeof AvdRiskPointSchema>;
export type AvdComparison      = z.infer<typeof AvdComparisonSchema>;
export type AvdCalibration     = z.infer<typeof AvdCalibrationSchema>;
export type AvdBand            = z.infer<typeof AvdBandSchema>;
```

**Read-side enforcement.** `lib/db/runs.ts` parses `pipeline_runs.avd_data` through `AvdDataSchema` before returning. Parse failure throws `INTERNAL_ERROR`, logs raw JSON to Sentry server-side, returns the standard error envelope to the client (never the raw payload). Feature #17 reads through `getRunAvd(runId)` — the same typed accessor.

### 3.4 Constraints

- `predictedAvdSec <= inputs.scriptRuntimeSec`. (Predicting people stay longer than the video runtime is meaningless.)
- `predictedAvdRatio = round(predictedAvdSec / inputs.scriptRuntimeSec * 100)` (recomputed in TS at write — model claim ignored).
- `band` derived from `predictedAvdRatio` per AVD_BANDS thresholds (recomputed in TS at write).
- `confidenceInterval.lowerSec <= predictedAvdSec <= confidenceInterval.upperSec`.
- `retentionCurve[0].timeSec === 0`. `retentionCurve[last].timeSec === inputs.scriptRuntimeSec` (rounded up to next 30s if not divisible by 30).
- `retentionCurve` is monotonically non-increasing in *long-run trend* but allowed to bump up by ≤6pp at rehook/loop-payoff samples (§5.5). Strict monotonic decrease is NOT required because rehooks and payoffs are explicitly retention-positive in the heuristic.
- Each `riskPoints[i].timeSec` corresponds to a sample in `retentionCurve` (timeSec must equal a curve sample's timeSec).
- `riskPoints` ordered ascending by timeSec.
- `version === "v1"` is the only accepted value in Phase 2.
- `scriptTooShort === true` ⇒ `confidenceInterval.halfWidthPp >= 12` (we widen confidence on short scripts per §5.7).
- `inputs.outlierCorpusUsed === false` ⇒ `comparison.nicheCorpusUsed === false` and `comparison.nicheSampleSize === 0`.

---

## 4. API Endpoints

All routes are under `app/api/`. All require an authenticated session — middleware on the `(app)` route group rejects unauthenticated requests with `401 { code: "UNAUTHENTICATED" }`. RLS on `pipeline_runs` is enforced by the DB layer (SEC-2).

Field naming follows CLAUDE.md API-1: snake_case in DB and external APIs, camelCase in TypeScript code. Zod schemas perform the transform at the boundary.

### 4.1 `POST /api/pipeline/avd-predict` — predict AVD (SSE)

**Auth:** required.

**Path:** matches the fixed pipeline contract in CLAUDE.md API-3 (`POST /api/pipeline/<stage>`). The `<stage>` for this feature is `avd-predict` — kebab-case, hyphenated. Other stages use single-word slugs (`script`, `lint`, `seo`); we deliberately use `avd-predict` because `avd` alone is ambiguous (could be confused with "audio-video-dub" or similar).

**Request body:**
```typescript
{ runId: string }   // UUID; channelId is derived from the run row
```

There are NO additional parameters. The predictor reads the *current* `script_data` (post-Stage-7 or post-apply-suggestions), the *current* `channels.niche` and `channels.median_views`, and the *current* `outlier_corpus` snapshot. Re-running on a stale run picks up changes automatically.

**Validation:** `AvdPredictStartSchema = z.object({ runId: z.string().uuid() })` in `lib/validation/avd.ts`. On parse failure: `400 { error: "...", code: "VALIDATION_FAILED" }` *before* the SSE stream opens.

**Pre-flight checks (executed in this order, before the stream opens):**

1. Load `pipeline_runs` row with `where id = :runId and user_id = auth.uid() and deleted_at is null`. Missing → `404 { code: "RUN_NOT_FOUND" }`. (We do not return 403 to avoid leaking existence — SEC-2.)
2. Verify `script_data` is present (Stage 7 must have completed). Missing → `409 { code: "MISSING_PREREQUISITES", message: "Stage 7 (script) hasn't completed yet." }`.
3. Verify `channels.niche` is present (set by Feature #01). Missing → `MISSING_PREREQUISITES`.
4. (No check on Stage 8 lint — predictor and lint are independent per §3.2.)
5. (No check on Feature #14 outlier_corpus — graceful fallback per §5.3.)
6. Compute `inputs.scriptRuntimeSec` from `script_data.estimatedRuntimeSec`. If `< 120`: emit a `progress` event with `{ step: "script_too_short", status: "warn" }` and proceed with a niche-baseline prediction (NOT an error — see §5.7). Set `scriptTooShort: true` in the output.
7. Verify the per-channel AVD-predict rate cap (§9.1): max 30 predictor runs per channel per 24h. Exceeded → `429 { code: "RATE_LIMITED", retryAfterSec: <seconds> }`. (The cap is high because apply-suggestions auto-re-runs the predictor and we don't want to throttle iteration.)
8. Update `pipeline_runs.status = 'predicting_avd'`.

**Response:** `text/event-stream`. Streams progress events per section analyzed, plus the final `complete` event. Full event reference in §4.4.

**Streaming pattern (high-level):**

The endpoint runs the predictor inline (no Anthropic stream — the predictor is non-LLM). It emits a `progress` event for each major phase (script parsing, structural feature extraction, channel calibration, niche calibration, retention curve, risk points, suggestion generation). The Haiku 4.5 call for suggestion text fires once at the end, batched (one call generates all suggestion texts; see §5.6). The full `AvdData` is emitted in the `complete` event.

**Total wall-clock budget:** 8-14 seconds (matches mockup State 1 copy). Breakdown in §6.5.

**Error events** (terminate the stream after emission):

```
event: error
data: { "code": "MISSING_PREREQUISITES", "message": "Stage 7 (script) hasn't completed yet." }
```

Possible codes:

| Code | When | HTTP status* |
|---|---|---|
| `VALIDATION_FAILED` | runId not a UUID | 400 |
| `RUN_NOT_FOUND` | run does not exist or is not owned by requester (SEC-2) | 404 |
| `MISSING_PREREQUISITES` | `script_data` or `channels.niche` is missing/empty | 409 |
| `SCRIPT_TOO_SHORT` | **Not an error** — emitted as a `progress.warn` only. Listed here because the brief calls it out as an error code; we explicitly **flag and proceed**. | n/a |
| `RATE_LIMITED` | per-channel predictor cap hit | 429 |
| `BUDGET_EXCEEDED` | daily Anthropic spend cap hit (Haiku call) | 429 |
| `UPSTREAM_ERROR` | Haiku call failed after retries (suggestions only). Predictor still emits `complete` with empty `suggestion` strings on each risk point and a `degraded: true` flag at the top level (see §5.6 fallback). | n/a (degraded mode) |
| `INTERNAL_ERROR` | bug or unexpected state | 500 |

\* HTTP status applies to the initial response when the error happens *before* the SSE stream opens. Once the stream is open, errors are emitted as `event: error` and the stream closes; HTTP status is 200.

**Persistence.** On the `complete` event, the service layer:

1. Validates the assembled `AvdData` against `AvdDataSchema`.
2. Writes `pipeline_runs.avd_data = <AvdData>` and updates `status` to `'avd_predicted'`.
3. **Does NOT auto-queue any subsequent stage.** Stage 9 (thumbnails) keys off `'lint_done'` (Stage 8), not on the predictor.
4. Returns control to the SSE generator, which emits the `complete` event.

If validation fails between heuristic computation and the DB write, the request errors with `INTERNAL_ERROR` and the row's `status` is set to `'avd_errored'`. `avd_data` remains `null` so the UI can re-trigger.

### 4.2 Auto-trigger from Stage 7 (`'scripted'` event)

The orchestrator (`lib/services/pipeline.ts`) auto-queues `runStage(runId, 'avd-predict')` whenever a run transitions to `'scripted'`. This happens in two places:

1. After Stage 7 full generation completes (Spec #08 §4.1 step "Persistence").
2. After Stage 7 single-section regen via apply-suggestions (Spec #08 §4.2 — and §4.3 of *this* spec).

The auto-trigger is fire-and-forget from Stage 7's perspective. Stage 7 returns `complete` to its own client immediately; the predictor's SSE stream is **separate** and the UI subscribes to it on the AVD card mount. (Mockup State 1 shows this — the predictor card has its own loading state, distinct from the script card's.)

**Race protection.** If the user navigates to the run page between Stage 7's `complete` and the predictor's SSE handshake, the AVD card renders the "Pending" state (mockup not shown — render the same shimmer as State 1 with no progress events yet). Once the orchestrator's predictor run starts, `status` flips to `'predicting_avd'` and the card's stream opens. If the user clicks "Re-run" while `status === 'predicting_avd'`, the request returns `409 { code: "PREDICT_IN_PROGRESS" }` — the UI should show a toast, not retry.

**Idempotency.** The orchestrator has a per-run dedup table (Tier 0 §0.7) keyed by `(runId, stage)`. If two `'scripted'` events fire within 1s (rare race), only one predictor run is queued.

### 4.3 `POST /api/pipeline/avd-predict/apply-suggestions` — apply selected fixes (SSE)

**Auth:** required.

**Path note:** This endpoint sits *under* `/api/pipeline/avd-predict` deliberately — it is not a separate stage; it's a sub-action that triggers a Stage 7 surgical regen and the predictor's auto-re-run.

**Request body:**
```typescript
{
  runId: string,                        // UUID
  suggestionIds: string[],              // 1-5; subset of avd_data.riskPoints[*].id
}
```

**Validation:** `AvdApplySuggestionsSchema = z.object({ runId: z.string().uuid(), suggestionIds: z.array(z.string().regex(/^risk-[a-z0-9]{6}$/)).min(1).max(5) })`.

**Pre-flight checks:**

1. RLS load of run row.
2. Verify `avd_data !== null` and `status === 'avd_predicted'`. Otherwise → `409 { code: "APPLY_NOT_APPLICABLE" }`.
3. Verify each `suggestionId` exists in `avd_data.riskPoints[*].id`. Missing → `400 { code: "VALIDATION_FAILED", details: { missingSuggestionIds: [...] } }`.
4. Group selected suggestions by `sectionIndex`. Each group becomes ONE Stage 7 surgical-regen call (`POST /api/pipeline/script/regenerate-section` per Spec #08 §4.2) — multiple selected suggestions in the same section are merged into a single steering string. (Decision flagged in §10 — the alternative was N parallel regens, rejected because section regens overwrite each other.)
5. Verify the per-channel apply-suggestions rate cap (§9.1): max 20 apply-suggestions per channel per 24h. Exceeded → `429 { code: "RATE_LIMITED" }`.

**Behavior:**

The endpoint is a thin orchestrator. For each unique `sectionIndex` in the selected suggestions:

1. Compose a steering string by concatenating `risk.suggestion` for every selected risk in that section. Format: `"AVD predictor flagged this section. Apply these structural fixes:\n- <suggestion 1>\n- <suggestion 2>\n..."`. Length-cap at 500 chars (Spec #08 §4.2 limit). If concatenation exceeds 500, truncate at the last full bullet.
2. Sequentially call the internal Stage 7 service `regenerateScriptSection({ runId, sectionIndex, steering })`. We call the service directly, NOT the public HTTP endpoint, to avoid SSE-over-SSE plumbing. The service emits its own progress to the orchestrator's bus.
3. After all section regens complete, the orchestrator's `'scripted'` event auto-fires the predictor (§4.2). The apply-suggestions endpoint **proxies the predictor's SSE stream** back to the client — the user sees a single unified stream that goes "regenerating section 3... regenerating section 6... predicting AVD..." in mockup State 1's step-list shape.
4. On success, increment `avd_data.appliedSuggestionsCount` (read-modify-write — but note that the predictor will overwrite `avd_data` entirely on its re-run; the counter is read FROM the *previous* `avd_data` before the regen and written INTO the *new* `avd_data` after). This persists the counter across applies.

**Streaming events (proxied):**

```
event: progress
data: { "step": "applying_suggestions", "status": "ok", "sectionsToRegen": [3, 6] }

event: progress
data: { "step": "regenerating_section", "status": "ok", "sectionIndex": 3, "of": 2 }

event: progress
data: { "step": "regenerating_section", "status": "ok", "sectionIndex": 6, "of": 2 }

event: progress
data: { "step": "running_predictor", "status": "ok" }

... (predictor's normal progress events follow) ...

event: complete
data: <AvdData>   // the new prediction post-apply
```

Possible codes (delta from §4.1):

| Code | When |
|---|---|
| `APPLY_NOT_APPLICABLE` | run is not in `'avd_predicted'` state, OR `avd_data` is null |
| `STAGE7_FORMAT_VIOLATION` | A nested Stage 7 regen failed format check (per Spec #08 §5.5). The original section is retained; the failure surfaces here as a stream error. The predictor is **not** auto-re-run (Stage 7's `'scripted'` event was never emitted). |
| `LOOP_INTEGRITY_BROKEN` | A nested Stage 7 regen broke loop integrity (per Spec #08 §4.2). Same handling as above. |
| `RATE_LIMITED` | apply-suggestions cap hit |

**Decision flagged in §10:** apply-suggestions does **not** offer a preview-before-commit UX in Phase 2. The user clicks "Apply suggestions to script", confirms a modal with the list of changes, and the Stage 7 sections are overwritten. Phase 3 may add a side-by-side diff. The mockup's "Apply suggestions to script" CTA is honest about the destructive nature ("This will regenerate Section 3 and Section 6").

### 4.4 SSE streaming-chunk schema (canonical reference)

The exact SSE event vocabulary for `POST /api/pipeline/avd-predict` and the proxied stream from `POST /api/pipeline/avd-predict/apply-suggestions` is defined here. UIs and middleware must accept these events verbatim; new event types require a spec update.

**Event sequence — predict (§4.1):**

```
event: progress
data: { "step": "validating_inputs", "status": "ok" }

event: progress
data: { "step": "loading_script", "status": "ok",
        "sectionCount": 6, "wordCount": 1842, "runtimeSec": 480 }

event: progress
data: { "step": "extracting_features", "status": "ok",
        "rehookCount": 4, "openLoopCount": 2, "personalityZoneCount": 8,
        "brollDensity": 0.36, "monologueBlocks": 1 }

event: progress
data: { "step": "calibrating_channel", "status": "ok",
        "channelMedianViews": 12400, "channelSampleSize": 38 }

event: progress
data: { "step": "calibrating_niche", "status": "ok",
        "outlierCorpusUsed": true, "nicheSampleSize": 142 }

event: progress
data: { "step": "computing_curve", "status": "ok",
        "sampleCount": 17 }

event: progress
data: { "step": "detecting_risk_points", "status": "ok",
        "riskPointCount": 3 }

event: progress
data: { "step": "generating_suggestions", "status": "ok",
        "model": "claude-haiku-4-5-20251001" }

event: progress
data: { "step": "computing_calibration_placeholder", "status": "ok" }

event: complete
data: <AvdData>   // see §3.3
```

**Event sequence — apply-suggestions (§4.3):** see §4.3 example.

**Event-type catalog:**

| Event | Direction | Cardinality | Payload essentials |
|---|---|---|---|
| `progress` | server→client | many | `{ step: string, status: "ok" \| "warn", ...stepSpecific }` |
| `complete` | server→client | exactly 1 | `AvdData` |
| `error` | server→client | at most 1 | `{ code, message }` |

**Heartbeat.** Every 15s of stream wall-time, the server emits a comment-only line (`: heartbeat\n\n`). Clients tolerate (and ignore) lines beginning with `:`. The predictor's wall-clock budget (~10s) usually fits inside one heartbeat window, but the heartbeat is included for defensive parity with Stage 7's pattern.

**Cancellation.** If the client closes the connection mid-stream, the server aborts in-flight work (specifically: cancels the Haiku suggestion call mid-stream). Status reverts to `'scripted'` — the row is back to "ready to predict but no prediction yet." `avd_data` stays null.

### 4.5 `GET /api/runs/:runId/avd` — read prediction (no SSE)

**Auth:** required.

**Behavior:** Reads `pipeline_runs.avd_data` via the typed accessor, returns it as JSON. Used by the UI on initial mount to hydrate the AVD card before opening the SSE stream (which only fires on re-run or first run).

**Response:**
```typescript
// 200
{ avdData: AvdData | null, status: PipelineRunStatus }
```

If `avdData === null` and `status === 'avd_errored'`, the UI shows the error state (mockup State 4 — error fallback) with a "Try again" CTA.

If `avdData === null` and `status === 'predicting_avd'`, the UI opens the SSE stream to attach to the in-progress run.

This is the standard pattern for re-mounting a partially-completed run page; matches Stage 7's `GET /api/runs/:runId/script` (Spec #08 §4.5 plain-text endpoint serves a different purpose; the JSON read for Stage 7 lives at `GET /api/runs/:runId` returning the full row).

---

## 5. Business Logic

### 5.0 Auto-trigger semantics

The predictor auto-runs on every `'scripted'` transition:

1. **First Stage 7 completion** → predictor runs with the freshly written `script_data`.
2. **Stage 7 full regen** (user clicks "Regenerate" in the script card) → predictor re-runs.
3. **Stage 7 surgical regen via apply-suggestions** (§4.3) → predictor re-runs.
4. **Stage 7 surgical regen via the user's manual "Regen section" button** (Spec #08 §4.2) → predictor re-runs.

The predictor does **not** auto-run on:

- Stage 8 lint completion (`'lint_done'`).
- Stage 4 score regen (`'scoring' → 'scored'`).
- Channel niche edits (`channels.niche` mutation outside a run).

The auto-trigger is implemented in the orchestrator's `'scripted'` handler; nothing inside this spec's service layer subscribes to events.

### 5.1 Structural feature extraction

The predictor reads `script_data` (Spec #08 §3.3) and computes a feature vector. Each feature is a deterministic function of the script — no model, no randomness.

**Feature vector** (TypeScript interface in `lib/services/avd/features.ts`, all numeric):

| Field | Source | Notes |
|---|---|---|
| `runtimeSec` | `script.estimatedRuntimeSec` | Total runtime |
| `wordCount` | `script.totalWordCount` | Total |
| `sectionCount` | `script.sections.length` | 4-8 |
| `rehookCount`, `rehookPerMin` | `script.rehookBeats.length` / minutes | Density |
| `openLoopCount` | `script.openLoops.length` | 2-4 |
| `meanLoopDistanceSec` | mean of `payoff.startSec - setup.startSec` | 0 if no loops |
| `personalityZoneCount`, `personalityPerMin` | count of `marker === "personality"` paragraphs | Density |
| `brollCueCount`, `brollPerMin` | `sum(section.brollCues.length)` | Density |
| `demoTimePct` | `sum(demo section durations) / runtimeSec` | Niche-sensitive |
| `sectionWordDensity[]` | per-section words/sec | Used by risk-point detector |
| `monologueBlockCount`, `monologueBlocks[]` | walk paragraphs; emit a block when ≥90s of skeleton text accumulated with no `[PERSONALITY]` interruption AND no rehook beat at the boundary | Each block: `{ startSec, endSec, sectionIndex }` |
| `coldOpenSec` | `sections[0].endSec - sections[0].startSec` | Stage 7 hard-codes 15s; >20s flagged anti-pattern |
| `driftRisk` | `script.drift.driftDetected` | Re-used from Stage 7's drift check |

**Monologue-block detection algorithm.** Walk each section's `paragraphs` array. Maintain a running block start cursor and word counter. On `marker === "skeleton"`, accumulate; estimated block duration uses 150 wpm (`ScriptDataSchema`'s constant). On `marker === "personality"`, terminate any open block and emit if accumulated duration ≥ 90s. End-of-section: same emit check. Blocks straddling section boundaries are NOT joined — they reset at the boundary because a section transition is itself a pacing reset.

These features are NOT persisted independently — they're recomputed on every prediction run from `script_data`. The single source of truth is the script itself.

### 5.2 Heuristic formula — base AVD + structural multipliers

The predictor's core math, in `lib/services/avd/heuristic.ts`:

**Formula** (in `lib/services/avd/heuristic.ts`):

```
baseAvd = nicheBaselineRatio × 0.6 + channelBaselineRatio × 0.4
        [if channelBaselineRatio is null, baseAvd = nicheBaselineRatio]

predicted = baseAvd
          × rehookMultiplier
          × openLoopMultiplier
          × brollMultiplier
          × antiPatternMultiplier
          × personalityMultiplier
          × driftPenalty
          × lengthMultiplier

clamp(predicted, 25, 92)
```

**Multiplier table** (returned alongside the prediction as `multiplierBreakdown` for the methodology side panel; not persisted in `avd_data`):

| Multiplier | Formula | Range | Notes |
|---|---|---|---|
| `rehookMultiplier` | `1.05` if `rehookPerMin ∈ [0.5, 1.5]`; `1.02` if >1.5; `0.98` if ≥0.25; `0.92` if <0.25 | 0.92-1.05 | Sweet spot mirrors Stage 7's hard floor of `floor(runtimeSec/90)` rehooks |
| `openLoopMultiplier` | `1.08` if `openLoopCount ≥ 2 && meanLoopDistanceSec ≥ 180`; `1.03` if `≥2` but closer; `0.97` if `=1`; `0.92` if `=0` | 0.92-1.08 | Marvel-post-credit psychology — distant payoffs matter |
| `brollMultiplier` | `1.10` if `brollPerMin ∈ [1.5, 3.5]`; `1.04` if `≥0.75`; `0.98` if `≥0.25`; `0.95` else | 0.95-1.10 | Anecdotal sweet spot, calibrated by #14+#17 in Phase 3 |
| `antiPatternMultiplier` | `max(1 - 0.05 × n, 0.80)` where `n` = count of {`driftRisk`, `coldOpenSec > 20`, `monologueBlockCount > 2`, `demoTimePct > 0.65`} | 0.80-1.00 | Per the brief: -0.05 per anti-pattern, capped at -0.20 |
| `personalityMultiplier` | `1.04` if `personalityPerMin ∈ [0.5, 1.5]`; `1.0` if `≥0.25`; `0.96` else | 0.96-1.04 | Voice presence — too sparse reads robotic |
| `driftPenalty` | `0.93` if `driftRisk`; `1.0` else | 0.93-1.00 | Applied separately AND inside anti-patterns — intentional double-count, drift is a strong signal |
| `lengthMultiplier` | `1.04` (`≤300s`), `1.0` (`≤480s`), `0.97` (`≤720s`), `0.93` else | 0.93-1.04 | Natural decay; neutral at 8-min MVP default |

**Inputs** (interface `HeuristicInput`):

```typescript
{
  features: AvdScriptFeatures;        // §5.1
  nicheBaselineRatio: number;         // 0-100 — see §5.3
  channelBaselineRatio: number | null; // 0-100, null if no channel history
  nicheCorpusUsed: boolean;           // ≥30 niche videos in corpus
  channelHasEnoughHistory: boolean;   // ≥10 long-form videos
}
```

**Output** (interface `HeuristicOutput`):

```typescript
{ predictedAvdRatio: number; multiplierBreakdown: Array<{ name; factor; reason }> }
```

**Why these specific multipliers and constants:**

- **Niche/channel weights (60/40):** Phase 2 has tiny channel samples (≤50 videos) and possibly thousands of niche videos in the corpus. Heavier niche weight reduces noise. Phase 3+ (when we have publish-actuals via #17) inverts toward the channel.
- **Rehook sweet spot (0.5-1.5/min):** consistent with Stage 7's hard floor of `floor(runtimeSec / 90)` rehooks (Spec #08 §5.3). The predictor rewards being in that range, doesn't double-reward going way above.
- **Loop bonus (1.08):** matches the brief's spec exactly. Validated against `claude-youtube/script.md` Marvel-post-credit framing — loops with payoffs ≥3min away are the strongest known retention pattern.
- **B-roll range:** anecdotal — reflects best-practice creator advice (one cue every 20-40s). The data to calibrate this comes from #14 + #17.
- **Anti-pattern penalty (-0.05):** matches the brief's spec exactly. Capped at -0.20 to prevent total collapse on a script that triggers all four flags.
- **Length decay:** matches the natural retention decay observed in the Stage 7 heuristic (Spec #08 §5.6) — ~6-min half-life, so 12-min videos retain less than 8-min.
- **Floors/ceilings (25/92):** even a script with no rehooks, no loops, and drift is unlikely to retain 0%; YouTube's median AVD across all published videos is ~40%. The 92% ceiling is psychological — predicting 95%+ would be over-claiming.

**The `multiplierBreakdown` is NOT persisted in `avd_data`.** It's exposed via the SSE `progress.extracting_features` event for diagnostic UIs (mockup "Methodology" button — to be wired in Phase 2.1 polish). Persisting it would couple the data shape to the heuristic; we want freedom to swap the heuristic without a migration.

### 5.3 Niche and channel baselines

**Niche baseline** (`nicheBaselineRatio`):

**Niche baseline** (`computeNicheBaseline(niche)`):

1. Query `outlier_corpus` (Feature #14) filtered to `durationSec >= 120`, limit 500.
2. If `< 30` rows: return `{ ratio: NICHE_BASELINE_FALLBACK, sampleSize: 0, corpusUsed: false }`. (`NICHE_BASELINE_FALLBACK = 48` — global YouTube median AVD%.)
3. For each row, derive an AVD ratio: prefer `outlier_corpus.estimated_avd_ratio` (Feature #14 contract); fall back to `min(80, (viewCount / max(subscriberCount, 1000)) × 40)`.
4. Return median.

**Niche top-quartile** (used in `comparison`): same query, take p75 instead of median. Falls back to `NICHE_TOP_QUARTILE_FALLBACK = 65` when corpus is sparse.

**Channel baseline** (`computeChannelBaseline(channelId)`):

We do NOT have YouTube Analytics retention data in Phase 2. Proxy:

1. Read `channels.median_views`, `channels.subscriber_count`, `channels.top_videos_json`.
2. Filter `top_videos_json` to `durationSec >= 120`. If `< 5`: return `{ ratio: null, sampleSize: 0 }`.
3. Compute `subRatio = median_views / max(subscriber_count, 10000)`. The 10k floor biases hidden-subs channels toward neutral.
4. `proxy = 50 + min(20, subRatio × 200)`. Calibrated to ~50% AVD for an "average" channel (median_views = 5% of subs).
5. Clamp to `[35, 75]`. Return.

This is a **coarse proxy**, documented honestly in the UI tooltip ("calibrated against your channel's view-to-subscriber ratio — Phase 3 will use real retention data"). The proxy gets replaced by YouTube Analytics retention data when Phase 3 OAuth lands.

**Caching.** Both baselines are cached for 24h in the existing `youtube_api_cache` (Tier 0) keyed by `(niche, "avd_niche_baseline")` and `(channelId, "avd_channel_baseline")`. The corpus query against `outlier_corpus` is also cached at this layer.

### 5.4 Confidence interval

**Algorithm** (`computeConfidenceInterval`, in `lib/services/avd/confidence.ts`):

```
halfWidthPp = 4                                    // base ±4pp
halfWidthPp += 4   if !nicheCorpusUsed
halfWidthPp += 3   if !channelHasEnoughHistory
halfWidthPp += 8   if runtimeSec < 120
halfWidthPp += 2   if runtimeSec ∈ [120, 300)
halfWidthPp += 2   if predictedAvdRatio < 50       // risky zone has wider downside variance
halfWidthPp = min(halfWidthPp, 15)                 // cap

lowerSec = max(0, round(predictedSec - halfWidthPp/100 × runtimeSec))
upperSec = min(runtimeSec, round(predictedSec + halfWidthPp/100 × runtimeSec))
```

Phase 3 will replace this with the trained model's prediction interval (quantile regression or bootstrap). Phase 2's interval is **honestly described as a heuristic** in the UI's "What this means" tooltip.

### 5.5 Retention curve generation + risk-point detection

The retention curve has two roles: it's the SVG the UI renders, and it's the substrate from which risk points are detected.

**Curve generation algorithm** (`generateAvdRetentionCurve`, in `lib/services/avd/curve.ts`):

For each `t` in `[0, runtimeSec]` stepped by `stride = 30`:

1. **Natural decay (anchored to baseline).** `predicted = 100` for `t ≤ 30` (cold-open is "free"). For `t > 30`: target end-point is `baselineRatio` (the niche+channel composite anchor); apply exponential decay tuned so retention at `totalSec` ≈ `baselineRatio`:
   ```
   headroom = 100 - baselineRatio
   fraction = 1 - exp(-(t - 30) / ((totalSec - 30) × 0.4))
   predicted = 100 - headroom × fraction
   ```
2. **Rehook bumps:** `+5pp` if any rehook beat is within 15s of `t`.
3. **Open-loop payoff bumps:** `+6pp` if any loop payoff section's `startSec` is within `stride` of `t`.
4. **Demo density penalty:** `-5pp` and `riskFlag = "demo_density"` if `t` is in a `demonstration` section AND `(t - section.startSec) > 180`.
5. **Rehook gap penalty:** `-4pp` and `riskFlag = "rehook_gap"` (only if not already set) if `t > 90` AND time-since-last-rehook `> 120`.
6. **Topic pivot penalty:** `-2pp` and `riskFlag = "topic_pivot"` (only if not already set) on the first sample of a `payoff` or `loop_close` section.
7. **Monologue penalty:** `-6pp` and `riskFlag = "monologue"` (overrides all other flags) if `t` falls inside any `features.monologueBlocks[i]`.
8. **Clamp:** `predicted ∈ [15, 100]`. Round to int.

The natural-decay shape mirrors Stage 7's preview heuristic (Spec #08 §5.6) but is **anchored** to `baselineRatio` rather than free-decay. This is what makes the predictor's curve corpus-grounded vs. Stage 7's purely-structural curve.

**Risk-point detection** (`detectRiskPoints`, in `lib/services/avd/risk-points.ts`):

For each curve sample at index `i`:

1. Compute `dropPp = max(0, curve[i-2].predictedRetention - curve[i].predictedRetention)` (60s rolling window).
2. Aggregate flags: include `curve[i].riskFlag`. If `dropPp ≥ 10` and no flag set, default to `"rehook_gap"`. Skip if no flags.
3. Map the sample to its containing `ScriptSection` (the one whose `[startSec, endSec)` includes `timeSec`).
4. Severity:
   - `"hard"` if `dropPp ≥ 15` OR `flags.includes("monologue")`
   - `"moderate"` if `dropPp ≥ 10`
   - `"soft"` else
5. Problem description (deterministic templates, NOT LLM):
   - `monologue` → `"<blockSec>s of monologue without a rehook or open loop. Predicted drop matches the pattern on similar exposition blocks."`
   - `demo_density` → `"Demonstration section running <Ns> with no break. Information-dense block typically loses viewers around minute 6."`
   - `rehook_gap` → `"<Npp> predicted drop across a 60s window with no rehook beat. Common attention-fade location."`
   - `topic_pivot` → `"Section role transition. Viewers often drop here as the video shifts gears."`
   - else → `"<Npp> predicted drop in a 60s window."`
6. `expectedLiftPp` (rough estimate): `monologue → min(12, dropPp × 0.7)`, `demo_density → min(8, dropPp × 0.5)`, `rehook_gap → min(9, dropPp × 0.6)`, else `min(5, dropPp × 0.4)`.

**Dedup pass:** walk the produced points; for adjacent points within 90s, keep only the worst (highest `dropPp`). This collapses a multi-sample dead zone into a single annotation. Cap at 10 final risk points.

**Why dedup at 90s.** A long monologue block produces 3-4 consecutive risky samples each above the 10pp threshold. Showing 4 risk points for one problem clutters the UI. Dedup keeps the **worst** sample in each 90s window — matches the mockup's pattern of one annotation per section.

### 5.6 Suggestion text — Haiku 4.5 (CRIT-2 compliance)

The only LLM call in the predictor pipeline. Per CLAUDE.md CRIT-2, **suggestion text uses Haiku 4.5** — short structured output, format-driven, low-stakes. Opus 4.7 here would be a 12× cost violation for zero quality gain.

**Prompt location.** `lib/prompts/avd-suggestions.ts`. Per CRIT-3 the system prompt (~1100 tokens) uses `cache_control: { type: "ephemeral" }`.

**Per CRIT-4** — this stage has no `claude-youtube` analogue. The prompt is YouTube-Viralizer-original; no attribution comment needed.

**Batched call.** All risk points' suggestions are generated in **one** Haiku call, not N calls. Batching cuts per-call overhead and the system prompt is cached once.

```typescript
// lib/prompts/avd-suggestions.ts
export const AVD_SUGGESTIONS_SYSTEM_PROMPT = `
You are a short-form retention coach for YouTube creators. Your job: given a list of identified
"risk points" in a script, write ONE concise (30-280 char) structural fix per risk point.

Each suggestion must:
- Be 1 sentence
- Be a structural change (not "be more interesting"); name a specific tactic: cut N seconds,
  insert a rehook, move a callback, tease a payoff, condense to bullets, etc.
- Reference a specific timestamp or section name
- Avoid vague advice ("add personality") and avoid hostage-pattern CTAs ("smash that subscribe")
- Match the channel's tone — it's a peer-to-peer script

You will receive an array of risk points and must return a JSON array of strings, one per risk
point, in the same order. Do not return any other text — only the JSON array.
`;

export function buildAvdSuggestionsUserPrompt(input: {
  niche: string;
  scriptTitle: string;
  scriptHook: string;
  riskPoints: Array<{
    id: string;
    timeSec: number;
    flags: string[];
    problem: string;
    sectionIndex: number;
    sectionTitle: string;
    sectionRole: string;
    surroundingScriptExcerpt: string; // 200-400 chars from the section
  }>;
}): string {
  return JSON.stringify({
    niche: input.niche,
    scriptTitle: input.scriptTitle,
    scriptHook: input.scriptHook,
    risks: input.riskPoints.map((r) => ({
      id: r.id,
      atSec: r.timeSec,
      flags: r.flags,
      problem: r.problem,
      section: { index: r.sectionIndex, title: r.sectionTitle, role: r.sectionRole },
      excerpt: r.surroundingScriptExcerpt,
    })),
  });
}
```

**Service call** (`generateRiskSuggestions`, in `lib/services/avd/suggestions.ts`):

```typescript
const response = await anthropic.messages.create({
  model: "claude-haiku-4-5-20251001",
  max_tokens: 1500,
  system: [
    { type: "text", text: AVD_SUGGESTIONS_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
  ],
  messages: [{ role: "user", content: buildAvdSuggestionsUserPrompt(...) }],
});

const parsed = z.array(z.string().min(30).max(280)).safeParse(JSON.parse(text));
if (!parsed.success || parsed.data.length !== risks.length) {
  return risks.map((r) => fallbackSuggestion(r));   // degraded mode
}
return parsed.data;
```

**Degraded fallback** (Haiku 4xx-fails after EXT-3 retries OR malformed output) — deterministic templates per flag:

| Flag | Fallback text (with `t = formatTimestamp(timeSec)`) |
|---|---|
| `monologue` | `Insert a rehook at <t> or break the block with a personality beat.` |
| `demo_density` | `Compress the demonstration around <t> or move a callback earlier.` |
| `rehook_gap` | `Add a rehook beat at <t>.` |
| `topic_pivot` | `Tease the next section's payoff before transitioning at <t>.` |
| else | `Tighten content around <t> — this is a known attention-fade location.` |

The fallback is **always usable** — every risk point has *some* suggestion text even when the LLM is down. The persisted `AvdData.suggestionModel` stays `"claude-haiku-4-5-20251001"` (we don't lie about the model — we just used the fallback path; tracked separately via a `suggestionsDegraded: boolean` field added to `AvdData` as a non-breaking optional in v1.1 if/when we surface it).

### 5.7 Short-script handling

If `scriptData.estimatedRuntimeSec < 120` (Stage 7 produced a sub-2-minute script — possible but rare given Stage 7's 5-min minimum target):

1. Emit `progress` event `{ step: "script_too_short", status: "warn", runtimeSec: <n> }`.
2. Skip the structural feature multipliers — set `predictedAvdRatio = nicheBaselineRatio` (no adjustments).
3. Set `confidenceInterval.halfWidthPp = 12` (much wider).
4. Set `scriptTooShort = true`.
5. Emit minimal risk points (only `monologue` flags, since rehook/loop math doesn't apply at <2min).
6. UI surfaces a banner "Predicting at niche baseline — script is shorter than 2 minutes" (mockup not provided, render the State 4 amber-banner pattern).

This is **not** an error — predictions are still emitted, just clearly de-confidenced. Per the brief: "SCRIPT_TOO_SHORT — flag, predict at niche baseline."

### 5.8 Calibration placeholder

Phase 2 always writes:

```typescript
calibration: {
  state: "pending",
  attachedAt: null,
  actualAvdRatio: null,
  actualAvdSec: null,
  errorPp: null,
  trailingMeanAbsErrorPp: null,
  trailingDirectionAccuracy: null,
}
```

**Feature #17 (post-publish loop, Tier 3.4)** writes here when:

1. The user marks a run as "published" via the UI it provides.
2. YouTube Analytics OAuth (Phase 3) is connected — OR — the user pastes their AVD manually into a form #17 surfaces (manual mode is the Phase 2.5 fallback).
3. The trailing window job aggregates the channel's last 6 calibrated runs and writes `trailingMeanAbsErrorPp` / `trailingDirectionAccuracy` back to ALL of those rows.

The mockup State 2's right column "Calibration" widget reads exclusively from this field. Until #17 lands, that widget renders the empty state ("Fills in after publish") with a placeholder list.

### 5.9 Prompt caching strategy (CRIT-3 compliance)

Only one prompt in this feature: the suggestion-text Haiku call (§5.6). The system prompt (~1100 tokens) is above the 1024-token threshold and MUST use `cache_control: { type: "ephemeral" }` per CRIT-3.

```typescript
system: [
  { type: "text", text: AVD_SUGGESTIONS_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
]
```

The user prompt varies per call (different risk points + different excerpts) — not cached. The system block hits cache for every predictor run within the 5-min ephemeral TTL. Cache hit rate expectation: >75% under sustained load (predictor runs cluster around active editing sessions).

---

## 6. State Management

### 6.1 Server state

Authoritative for: `pipeline_runs.avd_data`, `pipeline_runs.status`, the per-channel predictor + apply-suggestions rate caps, the daily Anthropic spend counter (shared with all stages).

Recomputed on every read of `avd_data` (defensive — matches Stage 7's pattern):

- `predictedAvdRatio = round(predictedAvdSec / inputs.scriptRuntimeSec * 100)` — recomputed and assert-equal to persisted value.
- `band` derived from `predictedAvdRatio` — recomputed and assert-equal.
- `comparison.thisScript === predictedAvdRatio` — invariant.

Discrepancies between persisted and recomputed values are logged but don't error — defensive read.

### 6.2 Client state

- The **AVD card** (mockup states 1-4) is a discriminated-union React state held inside `<AvdPredictorCard runId={...} />` in `app/(app)/runs/[runId]/_components/`. No global store.
- **Streaming buffer.** During SSE consumption, the component holds a list of received `progress` events (rendered as the step-list in mockup State 1). The final `complete` event swaps the component into the Full View state (State 2 or State 3 depending on `band`).
- **Selected suggestions.** The user can multi-select risk points via the inline checkboxes (added to State 2's risk-points list — not in mockup yet, see §10 decision). Selection is held in component-local state; `Apply suggestions` button is disabled until ≥1 selected. On click, opens a confirmation modal listing the affected sections.
- **No global state library** required. The `useStageStream` hook from Tier 0 handles SSE.

### 6.3 Optimistic updates

- **None.** Predictor runs in 8-14s; the loading state IS the UX.
- **Apply suggestions** is non-optimistic — the confirmation modal triggers the regen flow, the user watches the SSE stream re-run the script regen + predictor.

### 6.4 Re-runnability per A-2

The orchestrator can re-run the predictor by calling `POST /api/pipeline/avd-predict` with no body fields beyond `runId`. This works in any of these states:

- `'scripted'` (first run) → predictor fires.
- `'avd_predicted'` (re-run requested) → predictor fires, overwrites avd_data.
- `'avd_errored'` (recovery) → predictor fires.

The endpoint returns `409 PREDICT_IN_PROGRESS` if already in `'predicting_avd'` — the orchestrator's standard pattern.

### 6.5 Wall-clock budget

Predictor SSE timing breakdown (target — 12s p50, 14s p99):

| Step | Duration | Notes |
|---|---|---|
| `validating_inputs` + `loading_script` | 50ms | DB read |
| `extracting_features` | 100ms | Pure CPU, walks paragraphs |
| `calibrating_channel` | 200ms (cache hit) / 800ms (miss) | DB read + maybe-fetch |
| `calibrating_niche` | 200ms (cache hit) / 1.5s (miss) | outlier_corpus query |
| `computing_curve` | 50ms | Pure CPU |
| `detecting_risk_points` | 50ms | Pure CPU |
| `generating_suggestions` | 4-8s | Haiku call (the dominant cost) |
| `computing_calibration_placeholder` | 10ms | Pure structure write |
| Validate + persist + emit complete | 100ms | DB write |

A run with 0 risk points skips the Haiku call entirely (drops to ~3s wall-clock).

---

## 7. UI/UX Behavior

### 7.1 Routes

The predictor lives inside the existing `/runs/[runId]` route as a card (matches the mockup). It does NOT have its own route. The card renders one of 4 view-states based on `pipeline_runs.status` and `avd_data`:

| View | Trigger condition | Mockup state |
|---|---|---|
| **Predicting** | `status === 'predicting_avd'` AND active SSE stream is open | State 1 |
| **Viral / Solid** | `status === 'avd_predicted'` AND `band ∈ {viral, solid}` | State 2 |
| **Risky** | `status === 'avd_predicted'` AND `band === 'risky'` | State 3 |
| **Errored** | `status === 'avd_errored'` OR `(status === 'scripted' && manual re-run failed)` | State 4 |

Pre-Stage-7 (`status` ∈ `{titles_locked, scripting, hook_done, ...}`), the AVD card renders a **collapsed/disabled** state with copy "Available after the script is generated" — matches the existing pre-stage pattern in the run page.

### 7.2 Predicting view (mockup State 1)

- Header card: "AVD Prediction" title, "Predicting" pill (blue, pulsing dot).
- Indeterminate shimmer bar.
- Step list — 5 items, each transitions from gray (pending) → spinning (in-progress) → green check (complete) as `progress` events arrive:
  1. Parsing script into sections — `loading_script`
  2. Extracting structural features — `extracting_features`
  3. Calibrating against your channel's retention history — `calibrating_channel`
  4. Generating per-minute retention curve — `computing_curve`
  5. Detecting dead zones & suggesting fixes — `detecting_risk_points` + `generating_suggestions`
- "Cancel" button (right-aligned in the header). Click → aborts SSE, reverts `status` to `'scripted'`.
- Footer text: "Typically 8-14s. Re-runs automatically if you regenerate the script."

### 7.3 Viral / Solid main view (mockup State 2)

- **Header card:** "AVD Prediction" + classification pill ("Viral zone" green / "Solid" emerald-amber) + "Channel-calibrated" pill (tooltip explains the proxy — §5.3). Header actions: Re-run, Methodology.
- **Top-line column (lg:col-span-4):** large mm:ss / runtime ratio / percentage / "± Npp confidence"; band reference grid (Risky / Solid / Viral) with active band highlighted; 1-sentence summary generated deterministically from `multiplierBreakdown` (e.g. take top-2 factors >1.02 and worst risk count → "Strong <factor1> and <factor2>. <N> soft spots flagged.").
- **Retention curve (lg:col-span-8):** SVG matching the mockup — gradient-filled red curve for "this script", dashed emerald for channel median, dotted violet for niche top quartile. Risk markers: red circle + dashed vertical at each `riskPoints[i]` with `−Npp` label. Win markers: green circles at samples where retention bumps `+≥4pp`. Legend top-right.
- **Risk points list (lg:col-span-7):** header + count pill; per row — timestamp pill (severity-colored), section title + drop pill, problem description, "Suggested fix" emerald callout with Haiku text, inline actions (Jump to script / Copy fix / multi-select checkbox). Optional recovery/win rows in emerald. Footer: "Apply suggestions to script" CTA (disabled until ≥1 selected).
- **Comparison block (lg:col-span-5):** "Comparison" header. Three horizontal bars (This script yt-red / Channel emerald / Niche top quartile violet). Channel subtitle in Phase 2: "Across N proxied long-form videos" (honest about proxy). Niche subtitle: niche string · "top 25% of outliers in corpus". Summary line: "+N pp above your channel median and +M pp above niche top quartile."
- **Calibration block (lg:col-span-5, below Comparison):** "Calibration" header + "Fills in after publish" pill when `state === 'pending'`. Two stat tiles (Mean abs. error / Direction accuracy) empty in Phase 2. Recent prediction-vs-actual list empty until #17 populates.
- **Footer:** "Back to script" / "Continue" (advances to Stage 9 — only enabled if `'lint_done'` is also reached; otherwise disabled with tooltip).

### 7.4 Risky main view (mockup State 3)

- **Top banner** (rose-themed): "This script is in the risky zone. Predicted retention is below 50%. We'd recommend revising before filming."
- Same card layout as State 2, but:
  - Top-line column uses rose accents.
  - Band reference grid highlights "Risky".
  - 1-sentence summary skews diagnostic ("Top driver: 4 monologue blocks > 90s with no rehook").
  - Retention curve renders with rose gradient (mockup `fillGradRisk`).
- **"Top 3 fixes — projected lift +Npp"** strip below the curve. Three condensed risk-point cards (the worst 3 by `expectedLiftPp`) with the "+Npp" lift each. Below the strip: "Re-prediction would land at ~M% (viral zone)" — computed by simulating the application of just those 3 fixes.
- **Footer:** "Ship anyway →" (proceeds with the existing prediction; sets a `dismissed_risky_warning_at` localStorage flag) / "Apply suggestions to script" CTA.

### 7.5 Errored view (per the standard pipeline error pattern)

| Trigger | UI |
|---|---|
| `MISSING_PREREQUISITES` | "Generate the script first to predict AVD." Link to script card. |
| `UPSTREAM_ERROR` (degraded suggestions) | Main view renders normally; each risk point shows fallback suggestion + amber "Suggestion fallback used" pill. |
| `RATE_LIMITED` | Inline banner with retry-after countdown. |
| `BUDGET_EXCEEDED` | "We're temporarily over capacity. Try again at midnight UTC." |
| `INTERNAL_ERROR` | "Something went wrong predicting AVD. Try again." Try Again CTA re-runs §4.1. |

### 7.6 Apply-suggestions modal

Triggered by "Apply suggestions to script" CTA after ≥1 risk-point checkbox selected. Title: "Apply N suggestions". Body lists each selected suggestion grouped by section ("Section 3: regenerate with these fixes — [bullet list]"). Warning: "This will regenerate the listed sections of your script. The rest of the script will be preserved." Footer: Cancel / Apply suggestions (red primary). On confirm: dismisses modal, transitions both the AVD card and the Stage 7 card to streaming states (the unified SSE stream §4.3 drives both).

### 7.7 Methodology side panel (Phase 2.1 polish)

Click "Methodology" in the header → slide-in side panel. Renders the multiplier breakdown table from the `extracting_features` SSE event (one row per multiplier in §5.2 with its `factor` and `reason`). Below the table: disclaimer "This is a heuristic predictor. Phase 3 will replace it with a model trained on your channel's actual retention data."

### 7.8 Tooltip copy (must ship in Phase 2 minimum)

- **Channel-calibrated:** "Calibrated against your channel's view-to-subscriber ratio across N long-form videos. Phase 3 will use real YouTube Analytics retention data."
- **Predicted AVD:** "Predicted Average View Duration. The % of the video the average viewer watches. 50-70% is solid; 70%+ is the viral zone."
- **± Npp confidence:** "Prediction interval — actual AVD likely falls within this range. Wider when corpus or channel data is sparse."
- **Risk point:** "A predicted drop of 10pp+ across a 60s window. Click to jump to the spot in your script."

---

## 8. Edge Cases

| Case | Behavior |
|---|---|
| `script_data` is null when predictor fires | Pre-flight returns `MISSING_PREREQUISITES`. Should not happen via auto-trigger (only fires on `'scripted'`). |
| `outlier_corpus` is empty for the channel's niche | `nicheBaselineRatio = NICHE_BASELINE_FALLBACK (48)`, `comparison.nicheCorpusUsed = false`, `inputs.outlierCorpusUsed = false`. UI tooltip explains. |
| `outlier_corpus` returns 28 videos for the niche (just under the 30 threshold) | Treated as fallback (corpus not used). The threshold is intentionally hard — "30 minimum" is an honest line. |
| Channel has 0 long-form videos (all Shorts) | `channelBaselineRatio = null`. Heuristic falls back to niche-only base. UI shows "no channel history available — using niche baseline only" tooltip. |
| Channel has hidden subs (`subscriber_count IS NULL`) | Channel baseline proxy uses `Math.max(subscriber_count ?? 10000, 1)` — the 10k default biases toward neutral. UI doesn't surface this fallback (cosmetic only). |
| Script is exactly 119s | `scriptTooShort = true` (threshold is `< 120s`). Wider confidence interval. Niche-baseline-only prediction. |
| Script is 121s | Normal prediction. Confidence interval slightly wider (+2pp halfWidth, per §5.4) but no `scriptTooShort` flag. |
| Stage 7 produced a script with 0 rehooks (despite Spec #08 §5.3 floor) | Rehook multiplier 0.92; predictor runs normally. The script is technically format-violating per Stage 7's rules, but if it slipped through, we predict on it as-is. |
| Stage 7 produced a script with 0 open loops | Loop multiplier 0.92; predictor runs normally. Same logic. |
| Risk-point Haiku call fails (UPSTREAM_ERROR after retries) | Predictor falls back to deterministic suggestions (§5.6) and emits `complete` with a `degraded` progress event preceding it. UI surfaces the amber pill on each suggestion. |
| User clicks Re-run while prediction is in progress | `409 PREDICT_IN_PROGRESS`. Toast: "Already predicting." |
| User clicks Apply suggestions and a Stage 7 surgical regen fails format check | Stream emits `STAGE7_FORMAT_VIOLATION`. The other selected sections were regenerated successfully (or not, depending on order — the apply endpoint serializes section regens). The predictor is **not** re-run. UI surfaces an inline rose banner: "Section 3 regen failed — try a different suggestion." |
| User cancels mid-stream | SSE aborts. Status reverts to `'scripted'` (or `'avd_predicted'` if a previous prediction existed — the previous `avd_data` is preserved). |
| User opens a 2nd browser tab on the same run | The 2nd tab subscribes to the same SSE stream via shared backend orchestrator queue. Both tabs see the same events. Predictor is single-flight per `runId`. |
| User edits `channels.niche` after a prediction was made | The prediction is now stale (different niche → different baseline). UI does NOT auto-invalidate — the user re-runs manually. **TODO Phase 3:** auto-invalidate on niche edit. |
| Run is `'avd_errored'` and user navigates back later | UI renders the errored view with "Try again" CTA. Click triggers a manual `POST /api/pipeline/avd-predict`. |
| User has 0 publish-actuals (Phase 2 always) | Calibration block renders empty state. No "stale" warnings. |
| Predicted ratio rounds to exactly 50% | Falls into `solid` band (the boundary is `< 50` for risky; 50 inclusive is solid). |
| Predicted ratio rounds to exactly 70% | Falls into `viral` band (`>= 70`). |
| Confidence interval lower bound goes below 25% | Clamp `lowerSec` at 25% × runtime. The point estimate has its own clamp at 25%; the interval can extend below for very-uncertain predictions. **Decision:** clamp interval at 25 too — keeps the UI from rendering "predicted 28% ± 5pp = 23-33%" which feels worse than the floor allows. |
| Risk-point clusters: 5 risks within 90s | Dedup keeps the 1 worst. The deduped risks are NOT silently lost — they're aggregated into the kept risk's `flags` array (max 3 flags per risk). |
| `runtimeSec` is exactly 30 (impossible from Stage 7 but defensive) | `scriptTooShort = true`. Curve has 2 samples (t=0, t=30). Single-sample curve UI tolerates. |
| `runtimeSec` is 1800 (max allowed by Stage 7 — 20 min × 60 + buffer) | Curve has 61 samples. UI's SVG `viewBox` adjusts X-axis labels. Within `retentionCurve.max(80)` schema cap. |
| Apply-suggestions selects suggestions with overlapping `sectionIndex` | Sections are deduped — one regen call per unique section. The selected suggestions for that section are concatenated into the steering. |
| Apply-suggestions selects 5 suggestions across 5 different sections | 5 sequential Stage 7 regen calls. Each takes ~30-60s. Total flow: ~3-5min. UI shows progress per section. |
| User disconnects from network mid-apply-suggestions | Server completes the in-flight section regens; on reconnect, the user's UI re-fetches `pipeline_runs` and sees whatever state the server reached. The predictor may or may not have re-run depending on where the disconnect happened. |
| Niche corpus has only data for `<2 min` videos (e.g. Shorts-only niche) | The `minDurationSec: 120` filter returns 0 → fallback. (Edge case: a creator transitioning from Shorts to long-form.) |
| The script's `drift.driftDetected === true` but the user already dismissed the drift warning in Stage 7 | Predictor still applies the drift penalty multiplier. The user's UI dismissal is cosmetic, not a structural override. |

---

## 9. Security Considerations

- **Auth-gated:** middleware on `(app)` route group enforces session presence. Unauthenticated requests to predictor APIs return `401 UNAUTHENTICATED`.
- **RLS:** every read/write to `pipeline_runs` is filtered by `auth.uid()`. Reading `avd_data` for another user's run returns 0 rows → `RUN_NOT_FOUND`. RLS is the second line of defense.
- **IDOR protection:** every endpoint that takes `runId` reads the row with `where user_id = auth.uid()`. Returns 404 (never 403 — don't leak existence). SEC-2.

### 9.1 Rate limits

Per CLAUDE.md SEC-3 / pattern from Spec #08:

- `POST /api/pipeline/avd-predict`: max **30 predictor runs per channel per 24h**. Stored as a counter row in `rate_limits` keyed by `(user_id, channel_id, "avd_predict_24h")` with a 24h TTL.
- `POST /api/pipeline/avd-predict/apply-suggestions`: max **20 apply-suggestions per channel per 24h**. Same table, key `"avd_apply_24h"`.

The 30 predictor cap is intentionally permissive — apply-suggestions auto-re-runs the predictor, and we don't want to throttle iteration. The 20 apply-suggestions cap is tighter because each apply costs Stage 7 Opus tokens (the dominant Anthropic spend).

Daily Anthropic spend cap (shared across all stages) is enforced at the predictor layer too — a `BUDGET_EXCEEDED` from the orchestrator's spend counter blocks the Haiku call and falls back to deterministic suggestions (degraded mode) rather than failing the whole stream.

### 9.2 Prompt-injection defense

The Haiku suggestions call's user prompt includes:

- `niche` (user-controlled — set by the channel owner during onboarding)
- `scriptTitle` (LLM-generated, but fed into another LLM)
- `scriptHook` (LLM-generated)
- `surroundingScriptExcerpt` (LLM-generated)

All four are passed inside a structured JSON object, NOT as freeform text in a prompt template. The system prompt explicitly instructs: "You will receive an array of risk points and must return a JSON array of strings, one per risk point, in the same order." The model is constrained to return JSON — any prompt-injection attempt to subvert the format is caught by the Zod parse on the response.

Even if the model returns subverted content, the worst case is a malformed suggestion text, which is caught by `z.string().min(30).max(280)` and falls back to deterministic suggestions.

### 9.3 PII

The predictor processes:

- The script text (LLM-generated, not user-PII)
- The niche string (user-controlled but channel-public on YouTube)
- Channel median views, subscriber count, top videos (all public on YouTube)

No private user data is processed. No additional encryption beyond Supabase defaults.

### 9.4 Output safety (SEC-3)

Suggestion text is rendered via React JSX (default escape). Never `dangerouslySetInnerHTML`. The Haiku output is bounded (≤280 chars), JSON-parsed, schema-validated, then JSX-rendered.

### 9.5 Error-message leakage

Anthropic and YouTube error bodies are logged server-side (Sentry) but never returned to the client. The client only sees the codes in §4.1/§4.3.

### 9.6 CSRF

Next.js Server Actions and same-origin SSE requests are CSRF-protected by default. POST routes verify the `Origin` header.

---

## 10. Future Considerations (Out of Scope for Phase 2)

The following are intentionally deferred. Each is tracked elsewhere — do not implement as part of this feature.

### 10.1 Decisions explicitly flagged in this spec

- **Apply-suggestions does NOT offer a side-by-side diff preview before commit (§4.3).** Phase 2 ships the destructive flow with a confirmation modal listing affected sections. Phase 3 candidate: a side-by-side diff view of "current section" vs. "would-be-regenerated section" with an explicit accept/reject step.
- **Apply-suggestions sequential regen (§4.3).** Stage 7 surgical regens are serial, not parallel — concurrent regens would race on `script_data`. Phase 3 candidate: lock-and-merge regen.
- **Confidence interval lower bound clamped at 25% (§8).** UI never renders sub-25% bounds even when the heuristic's variance suggests it could. Phase 3 candidate: revisit floors when trained model lands.
- **Methodology side panel is Phase 2.1 polish, not minimum (§7.7).** Phase 2 minimum is a tooltip; full breakdown panel ships in 2.1.

### 10.2 Phase 3+ deferred features

- **Trained AVD predictor (replaces heuristic).** Built on the calibration corpus accumulated by Feature #17. Replaces `lib/services/avd/heuristic.ts` with an inference call. The schema is forward-compatible — add `predictorModel` populated, keep `version: "v1"`.
- **YouTube Analytics OAuth integration.** Pulls real per-video retention curves to replace the channel-baseline proxy in §5.3. Requires Google OAuth scope `youtube.readonly`. Phase 3.
- **Per-second curve granularity.** Mockup is 30s-stride. Per-second would 30× the data without obvious value; reserved for if/when video editors integrate.
- **CTR / traffic-source-mix / subscriber-conversion prediction.** Different signals; separate features.
- **Auto-rewrite dead zones without explicit Apply.** "Auto-fix" button that applies all suggestions silently. Phase 3 candidate, but governance is non-trivial — may always require explicit user action.
- **Anonymized peer-channel AVD distribution.** "Channels in your niche typically retain X%" with a histogram. Requires a privacy-respecting aggregation pipeline.
- **Niche-edit auto-invalidation.** When `channels.niche` is edited, mark all `avd_data` for that channel's runs stale and offer re-run. Phase 3.
- **Calibration trailing-window job.** The cron that aggregates the channel's last 6 published runs and updates `trailingMeanAbsErrorPp` / `trailingDirectionAccuracy` on all 6 rows. Owned by Feature #17.
- **Manual-publish AVD entry form.** Phase 2.5 fallback while OAuth is pending. The user pastes their actual AVD into a form #17 surfaces; it writes into `calibration.actualAvdRatio` directly.
- **Suggestion application telemetry.** Tracking which suggestion archetypes (rehook insertion, demo compression, callback re-order) yield the highest measured retention lift post-publish. Feeds back into the heuristic's multiplier constants.
- **Multi-channel AVD comparison.** Across the user's 3 channels, compare predicted-vs-actual delta. Niche-of-business analytic; deferred.

---

## Appendix A — File map

This spec implies the following files exist by the end of implementation:

```
app/
  (app)/
    runs/[runId]/_components/
      AvdPredictorCard.tsx              # main card — view-state machine
      AvdPredictingView.tsx             # State 1
      AvdMainView.tsx                   # State 2 / State 3 base
      AvdRetentionCurveSvg.tsx          # SVG renderer for retentionCurve
      AvdRiskPointsList.tsx             # risk-points list with multi-select
      AvdComparisonBars.tsx             # 3-bar comparison widget
      AvdCalibrationWidget.tsx          # State 2 right column placeholder
      AvdMethodologySidePanel.tsx       # Phase 2.1 polish — multiplier breakdown
      AvdApplySuggestionsModal.tsx      # confirmation before destructive regen
  api/
    pipeline/
      avd-predict/
        route.ts                        # POST → SSE (predictor)
        apply-suggestions/route.ts      # POST → SSE (apply + re-predict)
    runs/[runId]/
      avd/route.ts                      # GET hydration

lib/
  services/
    avd/
      index.ts                          # public service surface (predictAvd, applySuggestions)
      features.ts                       # extractAvdScriptFeatures
      heuristic.ts                      # computeHeuristicAvd
      baselines.ts                      # niche + channel baseline computation
      curve.ts                          # generateAvdRetentionCurve
      risk-points.ts                    # detectRiskPoints + describeProblem + estimateLift
      suggestions.ts                    # Haiku call + degraded fallback
      confidence.ts                     # computeConfidenceInterval
      summary.ts                        # 1-sentence summary line for top-line column
  prompts/
    avd-suggestions.ts                  # Haiku system prompt + user-prompt builder
  validation/
    avd.ts                              # Zod schemas (AvdDataSchema and friends)
  db/
    runs.ts                             # extended with getRunAvd / setRunAvd typed accessors

supabase/
  migrations/
    0015_add_avd_data.sql               # the migration in §3.1
```

## Appendix B — Cross-feature contracts and CLAUDE.md updates

When this spec is implemented, the following sections of CLAUDE.md and other specs must be updated:

### B.1 CLAUDE.md updates required

1. **CRIT-2 model assignment table:** add a row for "AVD Predictor — suggestion text — `claude-haiku-4-5-20251001` — short structured output, format-driven" so future devs don't flag the Haiku usage as needing justification. The predictor itself is non-LLM; no CRIT-2 row needed for the heuristic.
2. **Stage 8/9 ordering note:** the existing pipeline ordering doc should mention that predictor runs in parallel with Stage 8 (lint), both off the `'scripted'` event.
3. **Common Mistakes section:** add an entry if/when an implementation bug surfaces during build (per the existing convention).

### B.2 Cross-feature contracts (read by other specs)

Other specs read `pipeline_runs.avd_data` via these contracts:

- **Feature #17 (Calibration loop, Tier 3.4)** writes into `avd_data.calibration` (only field). It MUST go through the typed `setRunAvdCalibration(runId, calibration)` accessor in `lib/db/runs.ts` to preserve the rest of the field. It MUST NOT replace `avd_data` wholesale (would erase predictions).
- **Feature #16 (Compound-effect forecast, Tier 3.5)** reads `avd_data.predictedAvdRatio` as one of its inputs. It MUST call `getRunAvd(runId)` and tolerate `null` (predictor may not have run yet).
- **The run-export feature (Phase 2 polish)** reads `avd_data` for the printable kit summary — typed accessor only.

### B.3 Contracts this spec depends on (read FROM other specs)

This spec reads:

- **`pipeline_runs.script_data`** — owned by Spec #08 (Stage 7). Schema: `ScriptData v1` from `lib/validation/script.ts`. Read via `getRunScript(runId)` typed accessor. We do NOT mutate it; Stage 7's own surgical-regen endpoint is the only writer.
- **`channels.niche`** — owned by Spec #01. Read via `getChannelById(channelId)`.
- **`channels.median_views`** — owned by Spec #01. Same accessor.
- **`channels.subscriber_count`** — owned by Spec #01. Same accessor.
- **`channels.top_videos_json`** — owned by Spec #01. Same accessor; we only use `durationSec` and `viewCount` fields.
- **`outlier_corpus`** — owned by Spec #14 (Hybrid scoring engine). Read via `getOutlierCorpusForNiche(niche, opts)`. Graceful fallback when empty (§5.3). The `outlier_corpus.estimated_avd_ratio` field is ASSUMED to exist per #14's spec; if #14 ships without it, we use the views/subs proxy fallback.

### B.4 Configuration constants added to `lib/config.ts`

```typescript
export const AVD_BANDS = {
  risky:    { min: 0,   max: 50  },
  solid:    { min: 50,  max: 70  },
  viral:    { min: 70,  max: 100 },
} as const;

export const NICHE_BASELINE_FALLBACK     = 48;  // % — global median when corpus is empty
export const NICHE_TOP_QUARTILE_FALLBACK = 65;  // % — global p75 when corpus is empty
export const AVD_PREDICTOR_HAIKU_MODEL   = "claude-haiku-4-5-20251001" as const;
export const AVD_RATE_LIMIT_PREDICT_24H  = 30;
export const AVD_RATE_LIMIT_APPLY_24H    = 20;
export const AVD_SCRIPT_TOO_SHORT_SEC    = 120;
export const AVD_RISK_DROP_THRESHOLD_PP  = 10;   // %-point drop threshold for risk-point detection
export const AVD_RISK_WINDOW_SEC         = 60;   // rolling-window for drop calculation
export const AVD_RISK_DEDUP_WINDOW_SEC   = 90;
export const AVD_RISK_MAX_COUNT          = 10;
export const AVD_CURVE_STRIDE_SEC        = 30;
```

### B.5 Notable deferred decisions (open for Phase 2.1 review)

- Should the predictor expose the multiplier breakdown directly in `avd_data`? Currently SSE-only. (Status: deferred — would couple data shape to heuristic.)
- Should apply-suggestions support partial success (some sections regen, others fail)? Currently fail-fast. (Status: deferred — Phase 3.)
- Should the predictor run on Stage 7 single-section regens too, or only full-script regens? Currently runs on every `'scripted'` event including surgical regens. (Status: kept — see §5.0.)
- When Feature #17 lands and `calibration.actualAvdRatio` is populated, should the UI show a "prediction was N pp off" pill on the prediction card? Currently no — calibration block is the disclosure. (Status: deferred.)
