# Build Order — YouTube Viralizer

This document sequences every feature from `Master-Overview.md` for implementation. Read this in conjunction with `CLAUDE.md` (rules) and `Master-Overview.md` (vision).

The build is divided into four tiers:

- **Tier 0 — Technical Foundation** (no user-facing value, but everything depends on it)
- **Tier 1 — User Foundation** (auth, channel context, idea workspace)
- **Tier 2 — Core Value (12-stage pipeline)**
- **Tier 3 — Enhancement (Phase 2)**
- **Tier 4 — Phase 3 (AI thumbnails + LoRA)**

Within each tier, items are listed in build order. Where items can be developed in parallel, this is called out explicitly.

---

## Tier 0 — Technical Foundation

These items are not in the Master Overview's feature list because they're not user-facing, but **everything in Tier 1 and beyond depends on them.** Build these first, in this order.

### 0.1 — Project scaffold

- **Category:** Foundation
- **Dependencies:** None
- **Reasoning:** Cannot write any code without the Next.js app initialized, TypeScript strict mode configured, Tailwind installed, and ESLint/Prettier set up.
- **Output:** A running `next dev` with a placeholder home page.

### 0.2 — `ATTRIBUTIONS.md` + reference skill clone

- **Category:** Foundation
- **Dependencies:** 0.1
- **Reasoning:** CLAUDE.md CRIT-4 requires MIT attribution before we lift any prompt patterns from `claude-youtube`. Cloning the reference repo to `~/development/_reference/claude-youtube/` is also required by the Research Protocol (R-1) for every pipeline stage.
- **Output:** `ATTRIBUTIONS.md` at repo root with full MIT text; reference repo cloned locally.

### 0.3 — Environment + Zod validation (`lib/env.ts`)

- **Category:** Foundation
- **Dependencies:** 0.1
- **Reasoning:** EXT-1 requires that the app refuse to start if env vars are missing or malformed. This must exist before any code reads `process.env`.
- **Output:** `lib/env.ts` exporting a validated, typed `env` object. `.env.example` listing all required keys.

### 0.4 — Supabase project + database schema

- **Category:** Foundation
- **Dependencies:** 0.3
- **Reasoning:** Auth, channel onboarding, idea workspace, and pipeline orchestration all read/write Supabase. Schema must be designed before features depending on it can be built. Row-level security (SEC-2) must be enabled on every user-scoped table from the start — adding it later is much harder.
- **Tables (initial):**
  - `users` (managed by Supabase Auth)
  - `channels` — `id`, `user_id`, `youtube_channel_id`, `handle`, `niche`, `subscriber_count`, `median_views`, `top_videos_json`, `competitor_set_json`, timestamps
  - `pipeline_runs` — `id`, `user_id`, `channel_id`, `idea_text`, `status`, plus one JSONB column per stage output (`competitor_data`, `score_data`, `titles_data`, `hook_data`, `script_data`, `lint_data`, `thumbnails_data`, `seo_data`, `ab_plan_data`, `engagement_drafts_data`)
  - `youtube_quota_usage` — `id`, `date`, `units_used` (for EXT-2)
  - `youtube_api_cache` — `cache_key`, `payload`, `expires_at`
- **Output:** Migrations checked in, RLS policies on all user-scoped tables, typed Supabase client in `lib/db/`.

### 0.5 — Anthropic SDK wrapper (`lib/anthropic/`)

- **Category:** Foundation
- **Dependencies:** 0.3
- **Reasoning:** CRIT-2 (model routing) and CRIT-3 (prompt caching) both apply to every LLM call in the app. A single wrapper enforces both rules; if every stage calls the SDK directly, those rules will be violated within a week.
- **Output:**
  - `lib/anthropic/client.ts` — singleton SDK client
  - `lib/anthropic/models.ts` — typed model IDs and stage-to-model mapping
  - `lib/anthropic/cache.ts` — helper that wraps system prompts with `cache_control` when ≥1024 tokens
  - `lib/anthropic/retry.ts` — exponential backoff per EXT-3

### 0.6 — YouTube Data API cached wrapper (`lib/youtube/`)

- **Category:** Foundation
- **Dependencies:** 0.4 (needs the cache and quota tables)
- **Reasoning:** CRIT-1 (quota cache) is the single most important runtime rule. Channel onboarding (1.2) and stage 3 (2.4) both depend on this wrapper existing. Without it, the first 10 users break the product for the day.
- **Output:**
  - `lib/youtube/client.ts` — googleapis client
  - `lib/youtube/cached.ts` — cache-first wrappers for `channels.list`, `search.list`, `videos.list`
  - `lib/youtube/quota.ts` — quota tracking, 80% soft-cap enforcement
  - `lib/youtube/validate.ts` — channel URL allowlist (SEC-1)

### 0.7 — SSE streaming pattern (`lib/streaming/`)

- **Category:** Foundation
- **Dependencies:** 0.5
- **Reasoning:** TS-2 requires SSE for all long-running pipeline stages. Codifying the pattern once ensures every stage looks identical, which dramatically simplifies the client-side progress UI in Tier 1.
- **Output:**
  - `lib/streaming/sse.ts` — server-side helpers for emitting `progress` and `complete` events
  - `lib/hooks/useStageStream.ts` — client hook for consuming an SSE pipeline endpoint

### 0.8 — Pipeline orchestrator skeleton (`lib/services/pipeline.ts`)

- **Category:** Foundation
- **Dependencies:** 0.4, 0.5, 0.7
- **Reasoning:** A-2 requires that stages be independently re-runnable, reading inputs from and writing outputs to the `pipeline_runs` row. The orchestrator establishes this contract before any stage is built. Building stages first and then trying to retrofit re-runnability is much harder than the reverse.
- **Output:** `lib/services/pipeline.ts` with `runStage(runId, stage)` and `runFullPipeline(runId)` functions; a stage registry that knows each stage's dependencies on prior stage outputs.

**Tier 0 parallelism:** 0.5 and 0.6 can be built in parallel after 0.4. 0.7 can start in parallel with 0.6 once 0.5 is done.

---

## Tier 1 — User Foundation

These are the user-facing features 1-3 in the Master Overview's "Foundation Features" section.

### 1.1 — Email-magic-link auth (Master Overview feature #2)

- **Category:** Foundation
- **Dependencies:** 0.4 (Supabase Auth tables exist by default)
- **Reasoning:** No user-scoped feature can exist without a user. Auth must work end-to-end (sign in, sign out, session persistence) before any feature that reads `auth.uid()`.
- **Output:** `/sign-in` page, magic-link callback route, middleware enforcing auth on `(app)` route group.

### 1.2 — Channel onboarding (Master Overview feature #1)

- **Category:** Foundation
- **Dependencies:** 1.1, 0.6 (YouTube wrapper), 0.5 (Anthropic wrapper for niche extraction)
- **Reasoning:** Idea workspace and the entire pipeline depend on having a stored channel context with niche, median views, and competitor set. This is the second-highest-risk integration after the pipeline orchestrator: a buggy channel fetch poisons every downstream stage.
- **Stages of the onboarding flow:**
  1. User pastes channel URL → SEC-1 validation
  2. YouTube API: fetch channel metadata + last 50 videos
  3. Compute median views (used by stage 3 as the outlier threshold)
  4. Anthropic: niche extraction from channel description + recent video titles
  5. Anthropic: competitor identification from search results in the niche
  6. Persist to `channels` table
- **Output:** `/onboard` flow, populated `channels` row.

### 1.3 — Idea workspace + history (Master Overview feature #3)

- **Category:** Foundation
- **Dependencies:** 1.2, 0.8 (orchestrator)
- **Reasoning:** The user needs a UI to drop ideas, see streaming progress, view results, and re-run stages. This is the shell that every Tier 2 stage plugs into. It can be built before any stage exists by displaying placeholder progress events.
- **Output:** `/runs` (list), `/runs/new` (drop idea), `/runs/[runId]` (live + history view with per-stage re-run buttons).

**Tier 1 parallelism:** 1.1 and 1.3's UI shell can be built in parallel after 0.8. 1.2 must wait for 1.1.

---

## Tier 2 — Core Value (12-stage pipeline)

The 12 stages that produce the actual viral kit. Build order matches runtime dependency order, with parallelism where stages don't depend on each other's outputs.

### 2.1 — End-to-end vertical slice with stage 3 (Competitor outliers)

- **Category:** Core Value
- **Dependencies:** Tier 0, Tier 1
- **Reasoning:** Before building all 10 remaining stages, prove the full vertical works: user drops an idea → orchestrator queues stage 3 → SSE streams progress → result persists → UI displays it → re-run button works. This is the highest-risk integration in the whole project. **If anything is going to fail in the architecture, it fails here.** Better to discover that with one stage built than ten.
- **What this stage does:** Live YouTube Data API search in the user's niche, filter videos with views ≥ 5× publishing channel's median over the last 30 days, extract delta vs. each channel's normal output via Anthropic.
- **Source subskill:** `claude-youtube/sub-skills/competitor.md`
- **Model:** Opus 4.7 (delta extraction is reasoning-heavy) — *update CLAUDE.md CRIT-2 if this changes after testing*
- **Output:** `app/api/pipeline/competitor/route.ts`, `lib/services/competitor.ts`, `lib/prompts/competitor.ts`, plus the working end-to-end flow.

### 2.2 — Stage 4: Virality score + 92% gate (Master Overview feature #5)

- **Category:** Core Value
- **Dependencies:** 2.1 (uses competitor outliers as scoring grounding)
- **Reasoning:** The gate must work before any downstream stage runs, because below 92 the pipeline is supposed to halt. Build the gate logic in the orchestrator at the same time.
- **Source subskill:** `claude-youtube/sub-skills/ideate.md`
- **Model:** Opus 4.7

### 2.3 — Stage 5: Title generation (Master Overview feature #6)

- **Category:** Core Value
- **Dependencies:** 2.2 (gate must pass), 2.1 (titles benefit from outlier patterns)
- **Reasoning:** Titles are the linchpin for stages 6, 7, 9, 10, 11, 12. Once titles exist, much of the rest of the pipeline can be built in parallel.
- **Source subskill:** `claude-youtube/sub-skills/seo.md` (title section)
- **Model:** Haiku 4.5

### 2.4 — Stage 6: Cold-open hook (Master Overview feature #7)

- **Category:** Core Value
- **Dependencies:** 2.3
- **Reasoning:** Hook depends on title angle. Builds on the same prompting pattern as 2.3 — quick win.
- **Source subskill:** `claude-youtube/sub-skills/hook.md`
- **Model:** Haiku 4.5

### 2.5 — Stage 7: Retention script (Master Overview feature #8)

- **Category:** Core Value
- **Dependencies:** 2.4 (script's intro is the chosen hook), 2.3 (script angle follows title)
- **Reasoning:** Longest, most expensive, most complex stage. Doing this fifth gives us pattern reuse from 2.1–2.4.
- **Source subskill:** `claude-youtube/sub-skills/script.md`
- **Model:** Opus 4.7

### 2.6 — Stage 8: Anti-pattern lint + drift check (Master Overview feature #9)

- **Category:** Core Value
- **Dependencies:** 2.5 (lints the script), 2.3 (compares against titles)
- **Reasoning:** Validates the most expensive output (the script). Should run automatically after 2.5 every time.
- **Source subskill:** Synthesized from `script.md` + `seo.md` (no dedicated subskill exists — flag this as a gap)
- **Model:** Haiku 4.5

### 2.7 — Stage 9: Thumbnail concept briefs (Master Overview feature #10)

- **Category:** Core Value
- **Dependencies:** 2.3 (one brief per title angle)
- **Reasoning:** Can be built in parallel with 2.4–2.6 because it only depends on titles. **Eligible for parallel development.**
- **Source subskill:** `claude-youtube/sub-skills/thumbnail.md`
- **Model:** Haiku 4.5

### 2.8 — Stage 10: SEO metadata pack (Master Overview feature #11)

- **Category:** Core Value
- **Dependencies:** 2.5 (chapters need script), 2.3 (description references titles)
- **Reasoning:** Templated output, depends on script and titles only. Can be built in parallel with 2.6 and 2.7. **Eligible for parallel development.**
- **Source subskill:** `claude-youtube/sub-skills/metadata.md`
- **Model:** Haiku 4.5

### 2.9 — Stage 11: A/B test plan with measurement (Master Overview feature #12)

- **Category:** Core Value
- **Dependencies:** 2.3 (titles to test), 2.7 (thumbnails to test)
- **Reasoning:** Synthesizes existing outputs into a test plan. No external API needed.
- **Source subskill:** No direct equivalent — synthesize from `seo.md` and `thumbnail.md`. Flag as gap.
- **Model:** Haiku 4.5

### 2.10 — Stage 12: Pinned comment + community post drafts (Master Overview feature #13)

- **Category:** Core Value
- **Dependencies:** 2.5, 2.3
- **Reasoning:** Lowest priority within the pipeline — can ship Phase 1 without this if timeline pressure appears. Pure copy generation, fast to build.
- **Source subskill:** No direct equivalent — synthesize from `repurpose.md`.
- **Model:** Haiku 4.5

### 2.11 — Full-pipeline orchestration polish

- **Category:** Core Value
- **Dependencies:** 2.1–2.10
- **Reasoning:** Once all stages exist, tighten the one-shot user experience: progress UI shows which stage is running, partial results render as they complete, errors in one stage don't kill the run.
- **Output:** Updated `/runs/[runId]` view with full live pipeline rendering.

**Tier 2 parallelism:**
- 2.7, 2.8, 2.9 can all be built in parallel once 2.3 (titles) ships
- 2.6 can be built in parallel with 2.7/2.8 once 2.5 ships
- Within a parallel group, the same prompt-porting workflow repeats: read subskill → adapt → write prompt file → write service → write route → wire to orchestrator

---

## Tier 3 — Enhancement (Phase 2)

These are Master Overview features 14-22. They polish the product and make it defensible but are explicitly deferred until Phase 1 ships and validates demand.

### 3.1 — Hybrid scoring engine (Master Overview feature #14)

- **Category:** Enhancement
- **Dependencies:** Tier 2 complete; new `outlier_corpus` table; nightly cron infrastructure
- **Reasoning:** This is the **defensibility unlock**. Without it, we're a thin Claude wrapper. With it, scores are grounded in empirical base rates from real YouTube outliers. Build first in Tier 3.

### 3.2 — Niche vocabulary library (Master Overview feature #18)

- **Category:** Enhancement
- **Dependencies:** 3.1 (uses the same outlier corpus)
- **Reasoning:** Cheap to add once 3.1 exists, improves stage 5 (titles) significantly.

### 3.3 — AVD predictor (Master Overview feature #15)

- **Category:** Enhancement
- **Dependencies:** Stage 7 (script) outputs; modeling work
- **Reasoning:** Genuine new value but requires more sophisticated modeling than Phase 1 stages. Independent of 3.1/3.2.

### 3.4 — Calibration loop (Master Overview feature #17)

- **Category:** Enhancement
- **Dependencies:** 3.1; published-video tracking infrastructure
- **Reasoning:** Closes the loop on scoring accuracy. Requires user behavior data (which ideas they actually published) so it can't be built before there are users.

### 3.5 — Compound-effect forecast (Master Overview feature #16)

- **Category:** Enhancement
- **Dependencies:** 3.1, 3.3
- **Reasoning:** Synthesizes prior signals into a single forecast. Lowest priority within Tier 3.

### 3.6 — Standalone subskill features (Master Overview features #19–22)

These are direct ports of `claude-youtube` subskills not yet in the pipeline:

- **Channel audit** (#19) — `audit.md` subskill
- **Content calendar generator** (#20) — `calendar.md` subskill
- **Shorts production package** (#21) — `shorts.md` subskill
- **Cross-platform repurposing** (#22) — `repurpose.md` subskill

- **Category:** Enhancement
- **Dependencies:** Tier 2 patterns; channel onboarding
- **Reasoning:** These are independent tools layered onto the same channel context. **All four can be built in parallel** by separate sessions because they share no code.

### 3.7 — Stripe + paid tier

- **Category:** Enhancement
- **Dependencies:** Tier 2 complete; Tier 3.1+ optional
- **Reasoning:** Don't build payments until you've validated which features users will actually pay for. Run Phase 1 free with email capture first; introduce Stripe once retention/conversion signals are clear.

---

## Tier 4 — Phase 3 (AI thumbnails + LoRA)

### 4.1 — AI thumbnail generation (Master Overview feature #23)

- **Category:** Enhancement
- **Dependencies:** Stage 9 (thumbnail briefs) shipped; image-gen API integration (Gemini Imagen or FLUX); programmatic text overlay (Sharp/Canvas)
- **Reasoning:** Replaces text-only briefs with finished images. Substantial new infrastructure (image storage in Supabase Storage, image generation API budgets, text overlay rendering). Low risk to defer because Phase 1 thumbnail briefs already deliver value.

### 4.2 — Custom LoRA / character training (Master Overview feature #24)

- **Category:** Enhancement (defensibility)
- **Dependencies:** 4.1 working
- **Reasoning:** **This is the moat.** Photo upload, training pipeline (Replicate or self-hosted), per-user model storage, integration with 4.1's generation flow. Substantial work, but no other tool in the creator-AI space offers per-creator consistent face on thumbnails. Build last because it requires 4.1 as the host.

---

## Recommended Build Cadence

- **Week 1:** Tier 0 (technical foundation) + Tier 1 (auth, onboarding, workspace shell)
- **Week 2:** 2.1 (end-to-end vertical with stage 3) — proves the architecture
- **Week 3:** 2.2 (gate) + 2.3 (titles) — unblocks the parallel fan-out
- **Week 4:** 2.4–2.10 in parallel waves; 2.11 polish at the end
- **Phase 1 ship target:** End of Week 4
- **Tier 3 and Tier 4** begin only after Phase 1 has real users and feedback
