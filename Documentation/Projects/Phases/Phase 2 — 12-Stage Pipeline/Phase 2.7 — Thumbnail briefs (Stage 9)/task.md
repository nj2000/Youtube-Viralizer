# Phase 2.7 — Thumbnail concept briefs (Stage 9)

**Parent:** Phase 2 — 12-Stage Pipeline
**Status:** Not Started
**Estimated:** 5-7 hours
**Depends on:** Phase 2.3 (3 locked titles)
**Spec:** `Documentation/Overviews and Summaries/10-thumbnail-concept-briefs/spec.md`

## Goal

Haiku 4.5 generates 3 thumbnail concept BRIEFS (text-only — actual image generation is Phase 3 Feature #23). One brief per trigger, matched 1:1 to the locked title. Composition + palette + focal point + overlay text + rationale.

## What to Build

### Step 1 — Data layer
- `lib/validation/thumbnails.ts`: closed enums `FocalPointEnum` (left/right/center/top/bottom thirds), `CharacterPlacementEnum` (left/right/none), `StyleRegisterEnum` (high-contrast/cinematic/clean), `PaletteRoleEnum` (primary/accent/neutral/highlight — all 4 required unique). `HexColorSchema` regex `/^#[0-9a-fA-F]{6}$/`. `PaletteEntrySchema = {hex, role}`. `ThumbnailBriefSchema = {trigger (curiosity/fear/result), composition, focalPoint, characterPlacement, palette: PaletteEntry[] (exact length 4 with role uniqueness), facialExpression, overlayText (3-5 words), backgroundConcept, whyItWorks, styleRegister, pairsWithTitle: {trigger, textSnapshot} (for stale detection), schemaVersion: z.literal(1)}`. `ThumbnailsDataSchema = {curiosity: ThumbnailBrief | null, fear: T | null, result: T | null, generatedAt}`.

### Step 2 — Service + prompt
- `lib/prompts/thumbnails.ts`: Haiku 4.5 ~2400-token system prompt with `cache_control` (CRIT-3). Attribution `// Adapted from AgriciDaniel/claude-youtube (MIT) — sub-skills/thumbnail.md`. Palette generation rules: WCAG-AA 4.5 contrast between overlay text and background; trigger color hooks (curiosity-purple, fear-red distinct from yt-brand-red via ΔE2000<15 cousin handling, result-green); saturation balance; niche convention overrides; channel asset injection slot (empty placeholder until Feature #25).
- `lib/services/thumbnails.ts`: 3 sequential Haiku calls (one per trigger, ~9s total) for streaming UX with cache hits on calls 2-3. Reads locked titles from `titles_data`. Echo defense (model can't return literal user input as overlay). Truncation if overlayText > 5 words → re-prompt once.
- Diversity check + WCAG-AA auto-fix services.

### Step 3 — API endpoints
- `POST /api/pipeline/thumbnails { runId }` SSE — per-trigger progress events.
- `POST /api/pipeline/thumbnails/regenerate { runId, trigger }` JSON — single trigger, preserves other 2 byte-for-byte.
- Per-user 30 ops/hour rate limit.
- Schema is image-gen-friendly (Feature #23 reads `thumbnail_images_data` sibling JSONB column added by that feature).

### Step 4 — UI
- 3 brief cards with trigger badges (locked curiosity/fear/result color tokens).
- 16:9 placeholder composition mockup per card (CSS-only gradient div simulating thumbnail with overlay text + palette swatches as dots).
- Per-card: composition description, palette (4 swatches with role labels), focal point indicator, facial expression, overlay text (3-5 words rendered styled), why-it-works rationale.
- Buttons: copy spec, regenerate, "send to designer" markdown export, **Lock in DISABLED with tooltip "Coming in Phase 3 with AI thumbnail generation"** (Feature #23 retrofit).

### Step 5 — Integration & testing
- Palette has exactly 4 entries with unique roles (refine constraint verified).
- WCAG-AA contrast ratio ≥4.5 between overlay text hex and dominant background hex.
- Regenerate single trigger preserves other 2 unchanged.
- Schema forward-compat: Feature #23 reads `thumbnails_data` to build prompts + writes `thumbnail_images_data`.
- Feature #25 channel assets injection placeholder (empty `<channel_assets>` block in prompt until that feature ships).
- Stage 9 eligible for parallel build with Stage 8 + Stage 10 once Stage 5 (titles) ships.

## Cross-feature contracts

- Reads `pipeline_runs.titles_data` (3 locked titles required), `idea_text`, `channels.niche`.
- Writes `pipeline_runs.thumbnails_data` — consumed by Stage 11 (A/B plan), Feature #23 (image generation Phase 3).
- Trigger enum + color tokens shared with Stages 5/8/11 (locked at mockup #01 design phase).
- Future Feature #25 channel assets read in by injecting into prompt (additive).

## Verification

- [ ] `ThumbnailsDataSchema` rejects palette with !=4 entries
- [ ] Palette role values are unique within a brief (refine constraint)
- [ ] HexColorSchema rejects `#abcdef0` (7 chars) and `abc` (no #)
- [ ] WCAG-AA contrast: every brief has overlay-to-background ratio ≥ 4.5 (auto-fix or re-prompt if not)
- [ ] Regenerate single trigger leaves other 2 byte-identical (deep diff)
- [ ] `overlayText` word count is 3-5 (model output exceeding 5 words triggers re-prompt; <3 words is accepted)
- [ ] Stage 9 starts when only `titles_data` exists (does NOT require Stages 6/7/8)
- [ ] System prompt has `cache_control`; 2nd + 3rd trigger calls show `cache_read_input_tokens > 0`
- [ ] Lock-in button rendered disabled with Phase 3 tooltip
- [ ] CRIT-2: `claude-haiku-4-5-20251001` model literal pinned

## Out of scope

- AI image generation (Feature #23 / Phase 3)
- LoRA character training (Feature #24)
- Brand asset library (Feature #25 — empty placeholder slot in prompt)
- Lock-in flow (Phase 3 with #23)
- Vision-based palette extraction
