# Phase 3.9 — Cross-platform repurposing

**Parent:** Phase 3 — Phase 2 Enhancements
**Status:** Not Started
**Estimated:** 8-12 hours
**Depends on:** Phase 2 (completed `pipeline_runs`)
**Spec:** `Documentation/Overviews and Summaries/22-cross-platform-repurposing/spec.md`

## Goal

Take a completed pipeline_run kit → produce 7 derivative platform outputs: Shorts clips (3 timestamped 15-60s suggestions from script), blog outline (H1/H2/key points), LinkedIn post (1200-1800 chars narrative), X thread (6-12 tweets), email newsletter, podcast outline, community YouTube post. **Opt-in only** — does NOT auto-trigger from 12-stage pipeline. Per-platform regenerate. Char-limit truncation with `PLATFORM_VIOLATION` when content loss >30%.

## What to Build

### Step 1 — Data layer
- Migration `022_add_repurpose_data.sql`: add `pipeline_runs.repurpose_data` JSONB column + GIN index. No new RLS (uses parent run RLS).
- Migration `022_add_repurpose_platforms_enabled.sql`: add `profiles.repurpose_platforms_enabled` jsonb default with all 7 platforms `true` for new users.
- Zod schemas per platform: `ShortsClipsSchema [{timeSec, durationSec, clipScript, caption}][3]`, `BlogOutlineSchema {h1, sections: [{h2, keyPoints[]}], intro, outro}`, `LinkedinPostSchema {body 1200-1800 chars, hookLine, ctaLine}`, `XThreadSchema {tweets: string[6..12] each ≤280 chars}`, `EmailNewsletterSchema {subject, previewText, body 300-600 words, cta}`, `PodcastOutlineSchema {title, talkingPoints[], introHook, outroHook}`, `CommunityPostYoutubeSchema {body 200-500 chars}`. `RepurposeDataSchema = {shorts?, blog?, linkedin?, x?, email?, podcast?, community?, generatedAt, perPlatformStatus: {<platform>: 'ok'|'truncated'|'failed'}}`.

### Step 2 — Service + prompts (per CRIT-2)
- `lib/services/repurpose/context.ts`: shared source-context (idea_text + script_data only) with `cache_control` breakpoint — optional fields (titles/thumbnails/seo) appended AFTER breakpoint to preserve cache hits when those vary.
- `lib/services/repurpose/locks.ts`: per-platform mutex preventing concurrent same-run+platform calls.
- `lib/services/repurpose/orchestrator.ts`: sequential per-platform fan-out (NOT parallel) for prompt-cache hit rate + cleaner abort semantics + legible streaming UX. Total ~25-40s; revisit if >60s.
- `REPURPOSE_PLATFORM_MODELS` map: **Opus 4.7** for blog + podcast (narrative structure justifies Opus); **Haiku 4.5** for shorts + linkedin + x + email + community.
- Per-platform prompts in `lib/prompts/repurpose-<platform>.ts` with `cache_control` on system blocks ≥1024 tokens. Attribution `// Adapted from AgriciDaniel/claude-youtube (MIT) — sub-skills/repurpose.md`.
- Boundary-truncation helper: paragraph → sentence → word → char boundaries. `PLATFORM_VIOLATION` when content loss >30% even after retry.

### Step 3 — API endpoints
- `POST /api/runs/[runId]/repurpose { platforms: string[] }` SSE — only generates enabled platforms from the request body intersected with `profiles.repurpose_platforms_enabled`. Per-platform errors non-fatal (one failure doesn't block others). Emits one progress event per platform start + complete + error events as encountered.
- `POST /api/runs/[runId]/repurpose/regenerate { platform }` SSE — bypasses enabled-flag check (user explicitly requested).
- `GET /api/runs/[runId]/repurpose` — canonical mount read of `pipeline_runs.repurpose_data`.
- `GET /api/profile/repurpose-platforms` + `PUT` — settings (merge semantics).

### Step 4 — UI
- Repurpose tab on `/runs/[runId]`. `useRepurposeStream` SSE hook.
- 7 platform sub-cards rendered based on `profiles.repurpose_platforms_enabled`:
  - LinkedIn card with native styling (line breaks, hook line emphasized).
  - X thread visualization: connected tweet cards with thread connector lines.
  - Email card mimicking inbox preview (sender + subject + preview text).
  - Blog markdown preview with collapsible sections.
  - Shorts cards with timestamp pills.
  - Podcast outline indented list.
  - Community post YouTube-style preview.
- Each card: copy button, char count, regenerate button, "truncated" badge if applicable.
- `/settings/repurpose` toggle page with checkboxes per platform.

### Step 5 — Integration & testing
- `POST /repurpose` with `platforms: ['linkedin']` only writes `repurpose_data.linkedin`; other 6 keys remain absent.
- Per-platform errors non-fatal: LinkedIn failing twice doesn't block X / email / etc.
- Opt-in only: orchestrator does NOT call repurpose from 12-stage pipeline (verified by grep on `pipeline.ts` for repurpose imports — zero matches).
- Single JSONB column on `pipeline_runs` (not child table) — whole-bundle reads, no joins.
- Source-context cache breakpoint covers `idea_text` + `script_data`; titles/thumbnails/seo appended after preserves cache.
- LinkedIn output >1800 chars triggers paragraph-boundary truncation first; falling under 1000 chars on retry throws PlatformViolationError.
- `progress(truncated)` SSE event variant emitted when truncation occurs.
- Settings JSONB is loose-typed (no DB check constraint) — Zod-only validation allows Phase 3 platform additions without migration.

## Cross-feature contracts

- Reads `pipeline_runs.script_data, titles_data, thumbnails_data, seo_data, idea_text` (Phase 2). Script is the only hard requirement; the other three soft-fallback (output adapts if absent).
- Writes new column `pipeline_runs.repurpose_data` (this feature's migration).
- Reads new column `profiles.repurpose_platforms_enabled` (this feature's migration).
- Independent of Feature #21 — Feature #21 generates shorts FROM an idea; this generates shorts clips FROM a completed long-form run.

## Verification

- [ ] POST `/repurpose` with `platforms: ['linkedin']` only writes `repurpose_data.linkedin`, leaves other 6 keys absent (deep diff)
- [ ] Second platform call in same run shows `cache_read_input_tokens > 0` on shared source-context (cache breakpoint verified)
- [ ] LinkedIn output exceeding 1800 chars triggers paragraph-boundary truncation; if still over after retry, `PLATFORM_VIOLATION` returned
- [ ] One platform failing returns its error but other platforms still complete (e.g., X succeeds even if LinkedIn errored)
- [ ] No auto-trigger from 12-stage pipeline (grep `pipeline.ts` for `repurpose` imports → 0 matches)
- [ ] `profiles.repurpose_platforms_enabled` defaults to all 7 platforms `true` for new users
- [ ] Disabling LinkedIn in settings then POST `/repurpose { platforms: ['linkedin', 'x'] }` skips LinkedIn, generates X
- [ ] `progress(truncated)` SSE event variant emitted when truncation occurs (not just `progress(ok)`)
- [ ] CRIT-2: Opus for blog + podcast (3 platforms with comments); Haiku for 5 others
- [ ] CRIT-3: every system prompt ≥1024 tokens has `cache_control`
- [ ] CRIT-4 attribution: `sub-skills/repurpose.md`

## Out of scope

- Auto-trigger from kit completion (opt-in only Phase 2)
- Parallel fan-out (sequential for cache hits Phase 2; revisit if >60s)
- Auto-posting to platforms (no platform write APIs)
- Translating outputs to other languages
- Image/asset generation per platform (Phase 3)
- Analytics tracking across platforms
- TikTok / Instagram / Facebook (Phase 1 lists only 7 platforms)
