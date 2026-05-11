# PRD — Hybrid Scoring Engine

## Feature Name
Hybrid Scoring Engine

## Overview
Replaces Stage 4's LLM-only scoring with empirically grounded scoring. A nightly job builds a corpus of real YouTube outliers across niches; new ideas are embedded, matched against similar historical outliers in the same niche, and scored relative to those outliers' empirical base rates. This is the **product's defensibility unlock** — without it, the app is a thin LLM wrapper.

**Problem solved:** LLM-only scoring is opinion-shaped. Two creators with identical ideas get different scores depending on prompt instability. Hybrid scoring grounds every score in real outlier patterns, making it consistent, defensible, and demonstrably calibrated.

## User Stories
- As a creator, I want my idea scored against real videos that recently broke out, so the score reflects what's actually working now.
- As a creator, I want to see the historical outliers my idea is being compared to, so I trust the score.
- As a creator, I want score consistency — the same idea on a different day shouldn't fluctuate wildly, so I can trust the gate.
- As a product owner, I want the scoring engine to improve over time as the corpus grows, so accuracy compounds.

## Functional Requirements
- Nightly cron job populates an `outlier_corpus` table:
  - Discovers outliers across a defined set of niches (initially 20 most-popular creator niches)
  - Per outlier: title, niche, channel, view count, multiple, embedding, hook pattern, length bucket, publish date, view velocity
  - Embeddings via Anthropic's embedding endpoint or comparable
  - Corpus retains last 180 days; older entries archived
- Scoring path:
  - Embed the user's idea text + chosen channel niche
  - Retrieve top-20 nearest outliers in matching niche from corpus
  - Compute empirical base rate: what fraction of similar-pattern ideas became 5×+ outliers in the corpus window
  - LLM weights/composes the final score using base rate as primary signal + idea-specific factors as secondary
- Score result includes:
  - Final score (0–100)
  - Base rate from matched outliers (e.g., "63% of 18 similar-pattern ideas hit 5× outlier in last 90 days")
  - Top 3 reference outliers shown to the user (title, channel, view multiple)
- Replaces Stage 4 LLM-only path; same `score_data` schema, just additional fields
- Falls back to LLM-only if corpus has <5 matches in the niche

## User Interface

### Screens
Affects Stage 4 score card in `/runs/[runId]`. Adds a "Reference outliers" sub-section.

### Card layout enhancements (over Phase 1 score card)
- Base-rate badge: "63% base rate from 18 similar outliers"
- "Reference outliers" expandable section showing 3 closest historical matches with title, channel, multiple, and YouTube link

### Settings/admin (internal)
- A small admin view (gated, internal-only in Phase 2) showing corpus size per niche, last cron run, calibration drift

## States to Handle

### Happy path
Idea embedded → ≥5 matches in corpus → hybrid score computed → reference outliers shown.

### Error states
- Embedding API fails → fall back to LLM-only with banner explaining
- Corpus query times out → fall back to LLM-only
- Cron failed to run for >48h → flag in admin view; still serve stale corpus

### Empty states
- Niche has fewer than 5 outliers in corpus → score with LLM-only path; UI labels "Limited reference data"
- Corpus is empty (initial state or after wipe) → all scoring falls back to LLM-only

### Loading states
- Same spinner as Stage 4; sub-text changes to "Matching against N outliers in your niche…"

## Edge Cases
- User's niche is highly novel or non-standard (no corpus coverage) → fall back to closest adjacent niche with explicit note
- Corpus contains an outlier that's actually inflated (livestream, accidental viral) → outlier-detection cron must filter these before storage
- Embedding model deprecated → migration plan to re-embed corpus
- Score consistency check: same idea twice should produce same matched outliers and ±2 point variance (vs. ±3 for LLM-only)
- Idea is in English but niche has dominant non-English content → score against English-only matches; flag low corpus coverage
- Multi-niche idea (e.g., AI + fitness) → embed against both niches; weighted blend

## Out of Scope
- Per-user personalization of scoring (Feature #17 calibration)
- Real-time outlier detection (corpus is nightly)
- Surfacing outlier corpus directly to users for browsing (it's a backend signal, not a UI feature in v1)
- Niche vocabulary library (Feature #18 — separate feature using same corpus)
- Trend-prediction (which niches are heating up) — Phase 3 idea
- Multi-language outlier corpus
