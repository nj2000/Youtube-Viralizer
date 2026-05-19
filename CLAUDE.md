# YouTube Viralizer — Claude Code Rules

A Next.js web app that turns one video idea into a 12-stage viral production kit. Full vision: `Documentation/Overviews and Summaries/Master-Overview.md`. **Read it before scope decisions.**

---

## ⚠️ CRITICAL RULES (violations cause real bugs or real money loss)

### CRIT-1: YouTube Data API quota is 10,000 units/day. Never call uncached on the hot path.

A `search.list` call costs **100 units** — you get **100 calls per day total**. One uncached pipeline run can blow the daily quota.

**WRONG:**
```typescript
// app/api/pipeline/competitor/route.ts
const results = await youtube.search.list({ q: niche });  // 100 units, every request
```

**CORRECT:**
```typescript
// All YouTube calls go through the cached wrapper
import { searchVideos } from "@/lib/youtube/cached";
const results = await searchVideos({ niche, ttlSeconds: 3600 });
```

**Why:** Without caching, 10 users running the pipeline once each will hit the daily limit and break the product for everyone else. Cache TTLs: channel data 24h, outlier search 1h, video details 6h.

### CRIT-2: Use Haiku 4.5 for lint/rewrite stages. Opus 4.7 only for scoring and script generation.

Opus is roughly 12× the cost of Haiku per token. Using Opus for stage 8 (anti-pattern lint) instead of Haiku 4.5 burns money for zero quality gain.

**Model assignments — do not deviate without writing a comment explaining why:**

| Stage | Model | Reason |
|---|---|---|
| Onboarding (niche + competitors) | `claude-sonnet-4-6` | Single-shot classification + ranking, low-stakes, lives outside the pipeline DAG. Invoked via `lib/anthropic/onboarding.ts#callSonnet`, not `callClaude(stage)`. |
| 3 — Competitor outliers | `claude-opus-4-7` | Reasoning over delta extraction across outliers |
| 4 — Idea score + 92% gate | `claude-opus-4-7` | Reasoning over outlier patterns |
| 7 — Retention script | `claude-opus-4-7` | Long-form generation with structural constraints |
| 5 — Title generation | `claude-haiku-4-5-20251001` | Short, format-driven |
| 6 — Cold-open hook | `claude-haiku-4-5-20251001` | Short, format-driven |
| 8 — Anti-pattern lint | `claude-haiku-4-5-20251001` | Pattern matching |
| 9 — Thumbnail briefs | `claude-haiku-4-5-20251001` | Short structured output |
| 10 — SEO metadata | `claude-haiku-4-5-20251001` | Templated |
| 11 — A/B test plan | `claude-haiku-4-5-20251001` | Templated |
| 12 — Pinned/community drafts | `claude-haiku-4-5-20251001` | Short copy |

### CRIT-3: All system prompts ≥1024 tokens MUST use Anthropic prompt caching.

The pipeline reuses the same system prompt across thousands of users. Without `cache_control`, every call pays full input-token cost. With caching, repeat calls are 10× cheaper.

**WRONG:**
```typescript
await anthropic.messages.create({
  system: longSystemPrompt,  // No cache breakpoint
  messages: [...]
});
```

**CORRECT:**
```typescript
await anthropic.messages.create({
  system: [
    { type: "text", text: longSystemPrompt, cache_control: { type: "ephemeral" } }
  ],
  messages: [...]
});
```

### CRIT-4: Reference skill attribution is non-negotiable.

We lift prompt patterns from `AgriciDaniel/claude-youtube` (MIT). The MIT license **requires** the copyright notice and permission notice in distributions.

- `ATTRIBUTIONS.md` at repo root must contain the full MIT license text + copyright line: `Copyright (c) 2025 Daniel Agrici`
- App footer must link to the source repo
- When porting a subskill, add a comment at the top of the prompt file: `// Adapted from AgriciDaniel/claude-youtube (MIT) — sub-skills/<name>.md`

---

## Scope Management

### S-1: Build only what's in the current phase. No Phase 2 or Phase 3 features sneak into Phase 1.

Phase 1 = the 12 pipeline stages with LLM-only scoring and text-only thumbnail briefs. **Anything else requires explicit user approval before implementation.**

**WRONG:** Adding a "real outlier corpus cron" because it would make scoring better. That's Phase 2.

**WRONG:** Adding Stripe paywall code because the Master Overview mentions it. That's Phase 2.

**CORRECT:** Note the deferred feature as a `// TODO(phase-2):` comment, ship Phase 1 as scoped.

### S-2: When a request is ambiguous, ask before building.

If the user says "improve the script stage," do not refactor it, add features, or change the prompt. **Ask which dimension** — output quality, speed, cost, structure — and get a specific answer.

### S-3: Do not refactor code that wasn't part of the requested change.

If you're fixing a bug in stage 5, do not rename variables in stage 6 because they look inconsistent. File a note, ship the fix, leave the rest alone.

### Scope Checklist (verify before completing any task)

- [ ] Every file changed was directly required by the user's request
- [ ] No features added beyond what was asked
- [ ] No "while I'm here" cleanup outside the request scope
- [ ] Phase 2/3 features are still deferred (unless explicitly requested)

---

## Research Protocol

### R-1: Before porting a pipeline stage, read the corresponding `claude-youtube` subskill.

The reference skill lives at `~/development/_reference/claude-youtube/`. Mapping:

| Our stage | Their file |
|---|---|
| 3 — Competitor outliers | `sub-skills/competitor.md` |
| 4 — Idea score + gate | `sub-skills/ideate.md` |
| 5 — Title generation | `sub-skills/seo.md` |
| 6 — Cold-open hook | `sub-skills/hook.md` |
| 7 — Retention script | `sub-skills/script.md` |
| 8 — Anti-pattern lint | parts of `script.md` + `seo.md` |
| 9 — Thumbnail briefs | `sub-skills/thumbnail.md` |
| 10 — SEO metadata | `sub-skills/metadata.md` |

**Do not write a stage prompt from scratch when a 5,300-line battle-tested version exists.** Read, adapt, attribute.

### R-2: Before modifying YouTube API code, check the existing cache wrapper.

All YouTube access goes through `lib/youtube/cached.ts`. Before adding a new call, check if a similar wrapper exists. Before changing TTLs, check what currently consumes that endpoint.

### R-3: Before writing a new prompt, grep `lib/prompts/` for existing prompts on similar topics.

Pipeline stages share concepts (outlier patterns, virality criteria, niche descriptors). Reuse the existing prompt fragment instead of duplicating.

### Research Checklist

- [ ] Read the source subskill (or noted that none exists) before writing prompt code
- [ ] Checked `lib/youtube/` for existing wrappers before adding new YouTube calls
- [ ] Grep'd `lib/prompts/` for related prompts before writing new ones

---

## Tech Stack Conventions

### Stack lock-in (do not introduce alternatives without explicit approval)

- Framework: **Next.js 15** with App Router (not Pages Router)
- Language: **TypeScript** strict mode
- Database + Auth: **Supabase** (Postgres, magic-link auth via Supabase Auth). SSR session/cookie handling uses **`@supabase/ssr`**; clients are instantiated only in `lib/supabase/server.ts` (anon, cookies), `lib/supabase/middleware.ts` (cookie-mutating), and `lib/supabase/service.ts` (service-role, no session).
- LLM: **`@anthropic-ai/sdk`** — Claude Opus 4.7 (`claude-opus-4-7`), Sonnet 4.6 (`claude-sonnet-4-6`, onboarding only), and Haiku 4.5 (`claude-haiku-4-5-20251001`)
- YouTube: **`googleapis`** package, Data API v3
- Email: **Resend** (wired to Supabase Auth via Custom SMTP — dashboard-only; no `resend` npm dependency)
- Styling: **Tailwind CSS**
- Validation: **Zod** for all external inputs (request bodies, env vars, third-party API responses)

### TS-1: Server Components by default. `"use client"` only when component needs hooks, browser APIs, or event handlers.

**WRONG:**
```typescript
"use client";
export default function Page() {  // No hooks, no events — doesn't need to be client
  return <h1>Welcome</h1>;
}
```

**CORRECT:**
```typescript
// Server component, no directive needed
export default function Page() {
  return <h1>Welcome</h1>;
}
```

### TS-2: All long-running pipeline routes stream via Server-Sent Events.

Stages 4 (scoring) and 7 (retention script) take 5-30s. Blocking the UI is unacceptable.

**Pattern:**
```typescript
// app/api/pipeline/[stage]/route.ts
export async function POST(req: Request) {
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(`event: progress\ndata: starting\n\n`));
      // ...stream Claude response chunks
      controller.enqueue(encoder.encode(`event: complete\ndata: ${json}\n\n`));
      controller.close();
    }
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}
```

### TS-3: Zod-validate every external input.

User-submitted channel URLs, request bodies, YouTube API responses, env vars. Untyped JSON crossing a boundary is a bug waiting to happen.

---

## Architecture Rules

### A-1: Three-layer architecture. Each layer has one job. No skipping layers.

```
app/api/pipeline/<stage>/route.ts   → HTTP only: parse, call service, stream response
lib/services/<stage>.ts             → Business logic: orchestrate prompts, validate outputs
lib/youtube/, lib/anthropic/        → External-service wrappers with caching/retry
lib/prompts/<stage>.ts              → Prompt strings + cache_control config
lib/supabase/*.ts                   → Supabase SSR client factories (server, middleware, service-role)
lib/db/*.ts                         → Supabase queries
```

**`lib/supabase/` exception to A-1:** the three client factories live here, not under `lib/db/` or `lib/services/`. They are the *only* place `createServerClient` / `createClient` from `@supabase/ssr` / `@supabase/supabase-js` is instantiated. Routes, services, and DB wrappers consume the factories — never instantiate Supabase clients inline.

**Forbidden:**

- API route making direct Anthropic or YouTube calls (must go through `lib/`)
- Service layer importing another service (orchestrate from `lib/services/pipeline.ts` only)
- Prompt strings inline in route handlers or service files (must live in `lib/prompts/`)
- DB queries outside `lib/db/`

### A-2: Pipeline stages are independently re-runnable. No stage may depend on in-memory state from another stage.

Each stage reads its inputs from Supabase (the `pipeline_runs` table) and writes its outputs back. A user clicking "regenerate titles" must work without re-running stages 1-4.

**WRONG:**
```typescript
// In-memory pipeline orchestrator passes state forward
const competitorData = await runCompetitor(idea);
const score = await runScore(idea, competitorData);  // Won't work for stage-only re-runs
```

**CORRECT:**
```typescript
// Each stage reads/writes the run record
await runCompetitor({ runId });  // writes competitor_data column
await runScore({ runId });       // reads competitor_data, writes score column
```

### A-3: One file per stage in `lib/prompts/`. No multi-stage prompt files.

`lib/prompts/score.ts`, `lib/prompts/script.ts`, etc. Each exports a `systemPrompt` and a `buildUserPrompt(input)` function.

---

## API Conventions

### API-1: Field naming — snake_case in DB and external APIs, camelCase in TypeScript code.

Transform at the boundary, never mix.

**WRONG:**
```typescript
const { channel_url } = req.body;  // snake_case bleeding into app code
```

**CORRECT:**
```typescript
const { channelUrl } = ChannelInput.parse(req.body);  // Zod schema does the transform
```

### API-2: Error responses use this exact shape:

```typescript
{
  code:
    | "VALIDATION_FAILED"
    | "QUOTA_EXCEEDED"
    | "UPSTREAM_ERROR"
    | "INVALID_EMAIL"
    | "RATE_LIMITED"
    | "EXPIRED_LINK"
    | "INVALID_LINK"
    | "ALREADY_USED"
    | "EMAIL_SEND_FAILED"
    | "UNAUTHENTICATED"
    | "INVALID_ORIGIN"
    | "INVALID_URL"
    | "CHANNEL_NOT_FOUND"
    | "CHANNEL_PRIVATE"
    | "CHANNEL_TERMINATED"
    | "CHANNEL_LIMIT_REACHED"
    | "DRAFT_EXPIRED"
    | "NO_ACTIVE_CHANNEL"
    | "RUN_NOT_FOUND"
    | "RUN_ALREADY_RUNNING"
    | "RUN_CANCELLED"
    | "RUN_DELETED"
    | "CHANNEL_DELETED"
    | "BUS_UNAVAILABLE"
    | "NOT_FOUND"
    | "INTERNAL_ERROR",
  message: string
}
```

**Never expose:**

- Anthropic API error messages (could leak system prompts)
- YouTube API key issues with details
- Stack traces
- Internal IDs other than the user's own runId

### API-3: Pipeline endpoints — fixed contract.

- Path: `POST /api/pipeline/<stage>`
- Body: `{ runId: string }` (channelId and ideaId are derived from the run)
- Response: SSE stream with `progress` events and a final `complete` event containing the stage output

### API Checklist

- [ ] Request body validated with Zod
- [ ] Response uses the standard envelope or SSE protocol
- [ ] No raw upstream errors leak to the client
- [ ] Field naming respects the snake_case/camelCase boundary

---

## File Organization

```
app/
  (marketing)/         → Public pages (landing, pricing later)
  (app)/               → Authenticated app
    onboard/           → Channel URL setup
    runs/              → Idea workspace + history
    runs/[runId]/      → Single run view
  api/
    pipeline/<stage>/  → One folder per stage
    auth/              → Magic link callbacks
lib/
  anthropic/           → SDK wrapper, model routing, cache_control helpers
  youtube/             → API wrapper with caching
  streaming/           → Server-side SSE helper (createSSEStream)
  hooks/               → Client-only React hooks (e.g. useStageStream)
  db/                  → Supabase typed queries
  prompts/             → One file per stage
  services/            → Business logic per stage + pipeline.ts orchestrator
  validation/          → Zod schemas
ATTRIBUTIONS.md        → MIT notice for claude-youtube
```

### F-1: New code goes in the directory that matches its layer. No "utils" dumping ground.

If you can't decide where a file goes, the file probably belongs in two places — split it.

---

## External Services

### EXT-1: All API keys come from `process.env`. Never commit keys, never log them.

Required env vars (validated by Zod at boot in `lib/env.ts`):

- `ANTHROPIC_API_KEY`
- `YOUTUBE_API_KEY`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `SITE_URL` — public origin used to build magic-link callback URLs and to enforce same-origin CSRF on `POST /api/auth/sign-in`. Must be a valid URL.

If `lib/env.ts` parsing fails, the app must refuse to start.

### EXT-2: YouTube quota tracking is mandatory.

`lib/youtube/cached.ts` increments a `youtube_quota_usage` row in Supabase per call. When daily usage exceeds 8,000 units (80% of 10k), new pipeline runs return `code: "QUOTA_EXCEEDED"` with a friendly message.

### EXT-3: Anthropic calls use exponential backoff on 429/529. Max 3 retries.

Don't retry on 4xx other than 429 — those are bugs in our code, not transient failures.

### EXT-4: Supabase CLI must use the IPv4 session pooler on this network.

`supabase db push` / `db pull` / `db query --linked` will fail on this machine with:

```
IPv6 is not supported on your current network: dial tcp [2a05:…]:5432: connect: no route to host
```

The CLI defaults to the direct DB endpoint over IPv6; this network has no IPv6 route. **Fix:** re-run `supabase link --project-ref <ref>` (no other args). The link command re-resolves the stored connection string to the IPv4 session pooler (`aws-0-<region>.pooler.supabase.com`), and subsequent `db ...` commands work.

**Do not retry the failing command** before re-linking — it will fail the same way. If you are a fresh agent setting up Supabase work, run `supabase link --project-ref <ref>` proactively before the first `db push`.

Also: `supabase gen types typescript --linked` prints a banner to stdout (`"Initialising login role..."`) that will contaminate the generated types file. Use `2>/dev/null` *before* the `>` redirect, as in the `db:types` script in `package.json`.

---

## Code Quality Standards

### Q-1: TypeScript strict mode. No `any`, no `@ts-ignore` without a comment explaining why.

### Q-2: File length limits.

- API routes: ≤ 150 lines (they should be thin — push logic into services)
- Service files: ≤ 300 lines
- Prompt files: ≤ 500 lines (some stages legitimately need long prompts)
- Components: ≤ 200 lines

If a file exceeds the limit, split it before adding more code.

### Q-3: No comments explaining what well-named code does. Comments only for the *why* of non-obvious decisions.

**WRONG:**
```typescript
// Increment the counter
counter++;
```

**CORRECT:**
```typescript
// YouTube counts search.list as 100 units even when results are cached on their side,
// so we still need to count it locally.
incrementQuotaUsage(100);
```

---

## Security

### SEC-1: Validate channel URLs against a strict allowlist before sending to YouTube API.

Only `youtube.com/@handle`, `youtube.com/channel/UC...`, and `youtube.com/c/name` patterns. Reject everything else with `code: "INVALID_CHANNEL"`.

### SEC-2: All Supabase queries filter by `auth.uid()`. Row-level security policies enforce this in the DB layer too.

A user must never see another user's runs, ideas, or channel data, even if they craft a malicious request.

**`login_attempts` exception:** this table has RLS enabled with **zero policies** — only the service-role key can read or write. The app must never query `login_attempts` from a user-scoped client. All access goes through `lib/db/login-attempts.ts` invoked with the service-role client, and is limited to rate-limit checks and audit logging.

### SEC-3: Generated scripts and titles are user-controlled output. Escape before rendering as HTML.

Use React's default JSX escaping. Never use `dangerouslySetInnerHTML` on Claude output.

---

## Common Mistakes (turn each correction into a rule)

This section grows over time. Add an entry whenever you correct a recurring mistake.

- **Supabase `db push` fails on first run** → not a credential issue, it's the IPv6/IPv4 routing problem. See EXT-4 — re-run `supabase link --project-ref <ref>` to switch to the IPv4 pooler, then retry.
- **`supabase gen types typescript --linked > lib/db/types.ts` produces a broken file** → the CLI banner leaks to stdout. Use the `db:types` script in `package.json` (it redirects stderr first), or invoke as `supabase gen types typescript --linked 2>/dev/null > lib/db/types.ts`.
- **SSR cookie mutation pitfall (`@supabase/ssr`)** → `createServerClient` must be given a `cookies.setAll` that writes cookies back to *both* `request.cookies` (so subsequent handlers see the refreshed session) *and* the response (so the browser receives them). Forgetting to update the response means the user's access token is silently refreshed in memory but never persisted — the next request will log them out. `lib/supabase/middleware.ts` is the reference implementation; routes must consume that factory, never inline a `createServerClient` call.

---

## Pre-Commit Checklist

Before reporting any task complete:

- [ ] All four CRITICAL rules respected (quota cache, model assignment, prompt cache, attribution)
- [ ] Scope checklist passes
- [ ] Research checklist passes
- [ ] API checklist passes (if API code changed)
- [ ] No `any` types added
- [ ] No keys logged or committed
- [ ] Files within length limits
- [ ] If auth surface changed: Supabase redirect-URL allowlist includes the dev + staging + prod callback URLs and `emailRedirectTo` is always built from `env.SITE_URL`
