# PRD — AI Thumbnail Generation

## Feature Name
AI Thumbnail Generation

## Overview
Replaces Stage 9's text-only thumbnail concept briefs with finished thumbnail images. An image-generation model (Gemini Imagen or FLUX) produces the background/character art per the brief; programmatic text overlay (Sharp/Canvas) renders the title-overlay copy with sharp typography. The user receives three ready-to-upload thumbnail images, not just descriptions.

**Problem solved:** Concept briefs require the user to design the thumbnail in Canva/Photoshop, which most creators don't do well or quickly. Generated thumbnails close that gap and dramatically reduce time-to-publish.

## User Stories
- As a creator, I want finished thumbnail images, so I can upload them directly without designing.
- As a creator, I want sharp, editable text overlay, so the typography looks professional.
- As a creator, I want each thumbnail tied to its title angle, so the visual reinforces the psychological trigger.
- As a creator, I want to download the source PSD/Figma if I want to refine, so I'm not locked into the AI output.
- As a creator, I want to regenerate just one of the three thumbnails, so I don't have to redo all three when one is wrong.

## Functional Requirements
- Input: 3 concept briefs (Stage 9), chosen titles (Stage 5), optional channel branding assets
- Image generation pipeline per brief:
  1. Build prompt from brief composition + style cues + facial expression
  2. Call image-gen API (Gemini Imagen first, FLUX as fallback)
  3. Generated background/character at 1920×1080
  4. Overlay text rendered via Sharp/Canvas using brief's overlay copy + hex palette
  5. Composite final 1280×720 (YouTube thumbnail spec)
- Output:
  - 3 finished thumbnail PNGs at 1280×720
  - Per-thumbnail editable layer file (Figma export or layered PSD) — Phase 3 stretch
  - Generation cost tracking (per-image cost stored)
- Persist generated images to Supabase Storage; reference URLs in `thumbnails_data`
- Per-thumbnail regenerate
- User can edit overlay text inline and re-render without re-generating the background

## User Interface

### Screens
Replaces the Phase 1 thumbnail card output area. The structure of the card remains the same.

### Card layout enhancements
- 3 thumbnail image previews (1280×720 displayed at scale)
- Per-thumbnail: download button, regenerate button, edit-text button
- "Edit overlay text" opens an inline form; re-renders just the text layer
- Cost indicator: small badge showing how many image generations remain in the user's plan

### Key interactions
- Click thumbnail to view full size
- Download as PNG
- Regenerate one (preserves the other two)
- Edit text (no API call needed for text-only changes)

## States to Handle

### Happy path
Briefs complete → image gen runs in parallel → text overlay rendered → 3 final thumbnails available.

### Error states
- Image-gen API failure on one brief → retry once; if persistent, fall back to brief-only with explanation for that variant
- Image-gen returns NSFW or policy-violating content → re-prompt with sanitized inputs; if fails twice, surface error
- Quota exhausted on image-gen plan → fall back to brief-only with upgrade CTA
- Text overlay rendering fails (unusual unicode, font loading issue) → render with fallback font, flag

### Empty states
- Briefs not yet generated → "Generate thumbnail briefs first" CTA

### Loading states
- Per-thumbnail spinner; total generation 10–30s for three images
- Progressive rendering as each completes

## Edge Cases
- Brief specifies a person but no character LoRA loaded yet (Feature #24 not active) → use a generic stock-photography-style person; flag as "not your face yet"
- Brief specifies high-saturation palette but image-gen produces muted output → re-prompt with stronger palette guidance
- Generated background contains text artifacts (image gen models tend to add garbled text) → run an OCR check; if text detected in background, re-generate with explicit "no text in background" prompt
- Overlay text exceeds available space at requested font size → auto-shrink with min-size floor; warn if floor hit
- User's plan covers 5 generations/month and they regenerate 6 times → block with upgrade prompt

## Out of Scope
- LoRA character training (Feature #24, separate)
- Animated thumbnails
- A/B previews comparing generated vs. user-uploaded
- Style-transfer from existing thumbnail
- Thumbnail uploading to YouTube directly
- Brand-asset library (logos, fonts) management UI (Phase 3 stretch)
- Custom font support beyond a curated set
- Vertical thumbnails for Shorts (Feature #21 handles those separately)
