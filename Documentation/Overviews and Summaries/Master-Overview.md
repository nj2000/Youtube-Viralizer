# YouTube Viralizer — Master Overview

> Working name. Rename once positioning is locked.

## Vision

A web app that collapses the 5-hour weekly research-and-packaging routine YouTube creators do into a single 20-minute one-shot pipeline. The creator drops one video idea; the app returns a complete, algorithm-grounded production kit: live competitor outlier analysis, a virality score with a hard go/no-go gate, three A/B-tested title angles on different psychological triggers, a retention-engineered script, three thumbnail concepts, a copy-paste SEO metadata pack, and a measurement plan for A/B testing.

The product is a direct response to YouTube's 2026 algorithm reality: the platform now ignores subscriber count, tests every upload on cold strangers, and uses NLP to verify the spoken video content matches the title. Creators who don't engineer for this lose. Creators who do — even with 600 subscribers — can hit hundreds of thousands of views.

## Core Value Proposition

**For solo and small-team YouTube creators**, who currently spend 5+ hours per video on research, packaging, and metadata while still guessing at what will work, **YouTube Viralizer is a one-shot production-kit generator** that grounds every output in live YouTube data, peer-reviewed retention science, and the proven prompt patterns of an existing open-source creator-growth skill.

**Unlike** generic "AI video idea" tools that are thin wrappers around an LLM, **our product** combines real YouTube Data API competitor analysis, a 12-stage pipeline with explicit psychological trigger labeling, a hard 92%-virality go/no-go gate that refuses to generate kits for weak ideas, and (in later phases) custom-trained LoRA models for consistent creator-face thumbnails.

## Target Users

- **Solo creators** in the 0–50k subscriber range trying to break into algorithmic suggested traffic
- **Small studios** producing 1–4 videos per week per channel who can't afford a $500-per-video YouTube consulting agency
- **Faceless-channel operators** running multiple niches who need to scale research and packaging without hiring
- **Returning creators** whose old-style intros and keyword-vomit titles stopped working after the 2026 algorithm shift

## Features

### Foundation Features

1. **Channel onboarding** — User pastes their YouTube channel URL once. App pulls niche, top videos, median view count, and identifies the competitor set. Stored to the user's account for all future kit generations.
2. **Email-magic-link auth** — Resend-powered passwordless signup mirroring the lead-magnet funnel pattern proven in the source video.
3. **Idea workspace + history** — Every generated kit is persisted, browsable, and re-runnable per stage.

### Core Value Features (the 12-stage one-shot pipeline)

4. **Competitor outlier analysis** — Live YouTube Data API scan for videos in the user's niche from the last 30 days where views exceed 5× the publishing channel's median. Returns titles, view counts, channel sizes, engagement rates, and a *delta extraction* that explains what makes each outlier different from its channel's normal output.
5. **Virality score with 92% gate** — Each idea is scored on a 0–100 virality scale. Below 92, the kit generation is refused and the user receives concrete reframes that would push the idea above threshold. Above 92, the full pipeline runs.
6. **Title generation** — Three title variants, each explicitly labeled with its psychological trigger (curiosity gap, fear, specific result), plus an intent-specific-language rewrite to maximize audience-cluster matching.
7. **Cold-open hook generator** — Three first-30-seconds variants (since 33% of viewers leave there if the intro is weak) with drop-off-risk ratings per variant.
8. **Retention-engineered script** — Full script with rehook beats every 60–90 seconds, open loops (Marvel-post-credit psychology), and explicit *skeleton vs. personality* markers so the creator knows which sections to keep verbatim and which to inject their own voice into.
9. **Anti-pattern lint + drift check** — Scans the generated script for the specific 2026 anti-patterns: "hey guys welcome back" filler, keyword vomit, hostage-negotiation engagement asks, and any drift between what the title promises and what the first two minutes of the script actually deliver.
10. **Thumbnail concept briefs** — Three thumbnail concepts each matched 1:1 to one of the title angles, with composition, hex color codes, facial expression, and overlay-text copy. (Phase 1 is text-only briefs; Phase 3 generates actual images.)
11. **SEO metadata pack** — Copy-paste-ready description, tags, chapter timestamps, and end-screen recommendations.
12. **A/B test plan with measurement** — Tells the user not just what to test (titles + thumbnails) but explicitly *which signal* each variant tests so they extract real learning from the experiment instead of just declaring a winner.
13. **Pinned comment + community post drafts** — Engagement-engineered first-comment text and a community-tab teaser post to extend signals beyond the video itself.

### Enhancement Features (Phase 2+)

14. **Hybrid scoring engine** — Nightly cron builds a corpus of real YouTube outliers across niches; new ideas are scored against empirical base rates of similar historical outliers, not LLM vibes alone.
15. **AVD predictor** — Predicts likely average view duration from script structure and flags dead zones before publish.
16. **Compound-effect forecast** — Models cumulative lift from CTR × AVD × suggested-traffic snowball.
17. **Calibration loop** — Tracks which scored ideas actually hit predicted virality after publish and recalibrates the scorer per niche.
18. **Niche vocabulary library** — Per-niche corpus of intent-specific phrases that historically convert, surfaced during title generation.
19. **Channel audit** (lifted from `claude-youtube`'s `audit` subskill) — Standalone four-dimension health check: SEO, performance, content, monetization.
20. **Content calendar generator** (lifted from `calendar` subskill) — Monthly plan with per-video metadata and seasonal CPM timing.
21. **Shorts production package** (lifted from `shorts` subskill) — Vertical-first scripts, visual change markers, loop setup.
22. **Cross-platform repurposing** (lifted from `repurpose` subskill) — Long-form video → Shorts clips + blog outline + LinkedIn post + X thread + email + podcast outline.

### Phase 3 Features

23. **AI thumbnail generation** — Gemini Imagen or FLUX generates the thumbnail background/character; programmatic Sharp/Canvas overlay produces sharp, editable typography.
24. **Custom LoRA / character training** — User uploads photos of themselves; we train a personal LoRA so every generated thumbnail features their consistent face and style. This is the defensible moat.

## Technical Approach

- **Frontend + API**: Next.js 15 with App Router, Server-Sent Events for streaming pipeline progress
- **Database**: Supabase (Postgres) — channels, ideas, kit outputs, cached YouTube data, outlier corpus
- **LLM**: Anthropic SDK — Claude Opus 4.7 for scoring and script generation, Claude Haiku 4.5 for lint, rewrites, and bulk tasks
- **YouTube data**: YouTube Data API v3, results cached aggressively in Supabase to stay inside the 10k-unit-per-day free quota
- **Auth**: Resend magic links
- **Payments (Phase 2+)**: Stripe — free tier exposes the idea scorer (lead magnet); paid tier unlocks full kit, history, and Phase 2/3 features
- **Reference**: Prompt patterns lifted from the MIT-licensed [AgriciDaniel/claude-youtube](https://github.com/AgriciDaniel/claude-youtube) skill (14 subskills, ~5,300 lines of battle-tested creator-growth markdown). Attribution maintained in `ATTRIBUTIONS.md` and app footer.

## MVP Scope

**Phase 1 (ship first):**
- Channel onboarding
- Email-magic-link auth
- One-shot 12-stage pipeline with streaming progress and per-stage re-run
- LLM-only virality scoring with 92% gate
- Text-only thumbnail concept briefs
- Idea history per user

**Deferred to Phase 2:**
- Hybrid scoring with real outlier corpus
- AVD predictor, compound forecast, calibration loop, niche vocabulary library
- Standalone subskill features (audit, calendar, shorts, repurpose, monetize)
- Stripe paywall

**Deferred to Phase 3:**
- AI image generation for thumbnails
- Programmatic text overlay
- Custom LoRA character training

## Success Criteria

**Phase 1 ship is "done" when:**
- A new user can paste their channel URL, drop a video idea, and receive a complete 12-stage kit in under 3 minutes
- The 92% gate refuses weak ideas and provides usable reframes
- Generated competitor outlier data reflects real, current YouTube state (not stale or hallucinated)
- All 12 stages are independently re-runnable without re-running the whole pipeline
- Generated scripts pass the anti-pattern lint and title-transcript drift check on themselves

**Product success looks like:**
- A creator with under 10k subscribers using a Phase 1 kit hits an outlier video (5×+ their channel median) within 30 days, replicating the case-study claim from the source material
- Free-tier email-capture conversion rate ≥ 25% on the idea-scorer landing page
- Paid-tier conversion ≥ 5% of free users within 60 days of Stripe launch in Phase 2
- The generated A/B test plans produce statistically meaningful learning, not just "variant B won"
