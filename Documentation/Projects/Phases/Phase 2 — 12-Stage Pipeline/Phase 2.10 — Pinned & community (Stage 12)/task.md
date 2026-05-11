# Phase 2.10 — Pinned + community drafts (Stage 12)

**Parent:** Phase 2 — 12-Stage Pipeline
**Status:** Not Started
**Estimated:** 4-6 hours
**Depends on:** Phase 2.3 (locked title), Phase 2.5 (script_data)
**Spec:** `Documentation/Overviews and Summaries/13-pinned-community-drafts/spec.md`

## Goal

Haiku 4.5 generates 4 engagement artifacts in a single structured call: pinned comment (bait engagement, references specific video moment), community pre-publish teaser (≤500 chars, anticipation 1-2 days before drop), community post-publish hype (same day, drive initial views), suggested reply templates (3-5 keyword→reply patterns). This is the FINAL pipeline stage — on completion `pipeline_runs.status = 'complete'`. Bundle markdown export at the end.

## What to Build

### Step 1 — Data layer
- `lib/validation/engagement.ts`: `PinnedCommentSchema`, `CommunityPostSchema` (pre/post variants ≤500 chars each), `SuggestedReplyTemplateSchema = {keyword, replyTemplate}`. `EngagementDraftsSchema = {pinnedComment, communityPostPrePublish, communityPostPostPublish, suggestedReplyTemplates: [3..5], generatedAt, schemaVersion: 1}`.
- `lib/db/engagement.ts`: typed CRUD with atomic status transition + jsonb_set partial-update for two-step regenerate flow.

### Step 2 — Service + prompt
- `lib/prompts/engagement.ts`: Haiku 4.5 system prompt with `cache_control`. Attribution `// Synthesized from claude-youtube/sub-skills/repurpose.md (MIT — Daniel Agrici)`.
- `lib/services/engagement.ts`: single structured Haiku call returns JSON with all 4 artifacts (1 call cheaper than 4; SSE progress events come from server-side parsing checkpoints). Lint loop: scan output against Stage 8 forbidden phrases, retry up to 3 times, then `LINT_RETRIES_EXHAUSTED` with manual-edit escape hatch.
- Two-step regenerate: `/regenerate` streams a preview WITHOUT persisting; `/commit` writes after user confirms "Use new".
- Markdown bundle assembler: ordered H2 sections for all 12 stages + MIT footer.

### Step 3 — API endpoints
- `POST /api/pipeline/engagement { runId }` SSE — auto-triggered after Stage 11 (or whichever stages complete last).
- `POST /api/pipeline/engagement/regenerate { runId, draftType: 'pinned'|'pre'|'post'|'replies' }` SSE — preview only, no persist.
- `POST /api/pipeline/engagement/commit { runId, draftType, content }` — targeted partial overwrite via `jsonb_set`.
- `GET /api/runs/[runId]/export?format=markdown` — assembles all 12 stage outputs into a single markdown doc with H2 headers in stage order + MIT footer. Returns 400 RUN_INCOMPLETE if any stage data null.
- On stage completion: `markStageComplete` transitions `pipeline_runs.status = 'complete'` and `completed_at = now()`. Bus emits `kit_ready` event for `/runs/[runId]` subscriber.

### Step 4 — UI
- YouTube-style preview cards mimicking the actual interface:
  - PinnedComment: channel avatar monogram + username + relative timestamp + body + like/reply count placeholders.
  - CommunityPost (pre + post variants): similar styling.
  - SuggestedRepliesPanel: keyword → reply template pairs in expandable list.
- Per-draft: copy / regenerate (preview side-by-side) / edit-inline-textarea / commit.
- Edit-inline path: textarea opens for manual edit → `/commit` persists.
- **Ship-it final celebratory state** when `pipeline_runs.status='complete'`: `<ShipItHero>` with confetti illustration + `<DeliverablesChecklist>` (12 deliverables ✓) + "Download bundle" CTA.

### Step 5 — Integration & testing
- After this stage completes, `pipeline_runs.status === 'complete'` (verified at row read).
- Bus emits `kit_ready` event to `/runs/[runId]` SSE subscriber.
- GET `/api/runs/[runId]/export` returns markdown with H2 headers for each of the 12 stages + MIT footer.
- Regenerate /commit overwrites ONLY the targeted draftType, leaving the other 3 unchanged (deep-diff).
- Lint loop exits with `LINT_RETRIES_EXHAUSTED` after 3 attempts; manual edit textarea unblocks.
- 409 STAGE_IN_PROGRESS on concurrent same-runId calls.
- Suggested reply templates promoted from PRD-deferred to MVP per task brief — flag in §10 as first-cut item if ship pressure.

## Cross-feature contracts

- Reads all stage outputs (titles, hook, script, lint, thumbnails, seo, ab_plan).
- Writes `pipeline_runs.engagement_drafts_data` — terminal stage, not consumed by other pipeline stages.
- Transitions `pipeline_runs.status` to `'complete'`.
- Feature #22 (cross-platform repurposing) reads the locked outputs to generate derivative content.

## Verification

- [ ] After Stage 12 completes, `pipeline_runs.status === 'complete'` (DB read)
- [ ] `kit_ready` bus event emitted; SSE subscriber receives matching event
- [ ] `GET /api/runs/[runId]/export?format=markdown` returns markdown with 12 H2 headers in stage order + MIT footer
- [ ] Export returns 400 RUN_INCOMPLETE if any stage data is null
- [ ] `/regenerate` streams preview but does NOT mutate `engagement_drafts_data`
- [ ] `/commit { draftType: 'pinned' }` overwrites only `engagement_drafts_data.pinnedComment`; leaves other 3 fields byte-identical
- [ ] Lint retry loop max 3 attempts; 4th failure returns `LINT_RETRIES_EXHAUSTED`
- [ ] Concurrent POST returns 409 STAGE_IN_PROGRESS
- [ ] Suggested reply templates: 3-5 entries per schema
- [ ] Pinned comment + community pre/post each ≤500 chars
- [ ] System prompt has `cache_control`; 2nd call shows cache hit
- [ ] CRIT-2: `claude-haiku-4-5-20251001` literal
- [ ] CRIT-4 attribution: synthesized from repurpose.md

## Out of scope

- Direct posting to YouTube (no YouTube write API)
- Multi-tab broadcast on run completion
- Channel avatar fetching for preview cards (monogram placeholder Phase 1)
- Bundle export beyond markdown (JSON/PDF/zip deferred to Phase 2)
- Auto-cascade re-runs of Stage 12 when upstream changes (manual re-trigger only Phase 1)
- Real voice scoring (placeholder badge Phase 1; Feature #19 ships scoring)
