# PRD — Niche Vocabulary Library

## Feature Name
Niche Vocabulary Library

## Overview
A per-niche corpus of intent-specific phrases extracted from outlier titles, descriptions, and chapter labels. Surfaced during Stage 5 (title generation) and Stage 10 (SEO metadata) to help the LLM produce language that matches the niche's specific audience-cluster vocabulary instead of generic phrasing.

**Problem solved:** "Mobile video editing for beginners using free apps" outperforms "How to edit video" because YouTube's NLP matches it to a more specific cluster. The library captures these high-converting phrases per niche so they're available to every generation.

## User Stories
- As a creator, I want my generated titles to use my niche's actual vocabulary, not generic phrasing.
- As a creator, I want the system to learn what works in my niche over time, so generations improve.
- As a product owner, I want a per-niche library that grows with the outlier corpus, so quality improves without manual curation.

## Functional Requirements
- Built on top of Feature #14's outlier corpus
- For each niche, extract:
  - Top-N high-frequency phrases that appear in outlier titles but not in non-outlier titles (lift-based extraction)
  - Top-N intent-specific phrases (compound noun phrases longer than 3 words)
  - Top-N audience-cluster signals (e.g., "for beginners," "in 2026," "no code")
- Refresh weekly via cron
- Store in `niche_vocabulary` table keyed by niche
- Inject relevant vocabulary into Stage 5 and Stage 10 prompts as a soft constraint
- Track usage: which library phrases produced which scores; feed back into ranking

## User Interface

### Screens
Mostly invisible to users — operates as a backend signal. One small enhancement:

### Stage 5 card enhancement
- Optional toggle: "Show vocabulary used"
- When enabled, surfaces 3–5 phrases from the library that influenced this generation, with brief explanation

### Admin view (internal)
- `/admin/vocabulary` (gated) showing per-niche library, sample phrases, last refresh timestamp

## States to Handle

### Happy path
Library populated → Stage 5/10 prompts incorporate vocabulary → titles reflect niche-specific language.

### Error states
- Niche has no library yet → fall back to no-vocab path; flag for next cron run
- Cron failure → use stale library; surface in admin

### Empty states
- Channel niche is novel and not yet covered → fallback path with explanation in admin

### Loading states
- Not user-visible; backend operation.

## Edge Cases
- Library extracts phrases that are stylistically dated → time-decay weights so recent outliers dominate
- Library extracts phrases that are competitor-specific (channel signature catchphrases) → filter against single-channel-source phrases
- User explicitly wants generic / brand-neutral language → opt-out toggle on the channel settings
- Niche overlaps multiple sub-niches → prefer the most-specific match, fall back to broader
- Library suggests phrasing that conflicts with channel voice → channel voice samples take precedence

## Out of Scope
- User-curated vocabulary (Phase 3 candidate)
- Multi-language vocabulary
- Selling or exposing the library directly as a product feature
- Real-time phrase trending (handled by corpus refresh cadence)
- Cross-niche vocabulary sharing
