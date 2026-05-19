# Phase 1.6 — Idea Workspace Shell

**Status:** Complete. **Closes Phase 1 (Foundation).** Phase 2 stages plug in without touching any of this code.
**Date:** 2026-05-19
**Branch:** `main`
**Detail:** See `Phases/Phase 1 — Foundation/Phase 1.6 — Idea workspace shell/summary.md` for the per-file breakdown and verification log.

---

## What was built

The user-facing workspace and the plumbing behind it. A user drops an idea, the orchestrator walks the 10-stage pipeline (currently stubbed so the lifecycle completes), and the run streams live via Server-Sent Events with snapshot-first semantics and a 15-second keepalive. Multi-run history per active channel with trigram search, status filters, and a soft-delete cascade.

- **5 new API routes** under `/api/runs`: `GET/POST /api/runs`, `GET/DELETE /api/runs/[runId]`, `POST /api/runs/[runId]/cancel`, `POST /api/runs/[runId]/rerun-from?stage=<n>`, `GET /api/runs/[runId]/stream`.
- **3 new pages**: `/runs` list with search + status filters + pagination, `/runs/new` with active-channel summary + idea form, `/runs/[runId]` live view with a 12-stage card grid and gate / stale banners.
- **The orchestrator from Phase 1.3 split into four focused modules**: `pipeline-stages.ts` (registry + `DOWNSTREAM` cascade map + auto-registered stub handlers), `pipeline-state.ts` (the four mutation helpers — the only writers allowed to touch `pipeline_runs`), `pipeline-bus.ts` (Supabase Realtime broadcast publish + subscribe), and the existing `pipeline.ts` reduced to a thin `runStage` / `runFullPipeline` / `runFromStage` delegator.
- **Two client hooks** (`useRun`, `useRunsList`) and **20 new Vitest specs** (58 → 78 total) covering the verification matrix's pure-function items (idea-text trim, DOWNSTREAM cascade, `markStageComplete` patch shape, `markStageFailed` `^stage_<n>:` sanitization, `markGateFailed` literal-string format).

### Tests

20 new Vitest specs land in this phase, bringing the suite to **78 specs** in ~310ms. Coverage: `IdeaTextSchema` trim-before-check + length bounds (10 specs), `DOWNSTREAM` cascade for every stage on the verification matrix (6 specs), and the three state-mutation invariants (`markStageComplete` flips downstream stale only for populated columns, `markGateFailed` writes the exact literal "Score 71 / 100 — below 92 threshold" string, `markStageFailed` prefixes `^stage_<n>:` and strips newlines from sanitized error bodies — 4 specs). SSE proxy integration + Playwright E2E deferred (see deviations).

---

## Key implementation decisions

| Decision | Why |
|---|---|
| **Orchestrator split into four files (stages / state / bus / entry)** | Spec §4.7 mandates that only one module may write `pipeline_runs`. Phase 1.3's monolithic `pipeline.ts` mixed reads, writes, and bus emits in one file. The split makes the invariant lint-checkable ("grep for `pipeline_runs` writes outside `pipeline-state.ts`"), keeps the bus replaceable (Realtime → Redis later) without touching state semantics, and lets Phase 2 stages depend on `pipeline-state` without inheriting the orchestrator entry-point's full surface. |
| **Supabase Realtime via the HTTP broadcast endpoint, not the WebSocket-based `channel.send()`** | The server publishes fire-and-forget; opening a WS connection per publish would be wasteful. Supabase's HTTP `/realtime/v1/api/broadcast` endpoint accepts service-role auth and one or more topic/event/payload messages. The SSE proxy still uses the WS subscribe path (one long-lived channel per open `/runs/[runId]/stream` tab). |
| **Auto-register stub handlers at module load, score stub returns 95** | Verification item #3 wants "terminal status within 30s (stubbed)". The stubs ensure all 10 stages succeed quickly; the score stub passes the 92-point gate so the lifecycle ends in `complete` rather than `gated_failed`. Tests that need an empty registry call `clearStageHandlers()` first — same contract as Phase 1.3. |
| **`pipeline-bus.ts` reads `process.env` directly, not the validated `env` export** | `lib/env.ts` validates at module load and throws if env vars are missing. Vitest doesn't have `.env.local`, so importing `env` anywhere in the orchestrator's dependency graph would break the existing `tests/services/pipeline.test.ts`. The bus reads `process.env.SUPABASE_URL` / `process.env.SUPABASE_SERVICE_ROLE_KEY` lazily inside `publish()`; production already validates them at boot. |
| **`useRun` uses fetch + ReadableStream, not `EventSource`** | EventSource doesn't carry cookies for cross-origin requests and doesn't expose abort. Using `fetch` + a manual `\n\n`-frame parser matches the pattern Phase 1.3 already established for `useStageStream`, integrates cleanly with `AbortController` cleanup, and lets us share the SSE parser logic. |
| **`stage_complete` bus event carries only `{ stage }`, not the full row** | The bus has a per-message size limit and `script_data` could easily be tens of KB. The hook re-fetches `/api/runs/[runId]` after each `stage_complete` to get the fresh JSONB — one extra GET per stage, ~10 GETs per full run, acceptable. |
| **DOWNSTREAM map literal-encodes the verification matrix, not derived from stageDependencies** | The two maps mean different things: `stageDependencies` is "what data this stage needs to compute"; `DOWNSTREAM` is "what stages this stage's re-run invalidates". The verification matrix is the authoritative DOWNSTREAM — encoded as a typed `Record<Stage, Stage[]>` so a future bug can't drift it silently. |
| **Cross-user run access redirects via the page (302), 404s via the API** | Server Components don't return JSON; the cleanest pattern is `redirect("/runs")` if the run doesn't belong to the user. The API route does return JSON 404, which is what the verification item explicitly checks ("`GET /api/runs/<otherUserRunId>` returns 404 not 403"). The page just defers existence-probe protection to the API for HTML clients. |
| **Stale banner is a single shared `StaleBanner` component, not per-card amber pills (yet)** | Mockup state 7 shows both: a top banner AND per-card amber pills. Phase 1 ships the top banner; per-card pills are partially in `StageCard` (the "stale" state has its own border / label) but the prominent banner pattern isn't repeated per card. Saves complexity until users actually request the per-card pattern. |

---

## Files created or modified

**Validation + DB** (`lib/`)
```
validation/runs.ts                     NEW — IdeaTextSchema (preprocess trim) + RunRow/RunListItem/RunsListQuery/RerunFromStageQuery
db/runs.ts                             Rewritten — rowToView, rowToListItem, getRun (view), getRunRow (raw), insertRun, listRuns (paginated + counts), countRunsLastHourForUser, listRunsForChannel
```

**Orchestrator refactor** (`lib/services/`)
```
pipeline.ts                            Refactored — runStage / runFullPipeline / runFromStage delegate to pipeline-state; re-exports the Phase 1.3 surface
pipeline-stages.ts                     NEW — registry + stageColumn + staleColumn + DOWNSTREAM + STAGE_NUMBER + auto-registered stubs
pipeline-state.ts                      NEW — markStageStarted / markStageComplete / markStageFailed / markGateFailed / markRunComplete / markRunCancelled
pipeline-bus.ts                        NEW — publish via HTTP broadcast + subscribeToRun via WS channel
runs.ts                                NEW — createRun / listRunsForActiveChannel / getRunForUser / softDeleteRunForUser / cancelRunForUser / rerunFromStageForUser + 5 typed errors
```

**API routes** (`app/api/runs/`)
```
route.ts                               NEW — GET (paginated) + POST (create)
[runId]/route.ts                       NEW — GET + DELETE
[runId]/cancel/route.ts                NEW — POST
[runId]/rerun-from/route.ts            NEW — POST ?stage=<n>
[runId]/stream/route.ts                NEW — GET SSE: snapshot + bus forward + 15s keepalive + terminal close
```

**UI** (`app/(app)/runs/`)
```
page.tsx                               NEW — server entry
RunsList.tsx                           NEW — search + 5 chips + pagination + 2 empty states + delete modal
RunRow.tsx                             NEW — list row with status pill + score + hover-delete
DeleteRunModal.tsx                     NEW — verbatim spec copy
new/page.tsx                           NEW — server, active-channel summary + IdeaForm
new/IdeaForm.tsx                       NEW — textarea + counter + POST
[runId]/page.tsx                       NEW — server, ownership gate
[runId]/RunView.tsx                    NEW — header + progress + 12 stage cards + conditional banners
[runId]/StageCard.tsx                  NEW — 5 visual states + gated variant + regenerate
[runId]/GateExplanation.tsx            NEW — amber card with re-run/edit buttons
[runId]/StaleBanner.tsx                NEW — single-line amber banner
```

**Hooks** (`lib/hooks/`)
```
useRun.ts                              NEW — SSE consumer with refresh-on-stage_complete
useRunsList.ts                         NEW — debounced 250ms fetch wrapper
```

**Tests** (`tests/`)
```
validation/runs.test.ts                NEW — 10 specs (IdeaText + RunsListQuery)
unit/staleness.test.ts                 NEW — 6 specs (DOWNSTREAM)
unit/pipeline-state.test.ts            NEW — 4 specs (markStageComplete shape, markGateFailed literal, markStageFailed sanitization)
```

**Docs**
```
CLAUDE.md                                                       API-2 error code union +7 codes (NO_ACTIVE_CHANNEL, RUN_NOT_FOUND, RUN_ALREADY_RUNNING, RUN_CANCELLED, RUN_DELETED, CHANNEL_DELETED, BUS_UNAVAILABLE)
Documentation/Projects/Phase-1.6-Summary.md                     This file
Documentation/Projects/Team-Update.md                           Prepended Phase 1.6 entry
Documentation/Projects/Implementation-Plan.md                   Marked 1.6 complete (closes Phase 1)
Documentation/Projects/Phases/.../Phase 1.6 .../summary.md      Per-phase deep dive
```

---

## How to verify it works

From the project root, with `.env.local` populated:

```bash
pnpm install
pnpm typecheck     # tsc --noEmit — clean
pnpm lint          # ESLint — 0 warnings, 0 errors
pnpm test          # Vitest — 78 specs in ~310ms
pnpm build         # next build — 25 routes registered, middleware compiled
```

Build output should now show the 5 new `/api/runs/*` API routes and the 3 new pages (`/runs`, `/runs/[runId]`, `/runs/new`), bringing the total dynamic route count to 25.

**Eyeball the UI**:

```bash
pnpm dev   # http://localhost:3000
```

Sign in, onboard a channel (Phase 1.5), then:

1. Visit `/runs` — empty state ("Drop your first idea") renders.
2. Click "Drop a video idea" → `/runs/new`. Try submitting short input ("hi") and confirm the rose error: "Add at least 10 characters so we have something to work with."
3. Submit a valid idea (e.g. "How I built a $10k SaaS in 30 days using Claude Code as my only developer"). Should redirect to `/runs/[runId]` with status pill "QUEUED" → "RUNNING · stage 3 / 12" — stubs walk the 10 stages in ~1 second and end at "Complete · 12 / 12".
4. Back at `/runs`, the row appears with status pill + score badge "95 / 100" + preview accent.
5. Hover the row → trash icon appears → click → modal → "Delete permanently" → row disappears.
6. Open a completed run, click "Regenerate" on Stage 5 (Titles) — `/api/runs/[runId]/rerun-from?stage=5` triggers; the orchestrator walks 5→12, downstream stale flags flip for stages 6/7/8/10/12 (per the DOWNSTREAM cascade), and the stale banner appears at the top of the view.

**End-to-end live verification** of the SSE proxy and Supabase Realtime broadcast needs `ANTHROPIC_API_KEY` + `YOUTUBE_API_KEY` populated. Without those, stub handlers still walk the pipeline and the UI behaves identically — only the bus event timing (which depends on real Anthropic latency) differs.

---

## Issues encountered and how they were resolved

**The orchestrator refactor broke nothing visible** — the existing `tests/services/pipeline.test.ts` (4 specs from Phase 1.3) kept passing throughout because `lib/services/pipeline.ts` re-exports `registerStageHandler` / `clearStageHandlers` / `runStage` and the bus + state helpers swallow env failures in test contexts. The pre-existing test contract drove the refactor's API more than the spec did.

**`lib/services/pipeline-bus.ts` initially `import { env } from "@/lib/env"`** — would have triggered Zod env validation at module load. Vitest doesn't have `.env.local`, so this would have crashed every spec that transitively imported the orchestrator. **Fix**: replaced with a local `busEnv()` helper that reads `process.env.SUPABASE_URL` / `process.env.SUPABASE_SERVICE_ROLE_KEY` directly inside `publish()`. Production safety unchanged (env still validates at app boot); the bus just doesn't *require* env-import-time validation.

**JavaScript default `.sort()` is lexicographic, not numeric.** `tests/unit/staleness.test.ts` first read `expect([10, 11, 12, 4, 5, 6, 7, 8, 9])` instead of `[4, 5, 6, 7, 8, 9, 10, 11, 12]`. **Fix**: explicit `.sort((a, b) => a - b)` comparator. The test code itself was correct; only the expectation needed numeric sort.

**`markGateFailed` parameter** — task spec hinted at `markGateFailed(runId, 71, [])` with a reframes array. ESLint flagged `_reframes` as unused. The reframes belong inside `score_data` (computed by stage 4's handler in Phase 2), not as a separate gate-helper argument. **Decision**: dropped the param. Phase 2 can re-shape the signature when it has a concrete reframes schema. Test updated to match.

**`migration #0009` planned but never written.** The focus-phase task list included a new migration for `pg_trgm` + the partial indexes. Reading `0005_pipeline_runs.sql` revealed that Phase 1.2 already shipped the 31 columns, all 4 partial indexes (`pipeline_runs_user_channel_created_idx`, `pipeline_runs_user_status_idx`, `pipeline_runs_idea_text_trgm`, `pipeline_runs_channel_id_idx`), the 3 RLS policies, and `pg_trgm` was enabled in `0001_extensions.sql`. Verification item #1 was satisfied before this phase started. No migration added.

**The `prefer the production-ready version` memory paid off.** The user established this preference in Phase 1.4. Phase 1.6 had multiple temptations to ship lighter (in-memory bus instead of Realtime, in-page SSE instead of separate stream route, generic JSON view forever, no stub registry). Each was rejected in favor of the production-fidelity path. The result is that Phase 2 specs literally just call `registerStageHandler` and don't need to touch any of this code — that's the dividend.
