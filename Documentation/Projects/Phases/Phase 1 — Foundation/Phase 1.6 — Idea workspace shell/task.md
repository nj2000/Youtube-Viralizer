# Phase 1.6 — Idea workspace shell

**Parent:** Phase 1 — Foundation
**Status:** Not Started
**Estimated:** 8-12 hours
**Depends on:** Phase 1.2 (pipeline_runs), Phase 1.3 (orchestrator skeleton), Phase 1.4 (auth), Phase 1.5 (active channel)
**Spec:** `Documentation/Overviews and Summaries/03-idea-workspace-history/spec.md`

## Goal

The central UI shell: `pipeline_runs` lifecycle + orchestrator + Postgres `LISTEN/NOTIFY` SSE bus + the three routes (`/runs`, `/runs/new`, `/runs/[runId]`) where authenticated users drop ideas, watch the 12-stage pipeline run live, browse history, and re-run individual stages. Phase 1 ships the container; per-stage executors register no-op stubs until Phase 2 stages plug in.

## What to Build

### Step 1 — `pipeline_runs` schema integration
- Migration `0005_pipeline_runs.sql` already in Phase 1.2 with full DDL per spec #03 §3.1.
- Zod schemas in `lib/validation/run.ts`: `RunStatusSchema`, `StageNumberSchema` (`int().min(1).max(12)`), `IdeaTextSchema` (must use `z.preprocess` to trim before length check — `.transform` post-trim lets through 10-char whitespace), `CreateRunInputSchema`, `RunRowSchema` (10 stage cols `z.unknown().nullable()`, 10 `stale_*` booleans), `RunListItemSchema` with `previewAccentHex` regex `/^#[0-9a-fA-F]{6}$/`.
- `lib/db/runs.ts` — typed CRUD: `insert`, `getById`, `softDelete`, `updateStatus`, `updateStageData`, `markStaleFlags`, `list`. `list` uses `Promise.all` for rows + total + counts-by-status, with `escapeLike(q)` and trigram GIN. Service-role client requires explicit `.eq("user_id", userId)` on every read.

### Step 2 — Orchestrator skeleton + SSE bus
- `lib/services/pipeline.ts` exports `runStage(runId, stage)`, `runFullPipeline(runId)`, `runFromStage(runId, stage)` (cascade with stale-aware downstream walk).
- `lib/services/pipeline-stages.ts` — `STAGE_REGISTRY` for stages 3–12 (executors stub `throw new Error("not yet implemented")`); `DOWNSTREAM` map from spec §5.6: `3→[4..12]`, `4→[5..12]`, `5→[6..12]`, `6→[7,8,12]`, `7→[8,10,12]`, `8→[]`, `9→[11]`, `10→[]`, `11→[]`, `12→[]`.
- `lib/services/pipeline-state.ts` — 4 invariant helpers (the ONLY mutation surface): `markStageStarted(runId, stage)` (status→running, current_stage=stage, bus progress), `markStageComplete(runId, stage, data)` (write JSONB, clear own stale, flag downstream stale where non-null, recompute status, bus stage_complete), `markStageFailed(runId, stage, error)` (sanitize raw upstream body, status→error, bus run_error), `markGateFailed(runId, score, reframes)` (status→gated_failed).
- Cancellation: every stage boundary re-reads row; if `deleted_at` non-null OR `failure_reason='cancelled_by_user'`, stop. No mid-Anthropic abort.
- `lib/services/pipeline-bus.ts` — `publish(runId, msg)` via `pg_notify('run:<id>', json)`. `subscribeToRun(runId, handler)` opens **dedicated** PG connection (pool can't LISTEN), runs `LISTEN "run:<runId>"`, Zod-parses notifications. NOTIFY 8000-byte cap → publish only `{kind, payload:{stage,runId}}`; SSE proxy re-fetches row before forwarding.

### Step 3 — API layer
- `lib/services/runs.ts` — `createRun`, `listRuns`, `getRun`, `softDeleteRun`, `cancelRun`, `rerunFromStage`. Throws typed `ApiError`s. `createRun`: Zod-parse → read `profiles.active_channel_id` (409 NO_ACTIVE_CHANNEL) → quota check (403 QUOTA_EXCEEDED if `>8000`) → insert `queued` → fire-and-forget `void runFullPipeline(...).catch(...)` → return `{runId}`. 30/hr rate limit.
- `softDeleteRun`: ownership check → if running, `cancelRun` first → atomic soft-delete.
- `cancelRun`: running → `failure_reason='cancelled_by_user'`, status=error, completed_at=now; queued → immediate error; terminal → no-op.
- `rerunFromStage`: validate stage 3–12, 404 if not owned, 409 RUN_ALREADY_RUNNING if running, fire-and-forget.
- **IDOR mask:** not-yours = doesn't-exist = `404 RUN_NOT_FOUND` (never 403).
- Routes (≤150 lines each):
  - `app/api/runs/route.ts` — GET (paginated 20/page, scoped to active channel) + POST.
  - `app/api/runs/[runId]/route.ts` — GET + DELETE.
  - `app/api/runs/[runId]/cancel/route.ts` — POST (204 always).
  - `app/api/runs/[runId]/rerun-from/route.ts` — POST `?stage=<n>`.
  - `app/api/runs/[runId]/stream/route.ts` — GET SSE proxy.
- **SSE proxy** (`stream`): headers `text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`. Emit `event: snapshot` with full RunRow within 200ms. If terminal: close. Else `subscribeToRun(runId)`, re-fetch row on bus message, forward as matching SSE event. Keepalive `: keepalive\n\n` every 15s. On `req.signal.abort`: unsubscribe within 100ms.

### Step 4 — UI shell
- `lib/hooks/`: `useRun(runId)` — initial GET + EventSource open. Patches state from snapshot/progress/stage_complete/run_complete/run_gated/run_error events. `useRunsList({q, status, page})` — React-Query keyed by `[runs, {channelId,q,status,page}]`, 30s stale.
- `/runs/new` (server + `IdeaForm` client): if no active channel, render "Set up a channel first" CTA → `/onboard`. Else: textarea (rows=4, maxLength=500, char counter, helper text). Submit POST `/api/runs` → 200 push `/runs/<id>`; 409 toast + redirect `/onboard`; 403 QUOTA_EXCEEDED rose banner retaining idea text.
- `/runs` (server + `RunsList` client): header with count + "Drop new idea" + sub-header (channel name + total). Search input 300ms debounce. Filter chips "All/Complete/Running/Gated/Errored" with `counts.<status>` badges. Sort dropdown rendered but no-op (newest only). `RunRow` per spec §7.4 (thumbnail with `previewAccentHex`, status pill spec §5.8 colors, score badge or `stage X/12`, REGENERATING derived label when `status==='running' && completedAt!==null`, trash icon on hover). Pagination 20/page. Empty + no-match states. `DeleteRunModal` (Escape dismissible).
- `/runs/[runId]` (server gate + `RunView` client): `RunHeader` (idea text + status pill + score + relative timestamp + Cancel when running + Delete kebab + channel-mismatch banner when `row.channelId !== activeChannelId`), `ProgressBar` (hidden when terminal, width=`completeCount/12*100%`), 12 stacked `StageCard`s. Card variants: pending/running/complete/stale/error/gated. `StaleBanner` if any stale. `GateExplanation` reads scoreData with reframe cards. `QuotaBanner` with live UTC-midnight countdown. "Override gate" hidden unless `?dev=1`.

### Step 5 — Integration testing
- `tests/e2e/run-lifecycle.spec.ts` Playwright: stub executors return deterministic JSONB (stage 4 returns score 95 to pass gate). Sign in → drop idea → URL becomes `/runs/<uuid>` within 200ms → EventSource opens once → 12 cards transition pending→running→complete in order 3..12 → COMPLETE pill → row appears in `/runs` at index 0.
- `tests/unit/pipeline-state.spec.ts` + `tests/unit/staleness.spec.ts`: assert each state-machine helper against fixtures, assert `DOWNSTREAM[n]` matches spec §5.6 for n in 3..12 (10 assertions), never-run stages aren't stale, `markStageFailed` sanitization, static-grep test failing if `update pipeline_runs` appears outside the 2 sanctioned files.
- `tests/integration/sse-proxy.spec.ts`: 50 concurrent connections receive snapshot <500ms p95; 100 connect/disconnect cycles preserve `pg_stat_activity` baseline; 35s idle yields ≥2 keepalive frames; out-of-band `pg_notify` forwards within 250ms.
- `tests/integration/channel-cascade.spec.ts`: create channel + 3 runs, trigger Spec #01 cascade. Assert all 3 rows get `deleted_at`; SSE emits `event: run_error` with `code: "CHANNEL_DELETED"` within 1s; orchestrator stub for next stage never invoked; subsequent GET returns 404.

## Cross-feature contracts

- **Reads `profiles.active_channel_id`** from Phase 1.5. `createRun` / `listRuns` require it. Channel locked at run-start — switching active later doesn't migrate.
- **`channel_id` FK ON DELETE RESTRICT** — Spec #01 §4.6 cascade sets `channels.deleted_at` AND `pipeline_runs.deleted_at` in single transaction. Orchestrator aborts at next stage boundary when it observes `deleted_at`.
- **`youtube_quota_usage`** pre-flighted in `createRun` (403 QUOTA_EXCEEDED at >8000).
- **Auth middleware (Phase 1.4)** requires session on `app/api/runs/**`. SSE proxy re-verifies on every connect.
- **JSONB stage columns** are `z.unknown().nullable()` here. Per-stage Zod schemas live in Phase 2 stage specs.
- **`POST /api/pipeline/<stage>`** owned by each downstream spec but uses the 4 state-machine helpers exclusively. Stage executors bypassing them violate spec §4.7.

## Verification

- [ ] Migration applied with all 31 columns from spec §3.1, 4 partial indexes, 3 RLS policies (no DELETE), `pg_trgm` extension
- [ ] `IdeaTextSchema.parse("   hi   ")` throws min-length (Zod pre-trim verified); 10 chars succeeds, 501 fails
- [ ] `POST /api/runs` valid: returns `{runId}` in <500ms, row appears `status='queued'`, orchestrator transitions to `running` within 1s, terminal status within 30s (stubbed)
- [ ] `POST /api/runs`: 409 NO_ACTIVE_CHANNEL when profile null; 403 QUOTA_EXCEEDED when units_used>8000; 429 RATE_LIMITED on 31st within 1h
- [ ] `GET /api/runs?page=1` returns ≤20 sorted desc, scoped to active channel, with `counts` summing to total
- [ ] `EXPLAIN ANALYZE` with `?q=foo` at 1000+ rows uses `Bitmap Index Scan` (not Seq Scan)
- [ ] `GET /api/runs/<otherUserRunId>` returns 404 not 403; `GET /api/runs/<deletedRunId>` returns 404
- [ ] `DELETE /api/runs/<runningRunId>` cancels (sets failure_reason='cancelled_by_user', status=error, completed_at, deleted_at) atomically
- [ ] `POST /api/runs/<id>/cancel` on terminal returns 204 no-op
- [ ] `GET /api/runs/<id>/stream` first event is `snapshot` within 200ms; terminal closes after snapshot; out-of-band `pg_notify` forwards within 250ms
- [ ] Keepalive `: keepalive\n\n` frame emitted at least every 15s (verified over 35s test)
- [ ] On `EventSource.close()`, PG LISTEN connection releases within 200ms (100 cycles preserve baseline)
- [ ] Re-running stage 5 on complete run: stale flags 6/7/8/10/12 flip true, upstream stays false, own `stale_titles` cleared, status running→complete
- [ ] `markStageFailed` with raw Anthropic 500 body produces `failure_reason` matching `^stage_<n>:` and NOT containing raw body
- [ ] `markGateFailed(runId, 71, [])` sets `failure_reason = "Score 71 / 100 — below 92 threshold"` exactly
- [ ] Channel soft-delete cascade: 3 runs all get `deleted_at`; open SSE emits `event: run_error data: { code: "CHANNEL_DELETED" }` within 1s; next-stage executor not invoked
- [ ] E2E lifecycle test completes <30s with stubs
- [ ] No `any` types in `lib/db/runs.ts`, `lib/services/runs.ts`, `lib/services/pipeline*.ts`, route files; file lengths within Q-2; no raw upstream bodies leak in HTTP/SSE responses

## Out of scope

- Pipeline stage content (Specs 04–13 own executors + per-stage JSONB schemas)
- Per-stage HTTP routes `POST /api/pipeline/<stage>` (owned by each downstream spec)
- Real outlier corpus / Anthropic scoring / YouTube searches (Phase 2.1+)
- Trash bin / undelete UX (Phase 2)
- Sharing kits, PDF/Notion export, comparison view, autocomplete, direct YT upload (Phase 2+)
- Stripe paywall (Phase 2)
- Redis-backed bus (PG LISTEN/NOTIFY is sufficient for Phase 1)
- Bespoke stage renderers (each stage spec replaces generic JSON view)
