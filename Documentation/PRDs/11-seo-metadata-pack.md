# PRD — SEO Metadata Pack (Stage 10)

## Feature Name
SEO Metadata Pack

## Overview
Generates a copy-paste-ready upload package: video description, tag list, chapter timestamps, end-screen recommendations. Optimized for YouTube's 2026 NLP-based intent matching, not legacy keyword stuffing.

**Problem solved:** Creators waste 30+ minutes per upload writing descriptions and figuring out chapters, often resulting in keyword vomit that hurts rather than helps. This stage produces metadata that matches the script's actual content and the title's intent cluster.

## User Stories
- As a creator, I want a description ready to paste into YouTube Studio, so I don't compose it from scratch each upload.
- As a creator, I want chapter timestamps based on my actual script, so chapters are accurate not invented.
- As a creator, I want tags that match audience-cluster intent, so YouTube recommends my video to the right viewers.
- As a creator, I want end-screen recommendations that boost session time, so my channel benefits beyond a single video.
- As a creator, I want everything in a single copy block, so I'm not chasing data across screens.

## Functional Requirements
- Input: chosen title (Stage 5), script (Stage 7), niche, channel context
- Output:
  - Description: 200–500 words, structured as: hook line (echoes title promise), body (summary + section anchors), CTA, link block, hashtags (3–5)
  - Chapter timestamps: derived from script section breaks; min 4 chapters; first chapter is "Intro" at 0:00
  - Tags: 10–15 tags, each ≤ 30 chars, intent-specific phrases preferred over single keywords
  - End-screen recommendations: 2 placement suggestions with reasoning ("link to your most-watched related video," "subscribe-for-similar")
  - Pinned-comment placeholder: pulled from Stage 13 if available, else marked TBD
- Persist `seo_data` to `pipeline_runs` row
- Output formatted for one-click copy as either plain text or YouTube-ready text with line breaks

## User Interface

### Screens
Renders as a card within `/runs/[runId]`.

### Card layout
- Header: "SEO Pack" + status + "Regenerate"
- Tabs or sections for: Description, Chapters, Tags, End Screens
- Each section has its own copy button
- "Copy entire pack" master button at the top
- Character count indicators (description max 5000 chars)

### Key interactions
- Per-section copy
- Master copy of the entire pack
- Tags shown as chips, click to copy individual tag

## States to Handle

### Happy path
Stage runs → all four components generated → rendered with copy buttons.

### Error states
- Script (Stage 7) missing → error: "SEO requires a script. Re-run Stage 7."
- Title missing → error
- Description over 5000 chars → truncate at section boundary, flag
- Tags exceed YouTube's 500-char total tag limit → trim least-relevant tags, flag
- Chapters fewer than 4 derived from script → fall back to fixed 4-chapter structure (intro, problem, solution, conclusion)

### Empty states
- Not applicable.

### Loading states
- Card shows spinner with text "Building SEO pack…"

## Edge Cases
- Script is shorter than 5 minutes → chapters reduced to 3 with explanation
- Script contains affiliate links or sponsor mentions → description includes disclosure language
- Niche requires specific compliance language (finance, medical) → description includes a disclaimer flag for user review
- Tags suggested overlap heavily with channel's prior tags → diverse tag policy: at most 50% overlap with most-recent video
- Hashtags conflict with description's body keywords → hashtags use audience-cluster phrasing
- Channel has no prior video for end-screen recommendation → default to subscribe-only end screen with explanation
- Generated description leaks anti-patterns (CTA-heavy or keyword-stuffed) → Stage 8 lint catches it but description uses a stricter prompt to avoid

## Out of Scope
- Auto-publishing to YouTube via API
- Localized descriptions in multiple languages
- Translating tags
- A/B testing description variants
- Pulling and matching channel-existing tag library (Phase 2 niche vocabulary)
- Schema markup beyond what YouTube already generates
- Cards (mid-video) — Phase 2
