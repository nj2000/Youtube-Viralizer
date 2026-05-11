# Phase 4.1 — AI thumbnail generation

**Parent:** Phase 4 — AI Generation
**Status:** Not Started
**Estimated:** 12-16 hours (substantial Phase 3 infrastructure)
**Depends on:** Phase 2.7 (thumbnail briefs), Phase 4.2 (LoRA optional but tightly integrated)
**Spec:** `Documentation/Overviews and Summaries/23-ai-thumbnail-generation/spec.md`

## Goal

Replace text-only Stage 9 briefs with finished 1280×720 thumbnail images. Pipeline: Gemini Imagen primary → FLUX Replicate fallback (used when LoRA present) → Sharp + SVG text overlay → OCR garbled-text check → NSFW handling → Supabase Storage with signed URLs. 10/month per-user quota. "Your face here" placeholder when LoRA not trained. Opt-in (not auto-trigger).

## What to Build

### Step 1 — Storage + DB
- Supabase Storage `thumbnails` bucket: public-read DISABLED, signed URLs 1h TTL, paths embed `user_id` for trivial authorization.
- Migration: `pipeline_runs.thumbnail_images_data` JSONB sibling column to `thumbnails_data`. `thumbnail_generations` audit table (id, run_id FK, trigger, generation_provider enum, prompt_text, generated_image_url, final_composite_url, source_brief_jsonb, cost_units cents, is_image_gen bool — distinguishes overlay-re-renders, generated_at, deleted_at). Partial index + RLS auth.uid().
- Zod schemas for image-gen output, font-set enum, OCR result.

### Step 2 — Image-gen providers
- `lib/image-gen/imagen.ts` — Gemini Imagen adapter; primary unless LoRA present.
- `lib/image-gen/flux.ts` — FLUX Replicate adapter (`flux-dev-lora`); used when `lora_models.status='ready'` for the channel.
- `lib/image-gen/types.ts` — provider abstraction interface with `generate(prompt, params)`.
- `lib/image-gen/prompts.ts` — brief → prompt translation. Composition + palette + overlay text + facial expression + LoRA trigger token slot (`<creator_X>` injected when active LoRA exists; "your face here" generic stock-photo person when not).
- NSFW sanitization: 2 retry attempts with sanitized prompts; if both fail, surface NSFW_PERSISTENT error and fall back to brief-only with explanation.
- Exponential backoff per EXT-3.
- `generateWithFallback`: try primary → on failure try fallback → on both fail throw `IMAGE_GEN_FAILED`.

### Step 3 — Sharp overlay + OCR
- Curated 3-font set bundled at build time: Anton, Inter Black, Bebas Neue. `lib/fonts/index.ts` font fetcher with fallback chain.
- `lib/image-gen/overlay.ts` Sharp pipeline: composite SVG text on background. Auto-shrink to 48pt floor with warning if would-be smaller (mobile feed readability).
- `lib/image-gen/ocr.ts` Tesseract sandbox: server-side OCR check on background. 0.7 confidence threshold. If garbled text detected, re-prompt with explicit "ABSOLUTELY NO TEXT OR LETTERS in the background" — exactly 1 retry. Fail-open on OCR engine timeout (image ships with warning).

### Step 4 — API endpoints
- `POST /api/runs/[runId]/thumbnail-images { regenerateTrigger? }` SSE — generates or regenerates a single trigger (collapses PRD's two actions). Progressive rendering: one trigger rendering at a time with skeleton placeholders.
- `POST /api/runs/[runId]/thumbnail-images/overlay-text { trigger, text }` — server-side re-render of TEXT LAYER ONLY (zero credits; `is_image_gen=false` in audit). Overrides PRD's "client-side re-render" for parity and determinism.
- `GET /api/thumbnail-generations/[generationId]` — signed URL fetch.
- `POST /api/runs/[runId]/thumbnail-images/[trigger]/download` — generates fresh signed URL (1h TTL).
- `DELETE /api/thumbnail-generations/[generationId]` — discard.
- `GET /api/profile/thumbnail-quota` — current month usage out of 10.
- Soft quota accounting: failures (NSFW reject, OCR re-prompt fail, image-gen API 5xx, cancelled) do NOT burn credits (we absorb ~$60/mo at 30k users).

### Step 5 — UI
- Stage 9 thumbnail card extended with 3 finished thumbnail image cards (1280×720 displayed at scale).
- Per-thumbnail: download PNG button, regenerate button, edit-overlay-text inline button, full-size modal, "Your face here" overlay banner when LoRA absent.
- Cost indicator badge: "3/10 generations remaining this month".
- `useThumbnailStream` SSE consumer; progressive rendering (one thumbnail rendering + skeletons for other two).
- Modals: overlay editor (textarea + live preview), full-size lightbox, regen confirmation, quota-exhausted upgrade CTA.

### Step 6 — Integration & testing
- LoRA presence flips primary provider Imagen → FLUX (verified by grep on `lora_models` read in provider selector).
- LoRA absent + face-wanted brief → renders generic stock-photo person + `loraUsed.fellbackToStock=true` + `flags.loraUnavailable=true` + banner CTA "Train your character (Feature #24)".
- OCR triggers re-prompt with "no text in background" exactly once; second garbled image ships with warning.
- NSFW retry max 2 sanitization attempts then brief-only fallback with explanation.
- Quota exhausted shows upgrade CTA (Phase 4 paid tiers).
- Soft quota accounting: failures don't burn credits (verified by checking `is_image_gen=false` overlay re-renders don't increment counter).
- Storage path embeds `user_id` for trivial authorization.
- Signed URL TTL exactly 3600 seconds.
- Sharp-rendered overlay vs provider-rendered may show seams in ~5% — Sharp wins for determinism.
- ETA estimator is naive (running average per provider; not perfect but acceptable).

## Cross-feature contracts

- Reads `pipeline_runs.thumbnails_data` (Phase 2.7 briefs).
- Reads `channels.niche` (Phase 1.5).
- Reads Feature #24 `lora_models` when present (active LoRA for channel) — graceful absence.
- Reads Feature #25 `channel_assets` (logo, background) — optional, slot present in prompt.
- Writes `pipeline_runs.thumbnail_images_data` (new sibling column added by this feature).
- Writes `thumbnail_generations` audit table (this feature owns).

## Verification

- [ ] Supabase signed URL TTL is exactly 3600 seconds
- [ ] OCR confidence <0.7 triggers re-prompt with explicit no-text instruction (exactly 1 retry)
- [ ] 11th generation in calendar month returns 403 QUOTA_EXHAUSTED
- [ ] Soft quota: NSFW reject / OCR fail / 5xx do NOT increment `monthly_count` (audit `is_image_gen` differentiates)
- [ ] LoRA present for channel → provider selector returns FLUX (not Imagen)
- [ ] LoRA absent + face-wanted brief → output flags `loraUsed.fellbackToStock=true`
- [ ] Storage path embeds `user_id` — `/thumbnails/<user_id>/<run_id>/<trigger>.png`
- [ ] Sharp-composited overlay text: auto-shrink to 48pt floor; warning surfaced when floor hit
- [ ] Overlay-text re-render endpoint sets `is_image_gen=false` and consumes 0 credits
- [ ] Quota exhausted modal shows upgrade CTA stub (Phase 4 paid tiers)
- [ ] CRIT-1 N/A (no YouTube calls); CRIT-2 N/A (no Anthropic); CRIT-3 N/A (no LLM prompts); CRIT-4 unaffected (absence of port — `ATTRIBUTIONS.md` unchanged)
- [ ] Curated 3-font set bundled at build time (Anton, Inter Black, Bebas Neue) — not fetched at runtime

## Out of scope

- Per-tier quotas (single constant 10/mo Phase 3; Phase 4 paid tiers)
- Resumable SSE (90s disconnect uses polling fallback)
- Multi-variant per trigger (one image per trigger; regenerate is the proxy)
- ZIP multi-download endpoint (Phase 4)
- Second-line NSFW classifier (trust provider + OCR; revisit on incident)
- Multi-tenant org migration (storage path user_id-embedded)
