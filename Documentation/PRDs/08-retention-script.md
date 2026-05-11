# PRD — Retention-Engineered Script (Stage 7)

## Feature Name
Retention-Engineered Script

## Overview
Generates the full video script tied to a chosen title and hook, structured with rehook beats every 60–90 seconds, open-loop teases for the back half of the video, and explicit *skeleton vs. personality* markers so the creator knows which parts to keep verbatim and which to inject their own voice into.

**Problem solved:** AI-generated scripts feel synthetic and underperform because they lack retention engineering and personality slots. This stage handles the structure (where rehooks go, where loops open and close) so the creator focuses on injecting their voice in marked sections.

## User Stories
- As a creator, I want a full script that maintains retention through structural pacing, so AVD doesn't collapse mid-video.
- As a creator, I want clear markers of where to put my personality, so I know what to rewrite vs. keep.
- As a creator, I want open loops engineered into the script, so viewers stay through to payoffs.
- As a creator, I want the script to fulfill the title's promise within the first two minutes, so I don't get hit by the title-transcript drift penalty.
- As a creator, I want script length controllable, so I can target 8 minutes for ad-revenue or 15+ for deep dives.

## Functional Requirements
- Input: chosen title (one of Stage 5's 3), chosen hook (one of Stage 6's 3), idea text, niche, target length in minutes
- User must select which title + hook combo to script before this stage runs (UI gate)
- Output script structure:
  - Cold-open (uses chosen hook verbatim or with markers for personalization)
  - Title-promise delivery within first 2 minutes
  - Body sections (3–7 depending on length)
  - Rehook beat marker every 60–90s of estimated speak time
  - At least 2 open loops opened in first half, closed in second half
  - Outro with a soft CTA (no hostage-negotiation patterns)
- Section markers: `[SKELETON]` (keep verbatim) vs. `[PERSONALITY]` (inject your voice here, with a one-line prompt)
- Estimated total runtime in minutes
- Persist `script_data` to `pipeline_runs` row including segmented sections, markers, rehook positions, and open-loop pairs

## User Interface

### Screens
Renders as a card within `/runs/[runId]`. Largest card by visual weight.

### Pre-run interaction
- Title + Hook selector: user picks one of 3 titles + matching hook before clicking "Generate script"
- Target length slider: 5, 8, 10, 12, 15, 20 min options

### Card layout (after generation)
- Header: "Retention Script" + estimated runtime + "Regenerate" + "Re-pick title/hook"
- Script displayed in segmented sections, each with section header
- `[SKELETON]` blocks in default text color; `[PERSONALITY]` blocks in distinct accent color with the inline prompt
- Rehook beats marked with a small icon and timestamp (e.g., "⚡ Rehook · ~1:30")
- Open-loop pairs visually linked (e.g., "🪝 Loop opens" → "🎯 Loop closes" with matching numbers)
- Copy-full-script button at the top
- Toggle: "Plain text" view (hides markers for export)

### Key interactions
- Select title/hook then generate
- Toggle plain-text view for export
- Copy script in markdown or plain text
- Click a personality block to expand its inline prompt

## States to Handle

### Happy path
User selects title+hook → script generates → segments rendered with markers → user reviews.

### Error states
- Stages 5 or 6 missing → error: "Script requires titles and hooks. Re-run earlier stages."
- LLM upstream error or timeout → retry per CLAUDE.md EXT-3; long stage so timeout >60s is normal
- LLM returns script without rehook markers → re-prompt with stricter format instruction
- Script length far off target (e.g., 5min target → 12min output) → flag in UI; user can regenerate with different target
- Script delivers title promise after the 2-minute mark → flag for Stage 8 drift check to catch

### Empty states
- Not applicable.

### Loading states
- Card shows progress spinner with sub-text: "Outlining sections…", "Engineering retention beats…", "Writing body…", "Closing loops…" (these are approximate; LLM may stream the whole thing)
- Streaming partial output as the LLM generates is preferred for UX

## Edge Cases
- Title contains a specific number/result that the script must fulfill → script's title-promise delivery must reference the specific
- Topic is highly technical and the user's audience is beginner → personality blocks include "explain this for beginners" prompts
- Channel voice is highly informal → skeleton blocks lean conversational; personality blocks expect humor injection
- User picks a title-hook mismatch (e.g., title 1 + hook 3) → allowed but warn that coherence may suffer
- Target length is short (5 min) and topic requires depth → script may compress; flag if compression sacrifices the title promise
- User regenerates the script multiple times → each regen is a fresh draft; do not accumulate revisions
- Generated script accidentally includes anti-patterns → caught by Stage 8 lint, not this stage
- Open-loop close gets cut by the LLM partway → re-prompt; if persistent, surface as warning

## Out of Scope
- Scripting visuals, b-roll, or shot lists
- Generating timestamps for chapters (handled in Stage 10 SEO metadata)
- Multi-host or dialogue-format scripts
- Translating scripts
- Generating Shorts scripts (separate flow in #21)
- Voice cloning, audio synthesis
- AVD prediction (Phase 2)
- Personality calibration (e.g., "make it sound more like me with 5 sample videos") — Phase 2
