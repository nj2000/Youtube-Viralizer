# YouTube Viralizer — Implementation Plan

**Created:** 2026-05-10
**Status:** In Progress

---

## Overview

End-to-end plan for shipping YouTube Viralizer: a Next.js 15 web app that turns one video idea into a 12-stage viral production kit (competitor analysis → virality score with 92% gate → retention-engineered script → thumbnails → SEO → A/B plan). Built on Supabase + Anthropic + YouTube Data API, with Phase 2 enhancements (hybrid scoring, calibration loop, niche vocabulary, channel audit, content calendar) and Phase 3 AI thumbnail generation + custom LoRA character training as the defensibility moat.

**Source documents:** `CLAUDE.md` (rules), `Documentation/Overviews and Summaries/Master-Overview.md` (vision), `Documentation/Overviews and Summaries/Build-Order.md` (tier sequencing), per-feature specs in `Documentation/Overviews and Summaries/<feature>/spec.md`, per-feature PRDs in `Documentation/PRDs/`, per-feature mockups in `Documentation/Mockups/`.

---

## Phase 1: Foundation

**Status:** In Progress
**Subphases:** 1.1 – 1.6
**Goal:** Stand up the entire technical foundation (scaffold, schemas, wrappers) plus the three user-facing foundation features (auth, channel onboarding, idea workspace shell) — everything Tier 2 pipeline stages need before they can plug in.

- [x] **1.1 — Project scaffold + env** — Next.js 15 App Router, TypeScript strict, Tailwind, ESLint/Prettier, `lib/env.ts` Zod validation, ATTRIBUTIONS.md + reference skill clone. _See `Phase-1.1-Summary.md`._
- [x] **1.2 — Supabase + schemas** — Dev project provisioned and linked, 8 migrations applied (profiles, channels, pipeline_runs, youtube_quota_usage, youtube_api_cache, onboard_drafts, login_attempts + `private` schema for security-definer triggers), RLS on every user-scoped table (4/3/2 policies for channels/runs/profiles; zero policies on service-role-only tables), typed `lib/supabase/{server,middleware,service}.ts` + `lib/db/*` CRUD wrappers + generated `lib/db/types.ts`. Auth config patched: OTP 900s, 30-day inactivity timeout, callback redirect allowlist. Resend SMTP + branded template deferred to Phase 1.4; staging/prod projects deferred. _See `Phase 1.2 — Supabase + schemas/summary.md`._
- [x] **1.3 — Anthropic + YouTube wrappers** — `lib/anthropic/` with stage→model registry (Opus for competitor/score/script; Haiku otherwise), `buildSystem` at the 1024-token CRIT-3 threshold, and `withRetry` keyed on the SDK's typed exceptions per EXT-3. `lib/youtube/` with URL-parsing SEC-1 allowlist and the cache-first wrapper enforcing CRIT-1 + EXT-2. `lib/streaming/sse.ts` + `lib/hooks/useStageStream.ts` for the SSE pattern. `lib/services/pipeline.ts` orchestrator skeleton with stage registry, dependency graph, and the 92-point score gate. ESLint `no-restricted-imports` fences `@anthropic-ai/sdk` and `googleapis` to their wrapper directories; Vitest installed with 36 passing specs. Streaming Anthropic responses and DOM-driven hook tests deferred to the first phase that wires a real SSE route. _See `Phase 1.3 — Anthropic + YouTube wrappers/summary.md`._
- [x] **1.4 — Magic-link auth** — Root `middleware.ts` enforces session on the `(app)` route group; `app/api/auth/sign-in` (CSRF Origin check + Zod email + 5/hr sliding rate-limit + always-204) and `app/api/auth/callback` (PKCE `exchangeCodeForSession` or `verifyOtp`, error→reason mapping, safe-`next` redirect) wired against `lib/supabase/{server,middleware,service}.ts`. `lib/services/auth.ts` owns `resolvePostAuthDestination` and `checkSendRateLimit`; `lib/validation/auth.ts` holds the Zod schemas (incl. the `/^\/[a-zA-Z0-9/_-]*$/` open-redirect guard). UI: `app/(public)/sign-in/{page,SignInForm}` + `/sent/{page,ResendButton}` (30s client cooldown) + `/error/page` (expired/used/invalid branches); `app/(app)/layout.tsx` + `_components/UserMenu.tsx` (Phase 1 trim: signed-in row + Sign out) + `_components/signOutAction.ts` Server Action. Branded `supabase/templates/magic-link.{html,txt}` ship "15 minutes" copy (spec Appendix B overrides the PRD/mockup's 60 min). CLAUDE.md updated with all 7 Appendix B items (stack lock-in `@supabase/ssr`, `SITE_URL` in EXT-1, `lib/supabase/` exception to A-1, expanded API-2 error code union, `login_attempts` service-role-only note under SEC-2, SSR cookie pitfall in Common Mistakes, redirect-allowlist line in the pre-commit checklist). _See `Phase 1.4 — Magic-link auth/summary.md`._
- [x] **1.5 — Channel onboarding** — `POST /api/onboard` SSE flow streams six progress events (`validating → fetching_channel → fetching_videos → computing_median → extracting_niche → identifying_competitors → complete`) via `runOnboard` orchestrator in `lib/services/onboard.ts`. Sonnet 4.6 enters via `lib/anthropic/onboarding.ts#callSonnet` (bypasses pipeline `Stage` enum). YouTube quota gate (`assertHeadroom(600)`) fires before the SSE opens; first end-to-end consumer of `lib/streaming/sse.ts` + `lib/hooks/useStageStream.ts`. Confirm endpoint enforces 3-channel limit, idempotent re-confirm, niche-source preservation, and manual-competitor merging via `lib/services/onboard-merge.ts`. Redetect endpoint throttled 1/hr/channel; (niche, country) cache for 6h. Multi-channel UX: `ChannelContextProvider` + `ChannelSwitcher` in the `(app)` header, soft-delete with cascade to `pipeline_runs`, cross-user delete returns 404. Tightened `lib/validation/channels.ts` (videoId regex, max-50 cap, UC regex); 22 new Vitest specs (58 total). CLAUDE.md CRIT-2 +Sonnet onboarding row; stack lock-in +Sonnet 4.6; API-2 error union +7 codes. _See `Phase 1.5 — Channel onboarding/summary.md`._
- [ ] **1.6 — Idea workspace shell** — `pipeline_runs` orchestrator integration, `/runs` list, `/runs/new`, `/runs/[runId]` live view with per-stage cards and re-run buttons.

---

## Phase 2: 12-Stage Pipeline

**Status:** Not Started
**Subphases:** 2.1 – 2.10
**Goal:** Build the 12 production-kit pipeline stages. Stage 3 ships first as the vertical-slice proof; stages 5–12 fan out in parallel waves once titles (Stage 5) ships.

- **2.1 — Competitor outliers (Stage 3)** — Live YouTube search per competitor (5× their channel median over 30d), Opus delta extraction, extracted patterns.
- **2.2 — Score + gate (Stage 4)** — Opus scoring on 5 dimensions, 92% gate, reframe generation, override flow.
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
