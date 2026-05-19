# YouTube Viralizer — Implementation Plan

**Created:** 2026-05-10
**Status:** In Progress

---

## Overview

End-to-end plan for shipping YouTube Viralizer: a Next.js 15 web app that turns one video idea into a 12-stage viral production kit (competitor analysis → virality score with 92% gate → retention-engineered script → thumbnails → SEO → A/B plan). Built on Supabase + Anthropic + YouTube Data API, with Phase 2 enhancements (hybrid scoring, calibration loop, niche vocabulary, channel audit, content calendar) and Phase 3 AI thumbnail generation + custom LoRA character training as the defensibility moat.

**Source documents:** `CLAUDE.md` (rules), `Documentation/Overviews and Summaries/Master-Overview.md` (vision), `Documentation/Overviews and Summaries/Build-Order.md` (tier sequencing), per-feature specs in `Documentation/Overviews and Summaries/<feature>/spec.md`, per-feature PRDs in `Documentation/PRDs/`, per-feature mockups in `Documentation/Mockups/`.

---

## Phase 1: Foundation

**Status:** Complete
**Subphases:** 1.1 – 1.6
**Goal:** Stand up the entire technical foundation (scaffold, schemas, wrappers) plus the three user-facing foundation features (auth, channel onboarding, idea workspace shell) — everything Tier 2 pipeline stages need before they can plug in.

- [x] **1.1 — Project scaffold + env** — Next.js 15 App Router, TypeScript strict, Tailwind, ESLint/Prettier, `lib/env.ts` Zod validation, ATTRIBUTIONS.md + reference skill clone. _See `Phase-1.1-Summary.md`._
- [x] **1.2 — Supabase + schemas** — Dev project provisioned and linked, 8 migrations applied (profiles, channels, pipeline_runs, youtube_quota_usage, youtube_api_cache, onboard_drafts, login_attempts + `private` schema for security-definer triggers), RLS on every user-scoped table (4/3/2 policies for channels/runs/profiles; zero policies on service-role-only tables), typed `lib/supabase/{server,middleware,service}.ts` + `lib/db/*` CRUD wrappers + generated `lib/db/types.ts`. Auth config patched: OTP 900s, 30-day inactivity timeout, callback redirect allowlist. Resend SMTP + branded template deferred to Phase 1.4; staging/prod projects deferred. _See `Phase 1.2 — Supabase + schemas/summary.md`._
- [x] **1.3 — Anthropic + YouTube wrappers** — `lib/anthropic/` with stage→model registry (Opus for competitor/score/script; Haiku otherwise), `buildSystem` at the 1024-token CRIT-3 threshold, and `withRetry` keyed on the SDK's typed exceptions per EXT-3. `lib/youtube/` with URL-parsing SEC-1 allowlist and the cache-first wrapper enforcing CRIT-1 + EXT-2. `lib/streaming/sse.ts` + `lib/hooks/useStageStream.ts` for the SSE pattern. `lib/services/pipeline.ts` orchestrator skeleton with stage registry, dependency graph, and the 92-point score gate. ESLint `no-restricted-imports` fences `@anthropic-ai/sdk` and `googleapis` to their wrapper directories; Vitest installed with 36 passing specs. Streaming Anthropic responses and DOM-driven hook tests deferred to the first phase that wires a real SSE route. _See `Phase 1.3 — Anthropic + YouTube wrappers/summary.md`._
- [x] **1.4 — Magic-link auth** — Root `middleware.ts` enforces session on the `(app)` route group; `app/api/auth/sign-in` (CSRF Origin check + Zod email + 5/hr sliding rate-limit + always-204) and `app/api/auth/callback` (PKCE `exchangeCodeForSession` or `verifyOtp`, error→reason mapping, safe-`next` redirect) wired against `lib/supabase/{server,middleware,service}.ts`. `lib/services/auth.ts` owns `resolvePostAuthDestination` and `checkSendRateLimit`; `lib/validation/auth.ts` holds the Zod schemas (incl. the `/^\/[a-zA-Z0-9/_-]*$/` open-redirect guard). UI: `app/(public)/sign-in/{page,SignInForm}` + `/sent/{page,ResendButton}` (30s client cooldown) + `/error/page` (expired/used/invalid branches); `app/(app)/layout.tsx` + `_components/UserMenu.tsx` (Phase 1 trim: signed-in row + Sign out) + `_components/signOutAction.ts` Server Action. Branded `supabase/templates/magic-link.{html,txt}` ship "15 minutes" copy (spec Appendix B overrides the PRD/mockup's 60 min). CLAUDE.md updated with all 7 Appendix B items (stack lock-in `@supabase/ssr`, `SITE_URL` in EXT-1, `lib/supabase/` exception to A-1, expanded API-2 error code union, `login_attempts` service-role-only note under SEC-2, SSR cookie pitfall in Common Mistakes, redirect-allowlist line in the pre-commit checklist). _See `Phase 1.4 — Magic-link auth/summary.md`._
- [x] **1.5 — Channel onboarding** — `POST /api/onboard` SSE flow streams six progress events (`validating → fetching_channel → fetching_videos → computing_median → extracting_niche → identifying_competitors → complete`) via `runOnboard` orchestrator in `lib/services/onboard.ts`. Sonnet 4.6 enters via `lib/anthropic/onboarding.ts#callSonnet` (bypasses pipeline `Stage` enum). YouTube quota gate (`assertHeadroom(600)`) fires before the SSE opens; first end-to-end consumer of `lib/streaming/sse.ts` + `lib/hooks/useStageStream.ts`. Confirm endpoint enforces 3-channel limit, idempotent re-confirm, niche-source preservation, and manual-competitor merging via `lib/services/onboard-merge.ts`. Redetect endpoint throttled 1/hr/channel; (niche, country) cache for 6h. Multi-channel UX: `ChannelContextProvider` + `ChannelSwitcher` in the `(app)` header, soft-delete with cascade to `pipeline_runs`, cross-user delete returns 404. Tightened `lib/validation/channels.ts` (videoId regex, max-50 cap, UC regex); 22 new Vitest specs (58 total). CLAUDE.md CRIT-2 +Sonnet onboarding row; stack lock-in +Sonnet 4.6; API-2 error union +7 codes. _See `Phase 1.5 — Channel onboarding/summary.md`._
- [x] **1.6 — Idea workspace shell** — Orchestrator refactor splits `lib/services/pipeline.ts` into `pipeline-stages.ts` (registry + `DOWNSTREAM` cascade map + 10 auto-registered stub handlers), `pipeline-state.ts` (four state-mutation helpers: `markStageStarted`/`Complete`/`Failed`/`GateFailed` — the *only* surfaces allowed to write `pipeline_runs`), and `pipeline-bus.ts` (Supabase Realtime broadcast via the HTTP endpoint). `lib/services/pipeline.ts` keeps `runStage` / `runFullPipeline`, adds `runFromStage`, and delegates state to `pipeline-state.ts`. New `lib/services/runs.ts` owns the workspace orchestration: `createRun` (NO_ACTIVE_CHANNEL + QUOTA_EXCEEDED + RATE_LIMITED 30/hr + fire-and-forget orchestrator), `listRunsForActiveChannel` (trigram search + counts), `softDeleteRunForUser` (atomic cancel+delete for in-flight runs), `cancelRunForUser`, `rerunFromStageForUser`. Five API routes: `GET/POST /api/runs`, `GET/DELETE /api/runs/[runId]`, `POST /api/runs/[runId]/cancel`, `POST /api/runs/[runId]/rerun-from`, `GET /api/runs/[runId]/stream` (SSE: snapshot first, bus forwarding, 15s keepalive). UI: `/runs` list with search/status filters/pagination + DeleteRunModal, `/runs/new` with active-channel summary + idea form, `/runs/[runId]` live view with `useRun` hook (12 stage cards + 5-variant `StageCard` + GateExplanation + StaleBanner). 20 new Vitest specs (78 total): `IdeaTextSchema` trim + bounds, `DOWNSTREAM` cascade map (5/6/7 verification rows), `markStageComplete` patch shape, `markStageFailed` `^stage_<n>:` sanitization, `markGateFailed` literal "Score 71 / 100 — below 92 threshold" string. CLAUDE.md API-2 error union +`NO_ACTIVE_CHANNEL`/`RUN_NOT_FOUND`/`RUN_ALREADY_RUNNING`/`RUN_CANCELLED`/`RUN_DELETED`/`CHANNEL_DELETED`/`BUS_UNAVAILABLE`. _See `Phase 1.6 — Idea workspace shell/summary.md`._

---

## Phase 2: 12-Stage Pipeline

**Status:** In Progress
**Subphases:** 2.1 – 2.10
**Goal:** Build the 12 production-kit pipeline stages. Stage 3 ships first as the vertical-slice proof; stages 5–12 fan out in parallel waves once titles (Stage 5) ships.

- [x] **2.1 — Competitor outliers (Stage 3)** — Vertical-slice proof of the Phase 2 architecture. `lib/validation/competitor.ts` defines `CompetitorDataSchema` with the closed 8-value `TriggerLabel` enum + `schemaVersion: 1`. `lib/prompts/competitor.ts` (~1850 tokens) carries the CRIT-4 attribution header and wraps untrusted competitor strings in XML tags per spec §9. `lib/services/{competitor,competitor-delta,competitor-fetch}.ts` orchestrate per-competitor YouTube search → median → hydrate → 5× filter (with <72h recency projection + shorts/livestream tagging) → diversity-cap-5 → top 15 → single batched Opus call (with one retry on malformed JSON) → server-side merge by videoId. Soft-cap `assertHeadroom(101)` fires before every per-competitor `search.list` so worst-case is bounded at 808 units. `app/api/pipeline/competitor/route.ts` returns 202 fire-and-forget, with 409 `STREAM_IN_PROGRESS` on concurrent and typed `run_error` bus codes (`NO_COMPETITORS`/`QUOTA_EXCEEDED`/`UPSTREAM_ERROR`). UI: `app/(app)/runs/[runId]/Stage3Card.tsx` + `stage3/*.tsx` renders all six mockup states (loading sub-steps, main grid with pattern callouts, empty noOutliers, error with prior-data fallback, regenerate dialog with `~$0.10 Opus` cost copy overriding the mockup's Haiku price, diagnostics banners for weak-signal / single-creator-dominance / 90-day-fallback / skipped competitors). Extended `lib/youtube/cached.ts` with `searchCompetitorOutliers` (100u, 1h TTL), `getVideoDetails` alias, and `computeChannelMedian` (24h TTL, 90-day fallback, shorts excluded). `pnpm typecheck` + `pnpm lint` clean. _See `Phase 2.1 — Competitor outliers (Stage 3)/summary.md`._
- [x] **2.2 — Score + gate (Stage 4)** — Real Opus 4.7 scoring on the 5 dimensions (hook/curiosity/outlier/niche/title-ability, weights 0.25/0.25/0.20/0.20/0.10). `lib/validation/score.ts` defines `ScoreDataSchema` with `schemaVersion: 1` + the closed `DIMENSION_WEIGHTS` constant + `computeFinalScore` so model arithmetic is never trusted. `lib/prompts/score.ts` (~1900 tokens, CRIT-3 cacheable) carries MIT attribution + 5-dimension rubric + XML-wrapped untrusted inputs. `lib/services/score.ts` makes a single Opus call, TS-recomputes finalScore, emits theatrical per-dimension SSE stagger (~250ms) via pipeline-bus, two-pass reframe shortfall (`reframeShortfall: true` when still <3). New `lib/services/stage-handlers.ts` barrel auto-registers every real handler — also patches a Phase 2.1 latent gap where `rerun-from?stage=3` could fall through to stubs. `markGateFailed` signature extended to persist `score_data` (without that, the model's reframes would never reach the UI). Three new routes: `POST /api/pipeline/score` (202 fire-and-forget, 409 STREAM_IN_PROGRESS, 409 MISSING_PREREQUISITES); `POST + DELETE /api/runs/[runId]/override-gate` (flips status to `scored_overridden`, kicks off `runFromStage('titles')`; DELETE reverses); `POST /api/runs/[runId]/apply-reframe` (single-statement transactional wipe of all 10 stage columns + idea_text update + audit row + restart from competitor). New migration `0009_score_gate_overrides.sql` adds `scored_overridden` enum value, `gate_overridden_at` + `gate_override_reason` columns, and the `reframe_applications` append-only RLS table feeding Phase 3 calibration. UI: new `Stage4Card.tsx` + `stage4/{shared,ScoringCard,PassedCard,FailedCard,ConfirmModals,GateOverriddenRibbon}.tsx` renders all six mockup states (scoring sub-steps, passed gate, passed via override, gate-failed with reframes, both confirm modals, persistent override ribbon that auto-hides on natural re-score pass). `GateExplanation.tsx` deleted — subsumed. `pnpm typecheck` + `pnpm lint` clean. _See `Phase 2.2 — Score + gate (Stage 4)/summary.md`._
- **2.3 — Titles (Stage 5)** — Haiku 3-trigger generation (curiosity/fear/result), voice samples, diversity check, per-card lock-in.
- **2.4 — Hook (Stage 6)** — Haiku 3-variant cold-open hooks ≤30s with timestamped beats, retention prediction, lock-in.
- **2.5 — Retention script (Stage 7)** — Opus long-form script with section structure, [SKELETON]/[PERSONALITY] markers, retention curve, open loops, true delta streaming.
- **2.6 — Anti-pattern lint (Stage 8)** — Haiku two-pass scan (20 closed rules + drift check), issue accept/dismiss/apply-all, non-blocking.
- **2.7 — Thumbnail briefs (Stage 9)** — Haiku 3 text briefs (one per trigger), composition + palette + overlay text, locked colour tokens.
- **2.8 — SEO pack (Stage 10)** — Haiku description + tags + hashtags + deterministic chapters, end-screen heuristic, pinned-comment template.
- **2.9 — A/B plan (Stage 11)** — Haiku synthesised test plan, signal-under-test mapping, schedule timeline, decision rules.
- **2.10 — Pinned/community (Stage 12)** — Haiku pinned comment + community pre/post drafts, suggested replies, run completion + markdown bundle export.

---

## Phase 3: Phase 2 Enhancements

**Status:** Not Started
**Subphases:** 3.1 – 3.9
**Goal:** Phase 2 features that polish the product and unlock defensibility. Hybrid scoring (the empirical corpus) is highest priority; the rest can build in parallel against the same infrastructure.

- **3.1 — Hybrid scoring** — pgvector outlier corpus, nightly cron, k-NN matching, empirical-component score, weighted blend with cold-start fallback.
- **3.2 — Niche vocabulary** — Per-channel mined power phrases + forbidden phrases, Stage 5 prompt extension, CSV import/export.
- **3.3 — AVD predictor** — Heuristic predicted AVD + retention curve + risk points from script structure, apply-suggestions flow.
- **3.4 — Compound forecast** — Channel-level 12-month projection (deterministic), confidence bands, milestone detection, input sliders.
- **3.5 — Calibration loop** — Mark-published flow, polling cron, predicted-vs-actual deltas, personal-fit multipliers feeding Feature #14, weekly Haiku learnings.
- **3.6 — Channel audit** — Multi-pass Haiku + Opus synthesis on SEO/performance/content/monetization, underperformer diagnosis, recommendations.
- **3.7 — Content calendar** — Opus monthly plan generation, drag-drop reschedule, status sync trigger, holiday + cadence guardrails.
- **3.8 — Shorts package** — Separate single-shot pipeline (not 12 stages), [CUT] markers, loop setup, vertical thumbnail brief, niche-mismatch detection.
- **3.9 — Cross-platform repurposing** — 7 platform outputs (shorts/blog/LinkedIn/X/email/podcast/community), Opus for narrative, Haiku for short copy, opt-in only.

---

## Phase 4: AI Generation

**Status:** Not Started
**Subphases:** 4.1 – 4.2
**Goal:** Phase 3 — replace text thumbnail briefs with finished images, then add per-creator LoRA for consistent face — the defensibility moat.

- **4.1 — AI thumbnails** — Gemini Imagen primary / FLUX Replicate fallback, Sharp text overlay, OCR garbled-text check, NSFW handling, signed-URL storage.
- **4.2 — LoRA character training** — Photo upload + validation (face detect), Replicate FLUX-LoRA training, trigger token assignment, sample renders, privacy controls (30d photo retention), Feature #23 integration.

---

## Verification — full project complete

- [ ] All Tier 0 technical foundation in place (env validation, schemas, RLS, wrappers, orchestrator)
- [ ] User can sign in via magic link, onboard a channel, drop an idea, and receive a complete 12-stage kit in under 3 minutes
- [ ] 92% gate refuses weak ideas and produces usable reframes
- [ ] All 12 stages are independently re-runnable per `CLAUDE.md` A-2
- [ ] Generated competitor outlier data reflects real current YouTube state (cache TTLs enforced)
- [ ] Anti-pattern lint catches all 20 closed-set rules; drift check returns ≤40 on coherent scripts
- [ ] Daily YouTube quota stays under 8000 units in steady-state production
- [ ] Prompt caching verified on every system prompt ≥1024 tokens (`cache_read_input_tokens > 0` on second call)
- [ ] Phase 1 (foundation + 12-stage pipeline) ships before any Phase 2 enhancement starts
- [ ] Phase 2 enhancements (3.1 hybrid scoring → 3.9 repurposing) all read existing pipeline_runs / channels without breaking schemas
- [ ] Phase 3 AI thumbnails generate within 30s and respect 10/month quota per user
- [ ] Phase 3 LoRA training completes within 45 minutes, photos auto-delete after 30 days
- [ ] CLAUDE.md updated with all model-assignment additions (Sonnet 4.6 for onboarding, Replicate for LoRA, etc.)
- [ ] Reference attribution (`ATTRIBUTIONS.md` + footer + per-prompt comments) present and correct per CRIT-4

---

## Reading order for a new contributor

1. Read `CLAUDE.md` (the rules)
2. Read `Documentation/Overviews and Summaries/Master-Overview.md` (the vision)
3. Read `Documentation/Overviews and Summaries/Build-Order.md` (the dependency order)
4. Open the current Phase folder and read its subphase `task.md` files in order
5. For full engineering detail on any subphase, open the corresponding spec at `Documentation/Overviews and Summaries/<feature>/spec.md`
