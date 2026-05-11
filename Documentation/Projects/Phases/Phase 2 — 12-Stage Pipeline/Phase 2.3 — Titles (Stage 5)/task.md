# Phase 2.3 — Titles (Stage 5)

**Parent:** Phase 2 — 12-Stage Pipeline
**Status:** Not Started
**Estimated:** 6-8 hours
**Depends on:** Phase 2.2 (score_data.passed=true OR scored_overridden)
**Spec:** `Documentation/Overviews and Summaries/06-title-generation/spec.md`

## Goal

Haiku 4.5 generates 3 title variants, one per psychological trigger (curiosity / fear / result). Voice samples from channel's last-20 video titles. Char-limit ≤100 (warn at 70). Per-card regenerate + lock-in. Locked titles unblock Stage 6/7/9/10/11/12 fan-out.

## What to Build

### Step 1 — Data layer
- `lib/validation/titles.ts`: `TitleVariantSchema = { text (1-100 chars), trigger (closed enum: 'curiosity'|'fear'|'result'), predictedCtrLift, reasoning, lockedIn (bool), vocabRefs: [] (placeholder for Feature #18), audienceCluster }`. `TitlesDataSchema = { curiosity: TitleVariant | null, fear: T | null, result: T | null, intentRewrites: string[3..5], chosenIndex: 0|1|2|null, generatedAt }`. Schema version literal.
- `lib/db/titles.ts`: typed CRUD with on-read Zod parse + ownership enforcement.

### Step 2 — Service + prompt (Haiku 4.5 per CRIT-2)
- `lib/prompts/titles.ts`: system prompt with `cache_control` (≥1024 tokens), trigger psychology brief, char-limit rules, attribution `// Adapted from AgriciDaniel/claude-youtube (MIT) — sub-skills/seo.md`. Model literal `claude-haiku-4-5-20251001`.
- `lib/services/titles.ts`: 3 sequential Haiku calls (one per trigger) for streaming UX + cache hits on calls 2-3. Reads `competitor_data.extractedPatterns` to ground in proven angles + `score_data` for context. Voice samples from `channels.top_videos_json` last-20 titles (niche-typical fallback if <3 videos).
- Jaccard diversity check: similarity >0.6 between any 2 titles triggers 1 retry then accepts with flag.
- Char-limit enforcement: >100 → auto-truncate at word boundary + re-prompt once → hard error on 2nd violation.
- Intent-rewrite: separate sub-call generates 3-5 niche-specific phrasings.

### Step 3 — API endpoints
- `POST /api/pipeline/titles { runId }` SSE — emits 3 progress events (one per trigger) + complete.
- `POST /api/pipeline/titles/regenerate { runId, trigger }` — single trigger, preserves other 2.
- `POST /api/pipeline/titles/lock { runId, trigger, titleText }` — overwrites generated text with user's chosen string, sets lockedIn=true.
- `POST /api/pipeline/titles/unlock { runId, trigger }`.
- Soft regen cap UI nudge at 3+ regens (per-user 30/hr rate limit at API level).

### Step 4 — UI
- 3 title cards with trigger badges (curiosity purple `#a855f7`, fear red `#ef4444`, result green `#10b981`).
- Per-card: text + char counter + predicted CTR delta meter + reasoning expandable + copy/regenerate/edit-inline/lock buttons.
- "Continue to thumbnails" CTA enabled when ≥1 title locked.
- SSE shimmer state per trigger during streaming.
- Char counter rose at >100, amber at >70.

### Step 5 — Integration & testing
- Stage 6/7/9/10/11/12 fan-out unblocks when ANY title is locked (`canRunStage` returns true).
- Voice-sample influence: titles use channel's tone words (verified by snapshot test against fixtures).
- Diversity retry path: 2 too-similar titles trigger 1 retry, then flag.
- Char-limit: 101-char output triggers 1 retry; 2nd violation throws CHAR_LIMIT_VIOLATION.
- Prompt-cache hit on calls 2 and 3.
- `MISSING_PREREQUISITES` short-circuits before token spend when score_data.passed=false.

## Cross-feature contracts

- Reads `pipeline_runs.idea_text`, `competitor_data`, `score_data` (Phase 2.1/2.2), `channels.niche`, `channels.top_videos_json` (Phase 1.5).
- Writes `pipeline_runs.titles_data` — consumed by Stages 6, 7, 9, 10, 11, 12.
- Trigger enum is closed and shared design tokens (curiosity/fear/result) used by Stage 9 thumbnails, Stage 11 A/B plan.
- Future Feature #18 extends titles prompt with niche vocabulary (additive, no schema change).

## Verification

- [ ] `POST /api/pipeline/titles` SSE emits 3 progress events with trigger names matching {curiosity, fear, result}
- [ ] Model literal `claude-haiku-4-5-20251001` pinned via `z.literal` in schema
- [ ] System prompt has `cache_control: ephemeral`; calls 2 + 3 show `cache_read_input_tokens > 0`
- [ ] Char count >100 → auto-truncate at word boundary + re-prompt once; 2nd violation throws CHAR_LIMIT_VIOLATION
- [ ] Jaccard similarity >0.6 between any 2 titles triggers exactly 1 retry
- [ ] `MISSING_PREREQUISITES` returned BEFORE any LLM call when `score_data.passed !== true`
- [ ] Voice samples used when ≥3 videos exist; niche-typical fallback otherwise with banner
- [ ] Lock endpoint sets `titles_data.<trigger>.lockedIn = true` and overwrites text; other 2 triggers unchanged
- [ ] Regenerate single trigger preserves other 2 byte-for-byte
- [ ] Stage 6/7/9/10/11/12 fan-out gated on titles_data — verified by canRunStage helper

## Out of scope

- Niche vocabulary injection (Feature #18)
- Embedding-based diversity (Phase 2 enhancement; Jaccard for MVP)
- CTR re-estimation on inline edit (saved as-is)
- Collision detection vs existing YouTube titles (Phase 2 — costs 300 quota units)
