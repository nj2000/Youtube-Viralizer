# Spec — Feature #03: Idea Workspace + History

> **Status:** Approved · **Phase:** 1 · **Tier:** 1 (User Foundation) · **Build Order:** §1.3
> **Source PRD:** `Documentation/PRDs/03-idea-workspace-history.md`
> **Mockup:** `Documentation/Mockups/03-idea-workspace-history.html`

This spec is the engineering contract. It supersedes the PRD on any conflict. Code is built from this document.

This is the **central UI shell** of the app. It owns the `pipeline_runs` table — the canonical source of truth for every kit a user generates. Specs 04–13 (the 12 pipeline stages) read inputs from and write outputs to this table; this spec defines the table, the lifecycle, the routes that wrap it, and the UI surface that renders it.

---

## 1. Overview

A three-screen UI shell — *list, new, single-run* — that lets the authenticated user:

- Drop a video idea (10–500 chars) against the current active channel.
- Watch the 12-stage pipeline run with live SSE streaming.
- See per-stage outputs render inline as they complete.
- Re-run a single stage, or re-run from a stage downward.
- Browse, search, filter, and delete every run they've ever generated.

The result is persisted as one row in the `pipeline_runs` table per submitted idea. That row carries the entire kit: status, current stage, timestamps, and one JSONB column per pipeline stage. Specs 04–13 own the **content** of those JSONB columns; this spec owns the **container**.

**Why it matters:** Without a persisted run record, every pipeline call is a one-shot transient request. Refreshing the page loses progress. Per-stage re-runs are impossible (CLAUDE.md A-2 forbids in-memory pipeline state). The history list cannot exist. This is the foundation that every Tier 2 stage UI plugs into; per Build Order §1.3 it must ship before any pipeline stage UI lands.

---

## 2. User Stories

Phase 1 covers the following stories from the PRD:

- As a creator, I drop a video idea and immediately see the pipeline working, so I trust something is happening rather than staring at a blank screen.
- As a creator, each stage of the pipeline renders its result as soon as it's done, so I can read titles before the script finishes.
- As a creator, I re-run a single stage (e.g., regenerate titles) without re-running the whole pipeline, so I don't waste time or money.
- As a creator, I see all my past kits in a list, so I can return to the best one when I'm ready to film.
- As a creator, I delete kits I'll never use, so my list stays focused.
- As a creator, each kit shows its idea text, virality score, and timestamp at a glance, so I can scan history quickly.
- As a creator, my run survives a page reload — refreshing during a running pipeline shows the current server-side state.
- As a creator on a gated run, I see *why* it gated and concrete reframe suggestions inline.

**Out of scope for this spec (deferred to other specs / phases):** sharing kits, exporting to PDF / Notion / Google Docs, commenting, versioning within a single run, comparing two runs side-by-side, soft-delete trash bin (this spec uses a `deleted_at` column for forward-compat but the public delete API hard-deletes from the user's perspective — see §5.4), idea autocomplete (Feature #18 — niche vocabulary), direct YouTube upload.

---

## 3. Data Model

### 3.1 `pipeline_runs` table (Postgres / Supabase)

This is the canonical DDL. All migrations downstream of this spec must match it exactly. Build Order §0.4 names the columns; this section defines their types, constraints, and defaults.

```sql
-- Status enum: queued → running → (complete | gated_failed | error)
-- gated_failed is reachable only from `running` when stage 4 (idea score) returns < 92.
create type public.pipeline_run_status as enum (
  'queued',
  'running',
  'gated_failed',
  'complete',
  'error'
);

create table public.pipeline_runs (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  channel_id               uuid not null references public.channels(id) on delete restrict,

  -- The idea text the user submitted. 10–500 chars enforced at DB and Zod layers.
  idea_text                text not null
                           check (char_length(idea_text) between 10 and 500),

  -- Lifecycle.
  status                   public.pipeline_run_status not null default 'queued',
  current_stage            integer
                           check (current_stage is null or current_stage between 1 and 12),

  -- Reason a run is in 'error' or 'gated_failed' state. Free-text, server-set, never user-supplied.
  -- For gated_failed: short summary like "Score 71 / 100 — below 92 threshold".
  -- For error: the failed stage number + sanitized cause.
  failure_reason           text,

  -- One JSONB column per pipeline stage output. Each is null until the stage completes.
  -- Schemas for each are defined in specs 04–13. This spec only defines the columns.
  competitor_data          jsonb,    -- stage 3 output (spec 04)
  score_data               jsonb,    -- stage 4 output (spec 05)
  titles_data              jsonb,    -- stage 5 output (spec 06)
  hook_data                jsonb,    -- stage 6 output (spec 07)
  script_data              jsonb,    -- stage 7 output (spec 08)
  lint_data                jsonb,    -- stage 8 output (spec 09)
  thumbnails_data          jsonb,    -- stage 9 output (spec 10)
  seo_data                 jsonb,    -- stage 10 output (spec 11)
  ab_plan_data             jsonb,    -- stage 11 output (spec 12)
  engagement_drafts_data   jsonb,    -- stage 12 output (spec 13)

  -- Per-stage staleness flags. Set to true when an upstream stage is re-run after this stage
  -- completed. Cleared back to false when this stage itself is re-run. UI renders an amber
  -- "STALE" badge on cards where the corresponding flag is true. See §5.6 for invalidation rules.
  -- Stage 1 (channel context) and 2 (idea normalize) are implicit / not user-stages, so no flags.
  stale_competitor         boolean not null default false,
  stale_score              boolean not null default false,
  stale_titles             boolean not null default false,
  stale_hook               boolean not null default false,
  stale_script             boolean not null default false,
  stale_lint               boolean not null default false,
  stale_thumbnails         boolean not null default false,
  stale_seo                boolean not null default false,
  stale_ab_plan            boolean not null default false,
  stale_engagement_drafts  boolean not null default false,

  -- Timestamps.
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  completed_at             timestamptz,                -- set when status moves to complete | gated_failed | error
  deleted_at               timestamptz                  -- soft-delete (admin-only restore; users see hard-delete UX)
);

-- Keep updated_at fresh on every row mutation.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger pipeline_runs_set_updated_at
  before update on public.pipeline_runs
  for each row execute function public.set_updated_at();

-- Indexes.
-- Primary list query: user's runs for a given channel, newest first, excluding deleted.
create index pipeline_runs_user_channel_created_idx
  on public.pipeline_runs (user_id, channel_id, created_at desc)
  where deleted_at is null;

-- Status filter chips on /runs.
create index pipeline_runs_user_status_idx
  on public.pipeline_runs (user_id, status, created_at desc)
  where deleted_at is null;

-- Idea-text search (ILIKE). Postgres trigram for sub-string matching.
create extension if not exists pg_trgm;
create index pipeline_runs_idea_text_trgm
  on public.pipeline_runs using gin (idea_text gin_trgm_ops)
  where deleted_at is null;

-- Cascade query for channel deletion (spec #01 §4.6 hits this).
create index pipeline_runs_channel_id_idx
  on public.pipeline_runs (channel_id) where deleted_at is null;

-- Row-level security (CLAUDE.md SEC-2).
alter table public.pipeline_runs enable row level security;

create policy "pipeline_runs_select_own" on public.pipeline_runs
  for select using (auth.uid() = user_id and deleted_at is null);

create policy "pipeline_runs_insert_own" on public.pipeline_runs
  for insert with check (auth.uid() = user_id);

create policy "pipeline_runs_update_own" on public.pipeline_runs
  for update using (auth.uid() = user_id);

-- Hard delete is admin-only (no policy). Users go through the API route which sets deleted_at.
-- This intentionally leaves DELETE without a USING policy so authenticated client direct-deletes fail.
```

**Why `on delete restrict` on `channel_id`:** spec #01 §4.6 cascades a channel soft-delete to its runs by setting `pipeline_runs.deleted_at = now()` in the same transaction. We want the FK to *prevent* an accidental hard channel delete from orphaning rows — the soft-delete cascade is the supported path.

**Why a `deleted_at` column on a hard-delete-from-user-perspective product:** see §5.4. Short version — we set `deleted_at` rather than `delete from`. The user UX is "permanent, no undo, no trash bin" but the row stays for 30 days for incident-recovery. Admin tooling does the actual physical purge. This is forward-compat with a Phase 2 trash bin without DDL changes.

### 3.2 Status state machine

Allowed transitions (anything else is a bug):

```
created                  → queued
queued                   → running
running                  → complete         (all 12 stages succeeded)
running                  → gated_failed     (stage 4 score < 92)
running                  → error            (any stage failed terminally after retries)
gated_failed | complete  → running          (user re-runs a stage; row stays, status flips back)
error                    → running          (user retries the failed stage; row stays, status flips back)
any non-running          → (deleted)        (deleted_at set)
```

A re-run *transitions through* `running` and back to `complete | gated_failed | error` when the stage finishes. `current_stage` reflects the stage currently executing during `running` and the **last completed stage** when not running. For `gated_failed` it is always `4`.

A row is never re-inserted on a re-run — the same `id` survives the entire lifecycle of an idea. The history list represents one row per idea.

### 3.3 Typed JSON schemas (Zod)

Located in `lib/validation/run.ts`. The per-stage JSONB schemas live with their owning specs (`lib/validation/competitor.ts`, `lib/validation/score.ts`, etc.); this spec only types the **shell**.

```typescript
import { z } from "zod";

export const RunStatusSchema = z.enum([
  "queued",
  "running",
  "gated_failed",
  "complete",
  "error",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const StageNumberSchema = z.number().int().min(1).max(12);
export type StageNumber = z.infer<typeof StageNumberSchema>;

// Idea text — used by POST /api/runs.
export const IdeaTextSchema = z
  .string()
  .min(10, "Add at least 10 characters so we have something to work with.")
  .max(500, "Trim to 500 characters or fewer.")
  .transform((s) => s.trim());

export const CreateRunInputSchema = z.object({
  ideaText: IdeaTextSchema,
});

export const RunRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  channelId: z.string().uuid(),
  ideaText: z.string(),
  status: RunStatusSchema,
  currentStage: StageNumberSchema.nullable(),
  failureReason: z.string().nullable(),

  competitorData: z.unknown().nullable(),
  scoreData: z.unknown().nullable(),
  titlesData: z.unknown().nullable(),
  hookData: z.unknown().nullable(),
  scriptData: z.unknown().nullable(),
  lintData: z.unknown().nullable(),
  thumbnailsData: z.unknown().nullable(),
  seoData: z.unknown().nullable(),
  abPlanData: z.unknown().nullable(),
  engagementDraftsData: z.unknown().nullable(),

  stale: z.object({
    competitor: z.boolean(),
    score: z.boolean(),
    titles: z.boolean(),
    hook: z.boolean(),
    script: z.boolean(),
    lint: z.boolean(),
    thumbnails: z.boolean(),
    seo: z.boolean(),
    abPlan: z.boolean(),
    engagementDrafts: z.boolean(),
  }),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export type RunRow = z.infer<typeof RunRowSchema>;

// List endpoint payload.
export const RunListItemSchema = z.object({
  id: z.string().uuid(),
  ideaText: z.string(),                 // truncated client-side, full text on row
  status: RunStatusSchema,
  currentStage: StageNumberSchema.nullable(),
  scoreValue: z.number().int().min(0).max(100).nullable(),  // pulled from score_data.value if present
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  // Lightweight thumb-strip preview: top title from titles_data and the first thumbnail's
  // primary palette hex if available. Both null until those stages complete. Pure decoration —
  // never load-bearing. Keeping these in the list payload avoids per-row hydration.
  previewTitle: z.string().nullable(),
  previewAccentHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
});
export type RunListItem = z.infer<typeof RunListItemSchema>;
```

**Read-side enforcement:** `lib/db/runs.ts` parses every row read through `RunRowSchema` before returning to callers. JSONB stage columns are typed as `z.unknown().nullable()` here — the per-stage specs narrow them at consumption time. A parse failure on the shell throws `INTERNAL_ERROR` and is logged; never returned raw to clients (CLAUDE.md API-2).

**snake_case → camelCase boundary (CLAUDE.md API-1):** `lib/db/runs.ts` is the single transform point. DB columns are snake_case; everything above the DB layer is camelCase. No callers should ever see `idea_text`.

### 3.4 Constraints & invariants

- Every `pipeline_runs` row has a non-null `channel_id` that references a non-deleted `channels` row at insert time. After insert, channel soft-delete cascades into the run (sets the run's `deleted_at` too — see spec #01 §4.6).
- `idea_text` is 10–500 chars at three layers: Zod (`IdeaTextSchema`), DB check, and trim at the Zod layer (so 500 trailing spaces don't sneak through).
- `current_stage` may only be null when `status = 'queued'`. For all other statuses it's 1–12.
- `completed_at` is null while `status = 'queued' | 'running'`, non-null otherwise.
- `failure_reason` is null when `status in ('queued', 'running', 'complete')`, non-null otherwise.
- A user has **no hard cap** on number of runs in Phase 1. Pagination handles scale; quotas (CRIT-1, CRIT-2) bound cost.
- Concurrent runs against the same channel are allowed. Each is independent.
- The same `(user_id, channel_id, idea_text)` tuple is **not** uniquified — users may legitimately submit the same idea twice (e.g., to compare regenerated outputs at different times).

---

## 4. API Endpoints

All routes are under `app/api/`. All require an authenticated session — middleware on the `(app)` route group rejects unauthenticated requests with `401 { code: "UNAUTHENTICATED" }`.

Field naming follows CLAUDE.md API-1: snake_case in DB and external APIs, camelCase in TypeScript code. Zod schemas perform the transform.

Per CLAUDE.md A-1 (three-layer architecture), every route in this section is thin: parse, call `lib/services/runs.ts`, shape response. Business logic lives in the service layer; DB access lives in `lib/db/runs.ts`. The orchestrator (Build Order §0.8) is invoked from the service layer, never the route.

### 4.1 `POST /api/runs` — create a new run

**Auth:** required.

**Request body:**
```typescript
{ ideaText: string }   // 10–500 chars (post-trim)
```

The endpoint **does not** accept a `channelId` field. The active channel is read from `profiles.active_channel_id` at server time (the active channel is locked at run-start; subsequent channel switches do not affect this run — see §6.1).

**Response (200):**
```typescript
{ runId: string }
```

The orchestrator is kicked off **after** the response is returned. The frontend immediately routes to `/runs/[runId]` and opens the SSE stream (§4.6) which connects to the in-progress orchestrator.

**Errors:**
- `400 { code: "VALIDATION_FAILED", details: { fieldErrors: { ideaText: string[] } } }` — too short, too long, empty, non-string.
- `409 { code: "NO_ACTIVE_CHANNEL" }` — user has no `profiles.active_channel_id` set. Frontend redirects to `/onboard`.
- `403 { code: "QUOTA_EXCEEDED" }` — `youtube_quota_usage` for today already > 8000 units. The orchestrator's stage 3 will fail without YouTube access; we refuse upfront rather than start a doomed run. (CLAUDE.md CRIT-1, EXT-2.)
- `500 { code: "INTERNAL_ERROR" }` — anything else.

**Service layer (TS sketch — `lib/services/runs.ts`):**

```typescript
import { CreateRunInputSchema } from "@/lib/validation/run";
import { ApiError } from "@/lib/errors";
import { runs as runsDb } from "@/lib/db/runs";
import { profiles as profilesDb } from "@/lib/db/profiles";
import { quota as quotaDb } from "@/lib/youtube/quota";
import { runFullPipeline } from "@/lib/services/pipeline";   // Build Order §0.8

export async function createRun(userId: string, body: unknown): Promise<{ runId: string }> {
  const { ideaText } = CreateRunInputSchema.parse(body);

  const profile = await profilesDb.getById(userId);
  if (!profile?.activeChannelId) {
    throw new ApiError(409, "NO_ACTIVE_CHANNEL");
  }

  // Pre-flight: refuse to start a run if YouTube quota is already over the soft cap.
  // Stage 3 will need quota; better to fail fast here than queue a doomed run.
  const usage = await quotaDb.getTodayUsage();
  if (usage > 8000) {
    throw new ApiError(403, "QUOTA_EXCEEDED");
  }

  // Insert row in `queued` state. The active channel is locked here.
  const row = await runsDb.insert({
    userId,
    channelId: profile.activeChannelId,
    ideaText,
    status: "queued",
    currentStage: null,
  });

  // Fire-and-forget orchestrator. We do NOT await it — the route returns immediately so the
  // client can navigate to /runs/[runId] and connect to the SSE stream. The orchestrator writes
  // its progress to the DB via `runs.updateStage` and broadcasts via the SSE proxy (§4.6).
  // Errors from the orchestrator are caught inside it and persisted as status='error' on the row.
  void runFullPipeline({ runId: row.id }).catch((err) => {
    // Defense-in-depth: if the orchestrator throws synchronously (it shouldn't), the row stays
    // in `queued` forever without this catch. The orchestrator's own error path is the primary
    // guarantee.
    console.error("orchestrator threw before persisting", { runId: row.id, err });
  });

  return { runId: row.id };
}
```

**Note:** the orchestrator is responsible for transitioning `queued → running` and emitting the first SSE event. The route's job is done after the row is inserted.

### 4.2 `GET /api/runs` — list runs (paginated)

**Auth:** required.

**Query params:**
- `q?: string` — idea-text search (trigram ILIKE against `idea_text`). Max 200 chars.
- `status?: "queued" | "running" | "complete" | "gated_failed" | "error"` — single value; chip selection.
- `page?: number` — 1-indexed. Default 1. Max 1000 (DoS guard).
- `pageSize?: number` — fixed at 20 in Phase 1; the param is reserved for future, ignored if sent.

Results are scoped to the **current `profiles.active_channel_id`**. Switching the active channel switches the visible history — by design (PRD: "all run data is scoped to the current user's active channel; switching channels switches the visible history").

**Response (200):**
```typescript
{
  runs: RunListItem[],
  page: number,
  pageSize: number,
  total: number,
  counts: {                       // for the filter chips, computed once per request
    all: number,
    complete: number,
    running: number,
    queued: number,
    gated_failed: number,
    error: number
  }
}
```

`RunListItem` is defined in §3.3.

**Sort:** newest first (`created_at desc`). The mockup shows a "Sort: Newest" dropdown but in Phase 1 it's a no-op visual; only newest-first ships.

**Errors:**
- `400 { code: "VALIDATION_FAILED" }` — invalid query params.
- `409 { code: "NO_ACTIVE_CHANNEL" }` — user has no active channel; frontend handles by redirecting to `/onboard` (or showing the first-time empty state if they have no channels at all).

### 4.3 `GET /api/runs/[runId]` — fetch a single run

**Auth:** required.

**Response (200):** `RunRowSchema` (§3.3).

The full row includes every JSONB stage column. The client uses this to hydrate the `/runs/[runId]` view on initial render and on reload (the stream-resume case).

**Errors:**
- `404 { code: "RUN_NOT_FOUND" }` — row doesn't exist OR is soft-deleted OR belongs to another user. RLS makes the third case look identical to the first; we don't leak existence (CLAUDE.md SEC + spec #01 §9).

### 4.4 `DELETE /api/runs/[runId]` — soft-delete

**Auth:** required.

**Behavior:**
1. Set `deleted_at = now()` on the row (RLS update policy enforces ownership).
2. If the run is currently `running`, emit a `cancellation` signal to the orchestrator (see §4.5 — this endpoint internally calls the same cancel path before soft-deleting). The user-facing UX is "delete," not "cancel + delete," but technically we cancel the pipeline first.
3. Return `204 No Content`.

The user perception is hard-delete (the row vanishes from the list immediately, the modal in mockup State 12 says "permanently deleted… can't be undone"). The `deleted_at` timestamp is for ops/admin recovery only and is not exposed via any user-facing API.

A periodic admin job (Phase 2 / cron, not in this spec) physically purges rows older than 30 days where `deleted_at is not null`.

**Errors:**
- `404 { code: "RUN_NOT_FOUND" }` — same semantics as §4.3.

### 4.5 `POST /api/runs/[runId]/cancel` — cancel a running run

**Auth:** required.

**Behavior:**
- If `status = 'running'`: signal the orchestrator to stop, set `status = 'error'`, set `failure_reason = 'cancelled_by_user'`, set `completed_at = now()`. Any in-flight stage finishes its current Anthropic/YouTube call (we don't abort mid-call — the cost is already paid; better to persist the result if the call succeeds). Subsequent stages are not started.
- If `status = 'queued'`: immediate transition to `'error'` with the same `failure_reason`.
- If `status` is anything else (`complete | gated_failed | error`): no-op, return `204`.

**Cancellation mechanism:** the orchestrator (§0.8) checks a `cancelled` flag on the run row at every stage boundary. This route flips the flag and the next boundary check halts execution. Phase 1 does not implement mid-stage cancellation — that requires plumbing AbortController through `lib/anthropic/` and is out of scope.

**Response:** `204 No Content`.

**Errors:**
- `404 { code: "RUN_NOT_FOUND" }`.

### 4.6 `GET /api/runs/[runId]/stream` — SSE live view (passthrough)

**Auth:** required.

**Response:** `text/event-stream`.

This is the SSE **proxy** for the live run view. It is the only SSE endpoint owned by this spec — every per-stage SSE endpoint (`POST /api/pipeline/<stage>`, see §4.7) lives in specs 04–13.

**Behavior:**
1. Read the run row. If it's `complete | gated_failed | error`, emit one synthetic `snapshot` event with the full `RunRow` and close. (No "live" stream needed.)
2. If it's `queued | running`, subscribe to the orchestrator's broadcast channel for that `runId` and forward every `progress` and `complete` event from any stage. When the orchestrator transitions the run to a terminal state, emit a final `run_complete | run_gated | run_error` event and close.
3. If the client disconnects, the orchestrator keeps running. On reconnect (page refresh), step 1 happens again — the client snapshots and resumes.

**Event schema:**

```
event: snapshot
data: <RunRow>          // emitted once on connect; client uses this to hydrate

event: progress
data: { "stage": <1-12>, "message": "...", "tokensSoFar": 1420, "tokensTotalEstimate": 3800 }

event: stage_complete
data: { "stage": <1-12>, "row": <RunRow> }   // row reflects post-stage state

event: run_complete
data: { "row": <RunRow> }

event: run_gated
data: { "row": <RunRow>, "scoreData": { "value": 71, "reframes": [...] } }

event: run_error
data: { "row": <RunRow>, "stage": <1-12>, "code": "UPSTREAM_ERROR" | "QUOTA_EXCEEDED" | ... }
```

**No raw upstream errors** are emitted (CLAUDE.md API-2). The orchestrator translates Anthropic 5xx, YouTube quota, etc. into the codes above.

**Broadcast channel implementation:** the orchestrator publishes to a per-run Postgres `LISTEN/NOTIFY` channel named `run:<runId>`. The proxy `LISTEN`s on it. We use Postgres rather than Redis to avoid a new dependency in Phase 1; the throughput is well under what `LISTEN/NOTIFY` handles.

**Proxy route sketch (`app/api/runs/[runId]/stream/route.ts`):**

```typescript
import { auth } from "@/lib/auth";
import { runs as runsDb } from "@/lib/db/runs";
import { subscribeToRun } from "@/lib/services/pipeline-bus";   // wraps LISTEN/NOTIFY
import { ApiError } from "@/lib/errors";

export async function GET(
  req: Request,
  { params }: { params: { runId: string } },
) {
  const userId = await auth.requireUser(req);
  const row = await runsDb.getById(params.runId, { userId });
  if (!row) throw new ApiError(404, "RUN_NOT_FOUND");

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      // 1. Always snapshot first so the client has a complete picture.
      send("snapshot", row);

      // 2. If the run is already terminal, close immediately.
      if (row.status === "complete" || row.status === "gated_failed" || row.status === "error") {
        controller.close();
        return;
      }

      // 3. Subscribe to the orchestrator bus for in-progress runs. Forward every event.
      // The bus handles its own keep-alives via comment frames every 15s to defeat proxies.
      const unsubscribe = await subscribeToRun(params.runId, (msg) => {
        // msg.kind ∈ "progress" | "stage_complete" | "run_complete" | "run_gated" | "run_error"
        send(msg.kind, msg.payload);
        if (
          msg.kind === "run_complete" ||
          msg.kind === "run_gated" ||
          msg.kind === "run_error"
        ) {
          controller.close();
        }
      });

      // 4. If client aborts, drop the subscription. Orchestrator keeps running server-side.
      req.signal.addEventListener("abort", () => {
        unsubscribe();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",        // disable nginx/proxy buffering
    },
  });
}
```

### 4.7 Per-stage re-run endpoints — contract only

The 12 per-stage endpoints `POST /api/pipeline/<stage>` are **owned by specs 04–13**. This spec only locks the contract per CLAUDE.md API-3:

**Request body (every stage):**
```typescript
{ runId: string }
```

The stage's inputs (channel context, prior stage outputs) are read from the `pipeline_runs` row by the stage service. No other input crosses the API boundary — preventing the bug where a re-run uses a different version of the input than the original run.

**Response:** `text/event-stream` with `progress` and `complete` events per CLAUDE.md TS-2. The `complete` event's payload is the stage's JSONB output. The stage service is responsible for writing that output to the run row's corresponding JSONB column **before** emitting `complete`, so a downstream re-fetch of the run row reflects the new state.

**Side effects this spec mandates on every stage:**
1. On stage start: set `status = 'running'`, `current_stage = <stage>`. Notify the run bus.
2. On stage success: write the JSONB output, clear that stage's `stale_*` flag, set the downstream stages' `stale_*` flags to true (see §5.6 invalidation rules), notify the run bus, and check whether all 12 stages are non-null → if so, set `status = 'complete'`, `completed_at = now()`. Otherwise leave `status = 'running'` (full-pipeline run continues to next stage) or set `status` back to whatever it was (per-stage re-run on an otherwise-complete run; see §5.5 for the special case where a re-run on a complete run keeps it `complete` immediately after the stage succeeds, with downstream stages flagged stale).
3. On stage failure (after retries per CLAUDE.md EXT-3): set `status = 'error'`, `current_stage = <stage>`, `failure_reason = "stage_<n>:<sanitized>"`, `completed_at = now()`. Notify the run bus.
4. On gate failure (stage 4 only): set `status = 'gated_failed'`, `current_stage = 4`, `completed_at = now()`. Notify the run bus.

These are **invariants** every stage must honor. They are encoded in helpers in `lib/services/pipeline.ts` (Build Order §0.8) — stages call those helpers, not the DB directly, so the invariants can't drift.

### 4.8 Active-channel scoping summary

Every endpoint in §4.1–§4.6 honors the active-channel scoping rule:

| Endpoint | Active-channel behavior |
|---|---|
| `POST /api/runs` | Reads `profiles.active_channel_id` at request time; persists it on the row. Subsequent active-channel switches do not affect this run. |
| `GET /api/runs` | Filters by `channel_id = profiles.active_channel_id` at request time. |
| `GET /api/runs/[runId]` | No filter — RLS handles ownership. The single-run view shows the run regardless of active channel (so a deep link works). |
| `DELETE /api/runs/[runId]` | Same as above. |
| `POST /api/runs/[runId]/cancel` | Same. |
| `GET /api/runs/[runId]/stream` | Same. |
| `POST /api/pipeline/<stage>` | Same — stages read the run's `channel_id` from the row, not from the active channel. |

This avoids the bug where switching active channels mid-run breaks the in-progress pipeline.

---

## 5. Business Logic

### 5.1 Run-creation flow

End-to-end on submit of `/runs/new`:

1. Client calls `POST /api/runs` with `{ ideaText }`.
2. Server validates idea text (Zod), reads `profiles.active_channel_id`, pre-flights YouTube quota, inserts a `pipeline_runs` row in `queued`, kicks off `runFullPipeline({ runId })` without awaiting.
3. Server returns `{ runId }` (typically <100ms).
4. Client navigates to `/runs/[runId]`.
5. Page render fetches the row via `GET /api/runs/[runId]` (might be `queued` or `running`).
6. Client opens `GET /api/runs/[runId]/stream`. First event: `snapshot`. Subsequent events: `progress`, `stage_complete`, etc.
7. Orchestrator runs stages 1 → 12, writing each output to the row and notifying the bus.
8. On completion (or gate / error), the stream emits the terminal event and closes. The page re-fetches the row to ensure its UI matches DB state (defense in depth — bus + DB should already agree).

**Why immediate redirect after step 3 (rather than wait for stage 1 to start streaming on `/runs/new`):** the user experience is "click and see something happening." A blocked button on `/runs/new` for even 2s feels worse than a redirect to a page that says "Queued · starts in ~1s." The mockup State 3 is the destination.

**Idempotency on rapid double-click of "Run pipeline":** the button is disabled the moment the request is in-flight and re-enabled only on error. A second submission while the first is pending is dropped client-side. Server-side, two requests would create two distinct rows (no uniqueness constraint on `idea_text` per §3.4); we don't dedupe at the server because the client-side guard is sufficient and dedup heuristics here cause more bugs than they prevent.

### 5.2 Idea-text validation

Per §3.3:

```typescript
export const IdeaTextSchema = z
  .string()
  .min(10, "Add at least 10 characters so we have something to work with.")
  .max(500, "Trim to 500 characters or fewer.")
  .transform((s) => s.trim());
```

The `.transform(trim)` runs *before* `.min/.max` semantics? **No** — Zod runs `transform` after parse + refine. We need trim *first* so `"   hi   "` (3 chars after trim) fails min, not passes. Since transform is post-validation in Zod, we use a custom preprocessor:

```typescript
export const IdeaTextSchema = z.preprocess(
  (val) => (typeof val === "string" ? val.trim() : val),
  z.string()
    .min(10, "Add at least 10 characters so we have something to work with.")
    .max(500, "Trim to 500 characters or fewer."),
);
```

Client mirrors the same rules for inline validation (mockup State 2). The form's "Run pipeline" button is disabled while the post-trim length is outside `[10, 500]`.

**Plain-text only.** No markdown, HTML, or rich text. The textarea is `<textarea maxLength="500">` plus client-side trim. We do not strip control characters server-side — Postgres `text` accepts them; the per-stage prompts treat the idea as untrusted (see §9 prompt-injection defense).

### 5.3 List query (search + filter)

`lib/db/runs.ts#list`:

```typescript
async function list({
  userId,
  channelId,
  q,
  status,
  page,
}: {
  userId: string;
  channelId: string;
  q?: string;
  status?: RunStatus;
  page: number;
}): Promise<{ rows: RunListItem[]; total: number; counts: Counts }> {
  const offset = (page - 1) * 20;

  // Trigram search uses the GIN index from §3.1 when q is non-empty.
  const where = sql`
    user_id = ${userId}
    and channel_id = ${channelId}
    and deleted_at is null
    ${q ? sql`and idea_text ilike ${"%" + escapeLike(q) + "%"}` : sql``}
    ${status ? sql`and status = ${status}` : sql``}
  `;

  const [rows, total, counts] = await Promise.all([
    db.query(sql`
      select
        id, idea_text, status, current_stage,
        (score_data->>'value')::int as score_value,
        (titles_data->'candidates'->0->>'text') as preview_title,
        (thumbnails_data->'briefs'->0->>'accentHex') as preview_accent_hex,
        created_at, completed_at
      from pipeline_runs
      where ${where}
      order by created_at desc
      limit 20 offset ${offset}
    `),
    db.queryOne(sql`select count(*)::int as n from pipeline_runs where ${where}`),
    countsByStatus(userId, channelId),
  ]);

  return { rows: rows.map(toRunListItem), total: total.n, counts };
}
```

The `countsByStatus` helper runs a single grouped query (`select status, count(*) from … group by status`) to populate the filter chips' badges (`COMPLETE · 28`, etc.) without N+1.

**Search performance:** `pg_trgm` GIN gives sub-100ms latency for the substring search at the row counts we expect in Phase 1 (Phase 1 ceiling per the PRD: "User has 100+ runs → history list paginates at 25 per page" — note: PRD says 25, MVP defaults locked to 20; this spec overrides to 20 per the task's explicit instruction). At 10k rows we revisit (Phase 2).

### 5.4 Soft-delete with hard-delete UX

The user-facing flow:
1. User clicks the trash icon on a row hover (mockup State 9 row 2).
2. Confirmation modal (mockup State 12): "Delete this run? … This can't be undone — there's no trash bin in v1."
3. On confirm, client calls `DELETE /api/runs/[runId]`.
4. Server sets `deleted_at = now()` (atomic with cancel-if-running).
5. Server returns `204`.
6. Client optimistically removes the row from the list. (No rollback — failure is so rare that we tolerate the reload-fixes-it case.)

**Why not actually `DELETE FROM`?**
- 30-day undelete window for incident response (e.g., user emails support after rage-deleting a kit they wanted).
- Foreign-key audit trails — if Phase 2 adds telemetry that references a runId, the row needs to physically exist for joins to work even after user-deletion.
- Cheaper to preserve than to reconstruct. Disk is cheap; user trust is not.

A daily admin cron (out of scope for this spec) physically purges rows where `deleted_at < now() - interval '30 days'`. Until that cron exists, rows accumulate — fine at Phase 1 scale.

### 5.5 Re-run a single stage (existing complete run)

Sequence when a user clicks "Regenerate" on stage 5 of a complete run (mockup State 4 → State 7):

1. Client calls `POST /api/pipeline/titles` with `{ runId }`.
2. The titles service (spec 06) sets `status = 'running'`, `current_stage = 5`, clears `stale_titles`. (Note: the run was `complete`; status temporarily becomes `running`.)
3. The service computes the new titles via Anthropic.
4. The service writes `titles_data` and **sets `stale_hook = stale_script = stale_lint = stale_thumbnails = stale_seo = stale_ab_plan = stale_engagement_drafts = true`** per §5.6 (downstream stages 6–12 are now stale).
5. The service decides the new status. Logic:
   - If every stage column 1–12 is non-null → status returns to `'complete'` (the run's outputs are stale on some stages but they exist).
   - If any are null (which can't happen on a complete run, but covers the case where this re-run was on a partially-running pipeline) → status remains `'running'` if other stages are still running, or `'error'` if any other stage is errored.
6. The service notifies the run bus → stream forwards to the page → the page renders the new titles AND the amber STALE pill on stages 6–12 (mockup State 7).

Crucially, the row stays at the same `id`. The history list's row doesn't disappear or re-appear; it just updates `updated_at`.

### 5.6 Stage staleness invalidation rules

When stage *N* succeeds, every stage downstream of *N* that was previously complete is marked stale. The DAG (matches Build Order §2 dependencies):

```
1 (channel ctx)  →  2 (idea normalize)  →  3 (competitor outliers)
                                              ↓
                                          4 (score + gate)
                                              ↓
                                          5 (titles)
                          ┌───────────┬───────┼──────────┬──────────┐
                          ↓           ↓       ↓          ↓          ↓
                       6 (hook)   7 (script)  9 (thumbs) 10 (SEO)  11 (A/B test plan)
                                      ↓           │          │
                                  8 (lint)        │          │
                                      ↓           │          │
                                                  └──────┬───┘
                                                         ↓
                                                   12 (pinned/community)
```

Rule, applied automatically inside the `lib/services/pipeline.ts` helper that every stage calls on success:

```typescript
const DOWNSTREAM: Record<StageNumber, StageNumber[]> = {
  3: [4, 5, 6, 7, 8, 9, 10, 11, 12],
  4: [5, 6, 7, 8, 9, 10, 11, 12],
  5: [6, 7, 8, 9, 10, 11, 12],
  6: [7, 8, 12],
  7: [8, 10, 12],
  8: [],                           // lint has no downstream consumers
  9: [11],                         // thumbnails feed A/B plan
  10: [],
  11: [],
  12: [],
  // stages 1, 2 are implicit and not user-runnable
};
```

`stage_complete` setter:
- Set the stage's own `stale_*` flag to `false`.
- Set `stale_*` to `true` for every stage in `DOWNSTREAM[stage]` whose data column is non-null. (Stages that were never run aren't "stale" — they're just not run yet; the UI distinguishes pending vs. stale.)

**UI consequence:** the page renders three states for a stage card — `pending` (grey, never run), `complete` (green check), and `stale` (amber pill, mockup State 7). When the user clicks "Re-run from here" the orchestrator runs the clicked stage and every stage in `DOWNSTREAM[stage]` whose `stale_*` is true.

### 5.7 "Re-run from here" cascade

User clicks the chevron on stage 5 of a stale run. Client calls a synthetic endpoint:

`POST /api/runs/[runId]/rerun-from?stage=5`

(This is NOT a per-stage endpoint — it's owned by this spec because it operates on the run as a whole.)

**Auth:** required.

**Request body:** none. **Query param:** `stage` ∈ 1..12.

**Behavior:**
1. Validate that `stage` is one the user can re-run — currently 3, 4, 5, 6, 7, 8, 9, 10, 11, 12. Stage 1 (channel context) and 2 (idea normalize) are implicit.
2. The service kicks off a partial-pipeline run starting at `stage`, walking forward through `DOWNSTREAM[stage]` plus the stage itself, in dependency order.
3. Returns `{ runId }` immediately (same fire-and-forget pattern as §4.1). The page is already on `/runs/[runId]`; it picks up the resulting `progress` events via the SSE proxy.

**Response (200):** `{ runId: string }`

**Errors:**
- `400 { code: "VALIDATION_FAILED" }` — bad stage param.
- `404 { code: "RUN_NOT_FOUND" }`.
- `409 { code: "RUN_ALREADY_RUNNING" }` — the run's status is currently `running`. The user must wait or cancel before re-running.

### 5.8 Status badge color mapping

The mockups use these colors consistently. Tailwind classes are noted for the implementation:

| Status | Pill text | Tailwind colors | Chip classes (filter) |
|---|---|---|---|
| `queued` | "QUEUED" | text-ink-300 / bg-white/5 / ring-white/10 | neutral |
| `running` | "RUNNING" + pulse-dot | text-blue-400 / bg-blue-500/10 / ring-blue-500/20 | blue |
| `complete` | "COMPLETE" + check icon | text-yt-400 / bg-yt-600/15 / ring-yt-600/30 | YT red |
| `gated_failed` | "FAILED-GATE" | text-amber-400 / bg-amber-500/10 / ring-amber-500/20 | amber |
| `error` | "ERROR" | text-rose-400 / bg-rose-500/10 / ring-rose-500/20 | rose |

The "REGENERATING" pill seen in mockup State 9 row 8 is not a status — it's a derived label rendered when the row's `status = 'running'` AND it had a previous terminal status (i.e., this is a re-run, not the initial pipeline). The client computes it from `(status === 'running') && (completed_at !== null)`.

---

## 6. State Management

### 6.1 Server state

Authoritative for: every column of `pipeline_runs`. The DB is the source of truth; the bus is for low-latency updates only.

**Channel-context lock at run-start:** the `channel_id` written at `POST /api/runs` is fixed. If the user switches active channels mid-run, the in-progress run's outputs are still computed against the original channel — not the new one. (See §7 edge case "User switches active channel mid-pipeline.") This matches PRD: "current run keeps its original channel context; new runs use the new channel."

**No additional server-side caching.** The run row is read fresh on every API call. Postgres + RLS is fast enough that adding a Redis layer here is premature.

### 6.2 Client state

The `/runs/[runId]` page holds the current `RunRow` in component state. The SSE stream's events update it:
- `snapshot` → replace
- `progress` → patch `currentStage` + a transient progress message
- `stage_complete` → patch the corresponding `*Data` column and `stale.*` flags
- `run_complete | run_gated | run_error` → patch `status`, `failureReason`, `completedAt`; close stream

The `/runs` list page caches its result per `(channelId, q, status, page)` tuple in a React-Query (or SWR) cache. The cache is invalidated:
- After `POST /api/runs` succeeds (a new row exists).
- After `DELETE /api/runs/[runId]` succeeds (a row is gone).
- After 30s of staleness (background refetch), so a running run's status updates without a manual refresh.

Cross-tab synchronization is **not** in Phase 1. If a user opens the same run in two tabs, both tabs run their own SSE stream (the orchestrator is single-source; each tab's stream is a separate proxy connection). PRD: "both tabs receive the same stream, last-write wins on regenerate" — confirmed; the row is the source of truth and overwrite-on-write is fine for Phase 1.

### 6.3 Optimistic updates

- **Delete:** row is removed from the list immediately on confirm. On the rare failure path (network drop), a toast appears and the next list refetch repopulates the row. The user might briefly think it's gone; this is acceptable for a destructive but reversible-by-the-cron operation.
- **Cancel:** status flips to `error` in the UI immediately on click; if the server returns 409 (already terminal), the UI rolls back.
- **Re-run:** no optimistic state — the server's `stage_complete` event is what flips the card from "regenerating" back to "complete." The button transitions to a disabled spinner while waiting.

### 6.4 Reconnection and backpressure

- Browser auto-reconnects EventSource on transport drops. On reconnect the proxy issues a fresh `snapshot` so the client never loses sync.
- The orchestrator publishes events at most ~10/sec per run (one per token-window during Opus streaming). This is well under SSE/HTTP/1.1 limits; no special backpressure handling.
- Idle keepalive: the proxy sends a `: keepalive\n\n` comment frame every 15 seconds. Many proxies (nginx, Cloudflare) drop quiet streams at 30–60s; comment frames defeat that.

---

## 7. UI/UX Behavior

### 7.1 Routes

| Route | Auth | Purpose |
|---|---|---|
| `/runs` | required | History list. Mockup States 9 (mixed), 10 (empty), 11 (no-match), 12 (delete modal). |
| `/runs/new` | required | Idea drop form. Mockup States 1 (happy), 2 (validation error). Redirects to `/onboard` if the user has no channels. |
| `/runs/[runId]` | required | Single-run view. Mockup States 3 (running), 4 (complete), 5 (gated), 6 (error), 7 (regenerate + stale), 8 (quota). |

### 7.2 `/runs/new` — idea form

Per mockup State 1:
- Active-channel context card (avatar, title, niche, sub count) at top — read-only with a "Switch" link to the channel switcher.
- Idea textarea: `rows=4`, `maxLength=500`, placeholder `"e.g. How I built a $10k SaaS in 30 days using Claude Code as my only developer"`.
- Char counter (`132 / 500`) — red when invalid (mockup State 2).
- Helper text: `10–500 characters · plain text, no formatting`.
- "Run pipeline" CTA — disabled until idea text is valid; primary YT-red button.
- "Typical run takes 60–90s" microcopy left of the CTA.

On submit:
1. Disable button, show spinner.
2. POST `/api/runs`.
3. On success: client-side route to `/runs/[runId]`. (No need to refetch the run — the next page does that.)
4. On failure: re-enable button, render error inline above the form. Retain the idea text so the user can fix and retry.

**No-active-channel guard:** on page mount, the page reads the user's active channel from React context (set by `ChannelContextProvider` per spec #01 §6.2). If null → render the redirect-to-onboard CTA instead of the form. The 409 from `POST /api/runs` is the server-side defense if the context is stale.

### 7.3 `/runs/[runId]` — live + history view

The same component handles both the live and historical cases. It always:
1. Fetches the row via `GET /api/runs/[runId]` on mount.
2. Opens an SSE connection to `/api/runs/[runId]/stream`.
3. Renders 12 stage cards stacked, plus a header with idea text, status pill, score (if scored), and timestamp.

**Stage card variants** (per the mockup, deduped from States 3, 4, 6, 7):

- **Pending:** grey background, opacity-50, stage number in a circle, label, "pending" or "waiting on stage N" microcopy.
- **Running:** blue ring + pulse, spinner, "generating…" microcopy, optional token-progress text from `progress` events ("1,420 / ~3,800 tokens"), inline excerpt for stages with streamable output (script: live transcript with caret).
- **Complete:** green-checked, output rendered inline (titles list, hook blockquote, etc.), "Regenerate" link, optional "Re-run from here" chevron.
- **Stale:** amber border, output still rendered but dimmed, amber "STALE" pill, microcopy "references old title A" or similar.
- **Error:** rose border, "Retry stage N" button, "View error log" link to a modal with the sanitized `failure_reason`.
- **Gated (stage 4 only):** amber, score badge, reframe suggestions list, "Use this angle and re-run" / "Edit my own idea" / "Override gate" buttons (override gate is a Phase 1 dev affordance — see §10).

**Top-of-page status pill:** mirrors the run's status with the colors from §5.8.

**Progress bar:** thin gradient bar showing `complete_count / 12`. Visible during `running`; hidden once terminal.

### 7.4 `/runs` — history list

Per mockup State 9:

- Header: "Runs" + "47 runs total" + "Drop new idea" CTA.
- Search input (placeholder `"Search idea text…"`) + filter chips (All, Complete, Running, Gated, Errored) + sort dropdown (Phase 1: Newest only).
- Run rows. Each row:
  - Thumbnail-style preview (gradient + first thumbnail accent if the run has stage 9 output, otherwise a status icon).
  - Status pill + score (or "stage 7 / 12 · 47s" for running).
  - Idea text (truncated at one line).
  - Timestamp + run ID.
  - Hover-revealed delete affordance (trash icon, top-right of row).
  - Action affordances per status: "Reframe →" for gated, "Retry stage N →" for errored.
- Pagination: page size 20 (NOT the PRD's "25"). Pager: `← Prev`, `1`, `2`, `Next →`.
- Empty state (mockup 10): dashed-border card with the "Drop your first idea" CTA.
- No-match state (mockup 11): icon + "No runs match these filters" + "Clear filters" / "Drop new idea" buttons.

**Active-channel scoping label:** below "Runs" header — "Every kit you've generated for **{activeChannelTitle}** · {N} runs total." Matches the rule that history is per-active-channel.

### 7.5 Per-stage actions

| Action | Trigger | Endpoint |
|---|---|---|
| Regenerate this stage | Card "Regenerate" link | `POST /api/pipeline/<stage>` (spec 04–13) |
| Re-run from here | Card chevron / page header | `POST /api/runs/[runId]/rerun-from?stage=<n>` (this spec §5.7) |
| Retry errored stage | Error card "Retry" CTA | `POST /api/pipeline/<stage>` |
| Cancel running run | Top-of-page "Cancel" | `POST /api/runs/[runId]/cancel` |
| Delete run | Row hover / detail page kebab | `DELETE /api/runs/[runId]` |

### 7.6 Error UX

| Code (server) | Where surfaced | UI behavior |
|---|---|---|
| `VALIDATION_FAILED` (idea text) | `/runs/new` | Inline rose border on textarea, error text above char counter, button disabled. |
| `NO_ACTIVE_CHANNEL` | `/runs/new` (server returns 409) | Toast "No active channel — set one up first" + redirect to `/onboard`. |
| `QUOTA_EXCEEDED` | `/runs/new` (server returns 403) **and** mid-pipeline (mockup State 8) | Form: rose banner. Mid-pipeline: full quota card with reset countdown. |
| `RUN_NOT_FOUND` | `/runs/[runId]` | 404 page with "Back to runs" link. |
| `RUN_ALREADY_RUNNING` | "Re-run from here" on a running run | Toast "This run is still in progress — wait or cancel first." |
| `UPSTREAM_ERROR` | Stage card on `/runs/[runId]` (mockup State 6) | Rose stage card, "Retry stage N" CTA. |
| Network drop during SSE | Top-of-page banner | "Reconnecting…" — auto-recovers via EventSource auto-reconnect. |
| Tab closes mid-stream | n/a | Server orchestrator keeps running. On return, the page snapshots and resumes. |

### 7.7 Channel switcher

Owned by spec #01 §7.5 — re-used here. The header dropdown is present on every `(app)` route including `/runs`, `/runs/new`, `/runs/[runId]`.

When the user switches:
- `/runs` re-fetches with the new active channel (history list refreshes).
- `/runs/[runId]` does **not** redirect or refetch — the run keeps its locked channel context. A subtle banner appears: "Viewing a run on **Merlin AI** while your active channel is **Side Project**."
- `/runs/new` re-renders the active-channel context card. If the form had unsaved idea text, it's preserved.

### 7.8 Delete confirmation modal

Per mockup State 12:
- Modal centered, dim+blur backdrop.
- Rose trash icon + "Delete this run?" headline.
- Body: "{ideaText}" and all 12 stage outputs (titles, hook, script, thumbnails, SEO, A/B plan) will be permanently deleted.
- Rose subtext: "This can't be undone — there's no trash bin in v1."
- Cancel (ghost) + "Delete permanently" (rose primary) buttons.

The modal is dismissed on Escape, backdrop click, or Cancel. Confirm calls `DELETE /api/runs/[runId]`, optimistically removes the row, closes the modal. On error: toast + reopen the modal to show the failure.

---

## 8. Edge Cases

| Case | Behavior |
|---|---|
| User submits idea with only whitespace ("        ") | Pre-trim + Zod min(10) → `VALIDATION_FAILED`. Frontend renders inline error before sending. |
| User submits exactly 10 chars | Allowed. Pipeline runs. Likely scores low and gates — that's the gate's job, not idea validation's. |
| User submits 500-char idea with a 501st trailing space | Pre-trim drops the space. Allowed. |
| User submits 501 chars of content | `VALIDATION_FAILED`. |
| User has no channels at all | `/runs` and `/runs/new` show a CTA pointing to `/onboard`. `POST /api/runs` returns 409. |
| User has channels but `active_channel_id` is null (e.g., they deleted their active channel) | Same as above — onboarding flow is set the active channel. |
| User refreshes during a running pipeline | Page mounts → fetches row → opens stream → server emits `snapshot` (current state) → continues forwarding `progress`/`stage_complete` events. Seamless. |
| User opens the same run in two tabs | Both tabs render. Both subscribe to the same bus. Updates broadcast to both. Re-run clicks from either tab are processed by the server one at a time; the second click on a `running` run gets `409 RUN_ALREADY_RUNNING`. |
| User regenerates titles (stage 5) while stages 6–12 are already complete | Stage 5 service writes new `titles_data`, sets `stale_hook = stale_script = ... = stale_engagement_drafts = true`. UI re-renders with amber stale pills. Status returns to `complete` after stage 5 finishes (per §5.5). The user clicks "Re-run from here" to refresh the rest. |
| User submits a 2nd idea while the 1st is still running | Allowed. Two `pipeline_runs` rows exist. Both stream their own SSE. The orchestrator is per-runId; concurrency is bounded by Anthropic/YouTube rate limits, not by us. |
| User has 100+ runs | Pagination at page size 20. The trigram index handles search. Phase 1 has no per-user soft cap. |
| User switches active channel mid-pipeline | Current run keeps its original channel context (see §6.1). New runs use the new channel. The single-run page shows a "viewing on different channel" banner. |
| User's session expires mid-pipeline | Server-side orchestrator continues (it has a service-role DB connection, not the user's session). Re-auth → page reload → snapshot resumes. |
| Idea text contains prompt-injection ("ignore previous instructions and …") | Workspace itself doesn't crash. Stage prompts (specs 04–13) sandbox the idea inside a `<user_idea>` XML block with explicit instructions per CLAUDE.md SEC-3-style guidance. This spec doesn't transform the text. |
| Channel deleted while a run is in progress | Spec #01 §4.6 cascade sets `pipeline_runs.deleted_at = now()` for those runs. The orchestrator's per-stage boundary check sees `deleted_at != null` and aborts. SSE proxy emits `run_error` with code `CHANNEL_DELETED` and closes. |
| `pipeline_runs.deleted_at` is set while user has the page open | Next bus event finds the row gone → proxy emits `run_error: { code: "RUN_DELETED" }` → page redirects to `/runs`. |
| Orchestrator crashes mid-stage (server restart) | The row is left at `status = 'running'`. A startup recovery job (Phase 2 — out of scope here) sweeps `running` runs older than 10 minutes and marks them `error` with `failure_reason = "orchestrator_crashed"`. Phase 1 mitigation: stages are idempotent on retry (the user clicks "Retry stage" and it works). |
| Bus message lost between orchestrator and proxy | Acceptable — the row is the source of truth. The page also polls the row every 30s as a fallback (§6.2). Worst case the user sees a 30s lag on a rare failure mode. |
| User with no channels visits `/runs/[runId]` directly | RLS returns 404. Page shows the 404 view. |
| User with multiple channels visits `/runs/[runId]` whose channel is not the active channel | The view loads (RLS allows because they own it). A banner shows the channel mismatch. |
| User clicks "Cancel" then immediately "Delete" | Cancel sets `error`; delete sets `deleted_at`. Both succeed. Row vanishes from list. |
| `score_data` is missing the `value` field | List query's preview falls back to null. Run page renders the gate UI without a numeric badge. Bug surface — log a warning; spec 05 must always write `value`. |
| User pastes a 500-char idea that contains 4-byte UTF-8 emoji | `char_length` in Postgres counts characters, not bytes. Allowed up to 500 chars regardless of byte width. |

---

## 9. Security Considerations

- **Auth-gated:** middleware on `(app)` route group enforces session presence. Unauthenticated requests to any endpoint in §4 return `401 UNAUTHENTICATED` with no detail.
- **RLS (CLAUDE.md SEC-2):** every read/write to `pipeline_runs` is filtered by `auth.uid() = user_id`. The DELETE-policy omission (§3.1) prevents direct client deletes — the only path is the server-side `DELETE /api/runs/[runId]` that uses the service role key after validating ownership and applying soft-delete.
- **IDOR:** every endpoint that takes `runId` reads the row with `where user_id = auth.uid()`. Rows belonging to other users return `RUN_NOT_FOUND` (404), never 403 (don't leak existence). Same convention as spec #01.
- **Active-channel scoping:** `GET /api/runs` and `POST /api/runs` filter / lock by `profiles.active_channel_id`. A user cannot see or create runs against a channel they don't own (RLS) and cannot see runs against a channel that isn't currently active *via the list* (intentional — switch channels to see those runs).
- **Idea-text length DoS:** Zod max 500 + DB check; no path through which a megabyte of text reaches Anthropic.
- **SSE auth:** the SSE proxy verifies the session on each connection. No unauthenticated bus subscriptions. Disconnects do not authenticate; reconnects re-verify.
- **Bus channel naming:** Postgres `LISTEN/NOTIFY` channels are namespaced `run:<runId>`. The orchestrator and proxy both verify the user's ownership of the runId before publishing/subscribing. A malicious actor who knows another user's runId still gets `RUN_NOT_FOUND` from the API and cannot subscribe.
- **Error-message leakage (CLAUDE.md API-2):** Anthropic 5xx, YouTube 403/429, Postgres errors are translated to `UPSTREAM_ERROR | QUOTA_EXCEEDED | INTERNAL_ERROR` in `failure_reason`. Sentry (or equivalent) captures the raw error server-side; never returned to the client.
- **Prompt-injection of idea text:** out of scope for this spec. Stage prompts (specs 04–13) wrap idea text in untrusted-content XML blocks. This spec passes the raw text through unmodified.
- **No public sharing in Phase 1:** there is no `/runs/[runId]/public` endpoint, no shareable token. Out-of-scope explicitly per PRD.
- **CSRF:** Next.js Server Actions and same-origin SSE/POST are CSRF-protected by default. POST routes verify the `Origin` header.
- **Rate limits:** per-user limits to prevent runaway costs:
  - `POST /api/runs`: 30 per hour. Beyond that → `429 { code: "RATE_LIMITED" }`. Throttle stored in a `rate_limits` table or Redis (Phase 2 if Redis comes in; Phase 1 uses a simple Postgres counter).
  - `POST /api/runs/[runId]/rerun-from` and `POST /api/pipeline/<stage>` (re-run): 60 per hour combined. Same enforcement.
- **PII:** idea text may include personal context (names, dollar amounts). Stored encrypted-at-rest by Supabase defaults. No additional encryption.

---

## 10. Future Considerations (Out of Scope for Phase 1)

The following are intentionally deferred. Each is tracked elsewhere — do not implement as part of this feature.

- **Trash bin / undelete UI:** `deleted_at` exists in the DDL; surfacing it is a Phase 2 UX.
- **Cross-tab synchronization:** Phase 1 has multiple SSE streams per user; Phase 2 may add BroadcastChannel-based dedup.
- **Compare two runs side-by-side:** PRD lists this as out-of-scope; persisted by spec — deferred.
- **Versioning within a single run:** each regenerate replaces the prior output. Phase 2 may persist a `pipeline_run_revisions` table for diffing previous outputs against current.
- **Sharing kits via public link:** Phase 2+ — needs share tokens, viewer auth toggle, public-page rendering.
- **Export to PDF / Notion / Google Docs:** Phase 2 — separate spec per format.
- **Idea autocomplete / suggestions:** Phase 2 — Feature #18 (niche vocabulary library).
- **Per-tier run limits:** Phase 1 has 30/hr blanket. Phase 2 — Stripe tier integration.
- **Orchestrator crash recovery sweep:** the runtime guarantee that a `running` row eventually transitions to a terminal state. Phase 1 mitigates with the stale-state rule + manual retry. Phase 2 — a cron job sweeps `running` runs older than 10 minutes.
- **Override-gate dev affordance:** the mockup State 5 includes an "Override gate" button. **Phase 1 ships with this hidden behind a `?dev=1` query param flag**, not a user-visible button — see §7.3. Phase 2 may decide whether to surface it as a user feature or remove it entirely.
- **Analytics / "Send to calendar" / "Lock kit":** the mockup State 4 footer shows these CTAs. They are owned by Features #20 (calendar generator) and a future "publish workflow" feature. This spec does not implement them; the buttons are rendered as disabled affordances with a "Phase 2" tooltip.
- **History row pagination at 25/page:** the PRD says 25 but the MVP defaults locked here say 20. Phase 2 may revisit; this spec ships 20.
- **Sort options other than newest:** the dropdown ships as a no-op visual.
- **History list virtualization:** at 1000+ runs the page-size-20 pager is fine. Phase 2 with infinite scroll if user research demands it.
- **Restoring a soft-deleted run from the user UI:** admin-only in Phase 1.
- **Bulk delete:** select multiple rows + delete. Phase 2.
- **Bus implementation upgrade:** if the orchestrator scales beyond a single Next.js server instance, replace `LISTEN/NOTIFY` with Redis Pub/Sub or NATS. Phase 1 runs on a single Vercel deployment so the constraint doesn't bind.

---

## Appendix A — File map

This spec implies the following files exist by the end of implementation:

```
app/
  (app)/
    runs/
      page.tsx                                    # /runs list
      new/page.tsx                                # /runs/new idea form
      [runId]/page.tsx                            # /runs/[runId] live + history view
      [runId]/components/
        StageCard.tsx                             # one stage's card (variants per §7.3)
        RunHeader.tsx                             # title, status pill, score, timestamp
        ProgressBar.tsx                           # 0/12 → 12/12 gradient bar
        DeleteRunModal.tsx                        # mockup State 12
        StaleBanner.tsx                           # mockup State 7
        QuotaBanner.tsx                           # mockup State 8
        GateExplanation.tsx                       # mockup State 5
  api/
    runs/
      route.ts                                    # GET list / POST create
      [runId]/route.ts                            # GET row / DELETE soft-delete
      [runId]/cancel/route.ts                     # POST cancel
      [runId]/stream/route.ts                     # GET SSE proxy
      [runId]/rerun-from/route.ts                 # POST rerun-from-stage
lib/
  services/
    runs.ts                                       # createRun, listRuns, getRun, deleteRun, cancelRun, rerunFrom
    pipeline.ts                                   # orchestrator (Build Order §0.8)
    pipeline-bus.ts                               # LISTEN/NOTIFY publish + subscribe helpers
  db/
    runs.ts                                       # typed CRUD + list query (§5.3)
    profiles.ts                                   # active_channel_id read (re-used from spec #01)
  validation/
    run.ts                                        # IdeaTextSchema, RunRowSchema, RunListItemSchema
  hooks/
    useRun.ts                                     # client hook: row fetch + SSE subscribe + state patches
    useRunsList.ts                                # client hook: list query with filters/pagination
migrations/
  003_pipeline_runs.sql                           # the full DDL from §3.1
```

## Appendix B — CLAUDE.md updates required

When this spec is implemented, the following CLAUDE.md sections must be updated:

1. **A-2 example block:** the existing pseudo-code for "WRONG / CORRECT" already references `runCompetitor({ runId })`. No change needed, but a comment may be added clarifying that `runCompetitor` writes to `pipeline_runs.competitor_data` and reads `pipeline_runs.idea_text` + `channel.competitor_set_json` — to anchor future devs to the contract codified in this spec.
2. **API-3 confirmation:** the contract `POST /api/pipeline/<stage>` with body `{ runId }` is now ratified. No change to the rule itself; future stage specs cite it.
3. **Common Mistakes section:** add an entry the first time a stage forgets to call the `markStageComplete` helper that handles staleness invalidation (§5.6) — likely-recurring mistake.
4. **Stack lock-in:** no new dependency. `pg_trgm` is a Postgres extension; document its requirement in the Supabase setup notes.
5. **No new model assignments** — this spec is UI/data-shell; LLM model rules are unchanged. The CRIT-2 model table is not modified.
