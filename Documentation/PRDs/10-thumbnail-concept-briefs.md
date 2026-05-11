# PRD — Thumbnail Concept Briefs (Stage 9)

## Feature Name
Thumbnail Concept Briefs

## Overview
Generates three thumbnail concept briefs, each matched 1:1 to one of the title angles from Stage 5. Each brief specifies composition, hex colors, facial expression, overlay-text copy, and a synergy note explaining how it complements the title. Phase 1 is text-only briefs; Phase 3 will generate actual images.

**Problem solved:** Thumbnails are the single highest-leverage CTR variable. Most creators design them on vibes. Briefs force composition and color decisions to be deliberate and tied to the title's psychological angle.

## User Stories
- As a creator, I want a thumbnail concept for each of my three titles, so my A/B test pairs title + thumbnail meaningfully.
- As a creator, I want hex color codes specified, so I can replicate the design in Canva or Photoshop without guessing.
- As a creator, I want the overlay text suggested, so the thumbnail's text reinforces (not echoes) the title.
- As a creator, I want a synergy note explaining how each brief pairs with its title, so I understand the design choices.
- As a creator, I want each brief feasible to produce with stock photos + my own face, so I'm not asked to commission custom illustration.

## Functional Requirements
- Input: 3 titles (Stage 5), idea text, niche, channel branding hints (if available — colors, signature elements)
- Output: 3 thumbnail briefs, each with:
  - Linked title (1:1 by index)
  - Composition description: subject placement (rule of thirds, centered, off-center), foreground/background separation, focal point
  - Color palette: 3–5 hex codes with role (primary, accent, background, contrast)
  - Overlay text copy (≤ 4 words, distinct from title)
  - Facial expression directive (if subject is a person): e.g., "wide-eyed surprise looking off-frame to the right"
  - Reference style cues: 2–3 keywords describing aesthetic ("clean infographic," "high-contrast bold," "documentary candid")
  - Synergy note: how the thumbnail completes the title's psychological angle without redundancy
- Persist `thumbnails_data` to `pipeline_runs` row
- Phase 1: text-only briefs, no image generation
- Designed to be portable to Canva/Photoshop/Figma without further interpretation

## User Interface

### Screens
Renders as a card within `/runs/[runId]`.

### Card layout
- Header: "Thumbnail Concepts" + status + "Regenerate"
- 3 brief cards in same order as titles, each showing:
  - Linked title at top
  - Composition description
  - Color palette as small color swatches with hex codes
  - Overlay text in a stylized preview (sample typography)
  - Facial expression directive
  - Reference style chips
  - Expandable synergy note
  - Copy-brief-as-markdown button

### Key interactions
- Color swatches are clickable to copy the hex code
- Copy-brief produces a clean markdown summary suitable for handing to a designer or Canva paste

## States to Handle

### Happy path
Stage runs → 3 briefs generated → rendered with palettes and copy.

### Error states
- Stage 5 titles missing → error: "Briefs require titles. Re-run Stage 5 first."
- LLM returns brief missing required fields (composition, colors, overlay) → re-prompt once
- Hex codes returned malformed → fix by regex or re-prompt
- Overlay text exceeds 4 words → truncate at word boundary, flag

### Empty states
- Not applicable.

### Loading states
- Card shows spinner with text "Designing three thumbnail concepts…"

## Edge Cases
- Idea is abstract (no clear visual subject) → briefs lean on typography + color contrast; flag as "type-driven" thumbnails
- Channel uses face-based thumbnails by convention but topic doesn't suggest a face → briefs offer both face and non-face options
- Niche has thumbnail conventions (e.g., red/yellow gradients in finance) → briefs reference convention but don't blindly conform
- Three titles all suggest the same composition → enforce diversity; re-prompt if briefs duplicate
- Topic is sensitive → briefs avoid sensational visuals
- Channel branding hints contradict the algorithm-optimal palette (channel uses muted tones; outliers use saturated) → present both and explain trade-off
- User has no Canva or design tool → briefs still useful as a description for any tool

## Out of Scope
- Actual image generation (Feature #23, Phase 3)
- LoRA character training (Feature #24, Phase 3)
- Programmatic text overlay rendering (Phase 3)
- Generating Shorts thumbnail concepts (different aspect ratio — handled in #21)
- A/B test plan structure (Feature #12)
- Saving brand asset library (logos, fonts) for reuse (Phase 2)
- Suggesting stock-photo sources for the brief
