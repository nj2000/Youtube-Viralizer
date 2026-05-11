# PRD — Idea Workspace + History

## Feature Name
Idea Workspace + History

## Overview
The primary working surface of the app. Users drop a video idea, watch the 12-stage pipeline run with streaming progress, view all generated outputs, re-run individual stages, and browse every kit they've ever generated. Every kit is persisted; nothing is one-shot disposable.

**Problem solved:** Creators currently lose generated AI outputs across browser sessions and chat windows. They re-prompt, re-iterate, lose track of which version they liked. The workspace makes every kit a first-class persisted artifact that can be revisited, refined, or compared.

## User Stories
- As a creator, I want to drop a video idea and immediately see the pipeline working, so I trust something is happening rather than staring at a blank screen.
- As a creator, I want each stage of the pipeline to render its result as soon as it's done, so I can read titles before the script finishes.
- As a creator, I want to re-run a single stage (e.g., regenerate titles) without re-running the whole pipeline, so I don't waste time or money.
- As a creator, I want to see all my past kits in a list, so I can return to the best one when I'm ready to film.
- As a creator, I want to delete kits I'll never use, so my list stays focused.
- As a creator, I want each kit to show its idea text, virality score, and timestamp at a glance, so I can scan history quickly.

## Functional Requirements
- New-idea form: idea text input (multi-line, 10–500 chars), active-channel context shown above the form, "Run pipeline" button
- Submitting kicks off the pipeline orchestrator; user is routed to `/runs/[runId]` immediately
- Run view streams stage events via SSE; each stage card transitions through `pending → running → complete | error | gated`
- Each stage card displays its output inline once complete, with a "Regenerate" button
- Re-running a single stage shows a streaming indicator on just that card; outputs from later stages remain (but are flagged as potentially stale)
- "Re-run from here" option re-runs the clicked stage and all downstream stages
- Stage outputs are persisted to `pipeline_runs` row; refreshing the page shows the same state
- History list at `/runs` shows: idea text (truncated), virality score (with gate pass/fail), created date, last-modified date, status (running, complete, gated, error)
- History list supports search by idea text and filter by status
- Deleting a run removes the row and all associated outputs (hard delete in v1)
- All run data is scoped to the current user's active channel; switching channels switches the visible history

## User Interface

### Screens
1. **`/runs/new`** — idea input form with active-channel context shown above and a "Run pipeline" CTA.
2. **`/runs/[runId]`** — live run view with 12 stage cards stacked vertically. Each card has stage name, status indicator, output area, regenerate/re-run-from-here controls.
3. **`/runs`** — history list with search input, status filter chips, and a row per past run.

### Key interactions
- Submitting an idea routes to `/runs/[runId]` while pipeline starts streaming
- Stage cards expand to show outputs as soon as `complete` event arrives
- "Regenerate" button on a stage card replaces its output with a fresh stream
- "Re-run from here" prompts confirm before invalidating downstream outputs
- History rows are clickable to view the run; row hover reveals delete affordance

## States to Handle

### Happy path
User drops idea → routed to run view → stages stream complete one by one → all 12 stages green → user reviews kit → kit appears in history.

### Error states
- Idea text too short or too long → inline form validation
- Pipeline fails on a stage → stage card shows error message + "Retry stage" button; downstream stages remain pending
- YouTube quota exceeded mid-pipeline → relevant stage shows quota error; user can resume tomorrow
- LLM upstream error (Anthropic 5xx) → automatic retry per CLAUDE.md EXT-3; if all retries fail, stage marked error with manual retry
- Stage 5 (score) returns below-threshold score → kit is **gated**, not errored; later stages do not run; gate explanation rendered with reframe suggestions
- Network drops during SSE stream → client reconnects and resumes from server state on reload
- User deletes a run → hard delete; cannot be undone (warn before delete)

### Empty states
- New user with no runs → `/runs` shows "Drop your first idea" CTA pointing to `/runs/new`
- Search/filter returns no matches → "No runs match these filters"
- Pipeline still running → all stage cards show pending/running indicators in order

### Loading states
- Pipeline starting → first stage card shows running spinner
- Stage running → spinner inside that card; subsequent cards show pending
- Regeneration → that card's output area shows running spinner; old output is replaced when complete

## Edge Cases
- User refreshes during a running pipeline → reload shows current server-side state; running stages continue server-side and resume streaming via SSE on reconnect
- User opens the same run in two browser tabs → both tabs receive the same stream, last-write wins on regenerate
- User regenerates stage 5 (titles) but downstream stages already completed → mark downstream stages as "stale" with subtle indicator; user can choose to re-run them or keep
- User submits an idea while a previous run is still in progress → allow; pipelines are independent
- User has 100+ runs → history list paginates at 25 per page
- User switches active channel mid-pipeline → current run keeps its original channel context; new runs use the new channel
- User's session expires mid-pipeline → pipeline continues server-side; user re-authenticates and sees the result on return
- Idea text contains prompt-injection attempts → treated as plain content; stage prompts are sandboxed (handled in stage PRDs, but workspace shouldn't crash on weird input)

## Out of Scope
- Sharing kits with other users or via public link
- Exporting kits to PDF / Notion / Google Docs
- Commenting or collaboration on a kit
- Versioning history within a single run (each regenerate replaces the prior output; no diff view)
- Comparing two runs side-by-side
- Soft-delete / trash bin
- Idea suggestions or autocomplete (Phase 2 — niche vocabulary library does this)
- Direct upload to YouTube from the kit (Phase 2+)
