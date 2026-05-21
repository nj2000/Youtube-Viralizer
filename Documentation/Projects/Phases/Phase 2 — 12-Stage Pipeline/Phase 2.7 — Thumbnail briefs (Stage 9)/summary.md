# Phase 2.7 — Thumbnail concept briefs (Stage 9) — Summary

**Status:** Complete · **Stage:** 9 of 12 · **Model:** Haiku 4.5 (CRIT-2)
**Spec:** `Documentation/Overviews and Summaries/10-thumbnail-concept-briefs/spec.md`

Haiku 4.5 generates **text** thumbnail concept briefs — one per *locked* title,
keyed by trigger (curiosity/fear/result). Each brief: composition, focal point,
character placement, 4-swatch palette (roles `primary/accent/background/contrast`),
facial expression, 3–5-word overlay text, background concept, style chips, and a
"why it works" rationale. **No image generation** — that's Phase 4 (#23/#24).

## Build decisions (A/A/A, confirmed with the user — same shape as 2.6)

1. **Bus pattern, not the spec's SSE.** Consistent with Stages 3–6 and the
   already-wired `/continue → thumbnails` resume; no streaming-JSON parser.
2. **WCAG-AA contrast enforced (TS); full ΔE2000 cousin-matching deferred.**
   `enforceOverlayContrast` guarantees overlay↔background ≥ 4.5 by swapping to the
   best palette swatch. `// TODO(phase-2):` the ΔE2000<15 trigger-cousin rule
   (spec §5.5) — it's not in the verification checklist and adds a colour-science impl.
3. **30 ops/hour rate-limit deferred** `// TODO(phase-2):` (no backing table; same
   call as 2.6).

## Files delivered

- `lib/validation/thumbnails.ts` — Hex/PaletteRole/FocalPoint/CharacterPlacement/
  StyleRegister enums, `PaletteSwatch`, `ThumbnailBrief` (palette length-4 + role
  uniqueness + overlay-color∈palette + facialExpression-XOR-none via `superRefine`),
  `ThumbnailsData` keyed by trigger, model literal pinned, `schemaVersion: z.literal(1)`.
- `lib/prompts/thumbnails.ts` — Haiku ~2400-tok system (CRIT-3 cache), CRIT-4
  attribution to `sub-skills/thumbnail.md`, trigger color hooks + composition/overlay
  rules + empty `<channel_assets>` slot, `buildThumbnailUserPrompt` (per-trigger, XML-wrapped).
- `lib/services/thumbnails.ts` — handler (per-locked-trigger sequential calls,
  partial returns), `regenerateThumbnailTrigger`, `registerStageHandler`.
- `lib/services/thumbnails-llm.ts` — `generateOneBrief` (call + coerce + 1 retry,
  echo-defense, overlay word-count/truncation, contrast enforcement).
- `lib/services/thumbnails-palette.ts` — WCAG contrast ratio + auto-fix, diversity
  collision, `wordCountOf` (pure, unit-tested).
- `lib/db/thumbnails.ts` — read/write (byte-preserving per-trigger regenerate).
- `app/api/pipeline/thumbnails/{route,regenerate/route}.ts` — fire-and-forget 202
  bus run + JSON single-trigger regenerate.
- `app/(app)/runs/[runId]/Stage9Card.tsx` + `stage9/{shared,GeneratingCard,ThumbnailBriefCard}.tsx`
  — 3 brief cards with a 16:9 CSS composition preview (inline styles for dynamic
  hex), palette swatches, overlay text, why-it-works, **disabled Lock-in (Phase-3
  tooltip)**, regenerate; `lib/hooks/useThumbnails.ts`.
- `tests/services/thumbnails.test.ts` — 15 tests.
- **Wiring:** `stage-handlers.ts` import; `Stage9Card` branch in `RunView.tsx`.

## Deviations from task.md (spec is authoritative)

- **Palette roles** = `primary/accent/background/contrast` (spec), not task.md's
  "neutral/highlight" and not the mockup's inconsistent 3-swatch examples.
- **Overlay text 3–5 words** (spec schema); the subskill says "max 3" and the task
  says "<3 accepted" — followed the spec and re-prompt outside the range.
- **`schemaVersion` lives on `ThumbnailsData`** (codebase convention across all
  stages), not per-brief as task.md phrased.
- **Lock-in disabled** → Stage 9 is not a checkpoint; it just generates briefs.
- The bespoke per-trigger composition frames in the mockup are illustrative; the
  card renders a generic CSS approximation driven by the brief's palette/placement.

## Verification (task.md checklist)

- [x] `ThumbnailsDataSchema`/brief rejects palette ≠ 4 entries
- [x] Palette role uniqueness enforced (`superRefine`)
- [x] `HexColorSchema` rejects `#abcdef0`, `abc` (and uppercase)
- [x] WCAG-AA ≥ 4.5 overlay↔background (auto-fix swaps to best swatch; `paletteContrastFail` flag if even that fails)
- [x] Regenerate single trigger preserves the other two (`{...existing, [trigger]: …}` + byte-preserving DB write)
- [x] Overlay word count enforced (schema 3–5; >5 truncates, <3 re-prompts)
- [x] Stage 9 starts with only `titles_data` (`stageDependencies.thumbnails = ["score","titles"]`, tested)
- [x] System prompt has `cache_control` (EST 2400 ≥ 1024); 2nd/3rd trigger cache hit is a live-API manual check
- [x] Lock-in button rendered disabled with Phase-3 tooltip
- [x] CRIT-2: `claude-haiku-4-5-20251001` literal pinned (`stageModel.thumbnails`, tested)

**Gate:** `pnpm typecheck` + `pnpm lint` clean; `pnpm test` → **143 passed** (15 new).
**Not click-tested:** routes load cleanly (verified via the dev server) but the brief
cards weren't exercised in a browser this session.

## Follow-ups / known gaps

- `// TODO(phase-2):` ΔE2000 cousin-matching + 30/hour rate limit.
- Lock-in flow + AI image generation are Phase 4 (#23/#24); the schema is already
  image-gen-friendly (a sibling `thumbnail_images_data` column is the retrofit point).
- `<channel_assets>` prompt slot is empty until Feature #25 (brand assets).
