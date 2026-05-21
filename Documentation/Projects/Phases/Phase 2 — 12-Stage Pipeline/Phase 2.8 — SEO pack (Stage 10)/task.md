# Phase 2.8 — SEO metadata pack (Stage 10)

**Parent:** Phase 2 — 12-Stage Pipeline
**Status:** Complete
**Estimated:** 6-8 hours
**Depends on:** Phase 2.3 (locked title), Phase 2.5 (script_data)
**Spec:** `Documentation/Overviews and Summaries/11-seo-metadata-pack/spec.md`

## Goal

Generate the full SEO pack: description (≤5000 chars, first 2 lines bolded above-fold), tags (≤500 chars total), hashtags (3 primary + 5 optional), chapters (deterministic from script section boundaries — no LLM), end-screen suggestions (heuristic + Haiku reasoning), pinned-comment template. Per-section regenerate.

## What to Build

### Step 1 — Data layer
- Migration: add `pipeline_runs.is_sponsored boolean default false` with partial index.
- `lib/validation/seo.ts`: per-section Zod schemas (`DescriptionSchema`, `TagsSchema`, `HashtagsSchema { primary: string[3], optional: string[5] }`, `ChaptersSchema [{timeSec, label}]` with first.timeSec===0, `EndScreenSuggestionsSchema [{videoId, title, reason}][2]`, `PinnedCommentDraftSchema`). `SeoDataSchema` combines all.

### Step 2 — Service (5 Haiku sub-calls + 1 deterministic)
- `lib/prompts/seo-description.ts` + service: Haiku 4.5 first line = above-fold hook, line 2 = value prop, then bullet recap + links placeholder + credits + hashtags. Auto-truncate at sentence boundary if >5000 chars + 1 re-prompt. Sponsor injection per FTC if `is_sponsored=true`.
- `lib/prompts/seo-tags.ts` + service: Haiku 4.5 generates 12-15 tags balancing specific + broad. Relevance-scored trim-to-fit ≤500 chars total (including delimiters). Diversity policy: no all-substring overlap.
- `lib/prompts/seo-hashtags.ts` + service: Haiku 4.5 generates 3 primary + 5 optional. Single re-prompt on duplicates.
- `lib/prompts/seo-pinned-comment.ts` + service: Haiku 4.5 — `tiered_cta` template locked for Phase 1.
- `lib/services/seo/chapters.ts`: **DETERMINISTIC** — derives from `script_data.sections[].startSec`. First chapter must be `0:00`. Saves a Haiku call, eliminates hallucination, sub-50ms latency.
- `lib/services/seo/endscreen.ts`: heuristic candidate selection (top-1 by views + top-1 by noun-phrase-overlap with title) from `channels.top_videos_json`; Haiku writes the reason copy only.
- `lib/services/seo/compliance.ts`: FTC + financial/medical disclaimer copy isolated for legal review.

### Step 3 — API endpoints
- `POST /api/pipeline/seo { runId }` SSE — 5 progress events (description, tags, hashtags, endscreen+chapters, pinned).
- `POST /api/pipeline/seo/regenerate-section { runId, sectionType }` SSE — single section in isolation.
- `GET /api/pipeline/seo/copy-format { runId, format }` — returns description/tags/chapters as plain-text bundle for copy-paste.
- `PATCH /api/runs/[runId]/sponsored { is_sponsored }` — opt-in toggle for FTC disclosure auto-insert.

### Step 4 — UI
- YouTube-preview mockup at top: title + channel + view-count placeholder + truncated description (first 2 lines bold).
- Per-section cards: description (with first-2-lines bold preview), tags (chips removable client-side), hashtags (3 primary callouts + optional list), chapters (timestamped from script), end-screen (2 thumbnail placeholders + reasons), pinned-comment.
- Char counters: description ≤5000, tags ≤500.
- Sponsor toggle (PATCH `is_sponsored`); banner when on.
- 9 banners: FTC, compliance, char-limit, tags-trimmed, chapters-fallback, short-form, brand-new channel, partial-failure, missing-prereqs.
- Master "Copy all" button.

### Step 5 — Integration & testing
- Chapters deterministic — zero Anthropic calls for chapter generation.
- First chapter `timeSec === 0` always.
- Sum of tag char lengths + delimiters ≤ 500 (verified by integration test).
- Description first 2 lines marked above-fold (server-side parsed).
- Per-section regen preserves other 5 sections byte-identical.
- End-screen videos must exist in `channels.top_videos_json`.
- If `is_sponsored=true`, description starts with FTC disclosure prefix.
- Niche-vocabulary read-only hook (Phase 2 Feature #18 future).

## Cross-feature contracts

- Reads `titles_data` (locked), `script_data`, `idea_text`, `channels.niche`, `channels.top_videos_json`.
- Writes `pipeline_runs.seo_data`. NOT consumed by any downstream pipeline stage (leaf).
- Adds `pipeline_runs.is_sponsored` column (this stage's migration).
- Feature #18 (niche vocabulary) future-reads enhanced description/tag prompts.

## Verification

- [ ] First chapter `timeSec === 0` always
- [ ] Sum of tag chars + delimiters ≤ 500
- [ ] Description first 2 lines marked above-fold in `seo_data.description.aboveFoldLines`
- [ ] Description >5000 chars triggers single re-prompt then truncates at sentence boundary
- [ ] Regenerate description does not modify other seo_data sections
- [ ] Chapters generated DETERMINISTICALLY (zero Anthropic API calls in chapter generation path — verified by grep)
- [ ] `is_sponsored=true` → description starts with FTC disclosure literal prefix
- [ ] End-screen `videoId` exists in `channels.top_videos_json`
- [ ] CRIT-2: Haiku 4.5 for all 4 LLM sub-calls; deterministic chapters bypass model
- [ ] CRIT-3: each ≥1024-token system prompt has `cache_control`; 2nd run shows cache hit
- [ ] Hashtag schemas validate exactly 3 primary + 5 optional
- [ ] CRIT-4 attribution: `// Adapted from AgriciDaniel/claude-youtube (MIT) — sub-skills/metadata.md`

## Out of scope

- Section history (regen overwrites in place)
- ETag concurrency control (last-write-wins on multi-tab)
- Niche-vocabulary integration (Feature #18)
- Description condense second-pass (truncation mechanical only)
- Multi-template pinned-comment (tiered_cta only Phase 1)
- Niche-policy disclaimer auto-detection beyond keyword substring (Phase 2 refinement)
