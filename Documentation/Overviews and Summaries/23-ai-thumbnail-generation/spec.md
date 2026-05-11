# Spec — Feature #23: AI Thumbnail Generation (Phase 3)

> **Status:** Approved · **Phase:** 3 · **Tier:** 4 (Phase 3 — AI thumbnails + LoRA) · **Build Order:** §4.1
> **Source PRD:** `Documentation/PRDs/23-ai-thumbnail-generation.md`
> **Mockup:** `Documentation/Mockups/23-ai-thumbnail-generation.html`
> **Upstream contract:** `Documentation/Overviews and Summaries/10-thumbnail-concept-briefs/spec.md` (Stage 9)
> **Companion features:** `Documentation/Overviews and Summaries/24-lora-character-training/spec.md` (LoRA — Feature #24), `Documentation/Overviews and Summaries/01-channel-onboarding/spec.md` (channels.niche), Feature #25 channel assets (when shipped)

This spec is the engineering contract. It supersedes the PRD on any conflict. Code is built from this document.

---

## 1. Overview

Phase 3 turns each Stage 9 thumbnail concept brief into a finished, ready-to-upload **1280×720 PNG**. The pipeline is:

```
ThumbnailBrief (Stage 9 / Feature #10)
        ↓
prompt assembly (composition + style + facial expression + LoRA token)
        ↓
image-gen API call            ← primary: Gemini Imagen, fallback: FLUX (Replicate)
        ↓
OCR check on background       ← reject + re-prompt if garbled signage detected
        ↓
NSFW / policy gate            ← sanitize + retry up to 2x
        ↓
text overlay composite        ← Sharp, curated 3-font set, hex palette from brief
        ↓
upload to Supabase Storage    ← bucket `thumbnails`, signed URL
        ↓
write thumbnail_images_data   ← sibling JSONB on pipeline_runs (new column)
```

The user-facing change versus Phase 1: where the Stage 9 card used to render text briefs and a low-fidelity CSS mockup, the same card now renders three real PNGs that the user can download, regenerate per-trigger, or edit overlay text on inline. The brief itself is still authoritative — the briefs power the prompt — but the user no longer has to design anything in Canva. This is a **pure upgrade** on top of Phase 1: if image generation fails for a trigger, the card falls back to the Phase 1 text-only brief view for that trigger and links the user to the Canva-friendly markdown export from Feature #10.

**Why opt-in (not auto-trigger).** Per the MVP defaults, Phase 3 ships with a manual "Generate images" CTA on the Stage 9 card after briefs are ready. Auto-triggering on Stage 9 completion is rejected for Phase 3 because each generation costs real money (~$0.04 per image, 3 images per run) and is rate-limited (10/month per user). The user opts in once briefs look acceptable. **Flagged decision — see Appendix B.**

**Why two providers.** Gemini Imagen is the primary because it is roughly half the cost per image of FLUX-1.1-pro on Replicate at the time of writing, and its latency is consistently lower (~6–9s vs. 9–14s). FLUX is the fallback for two cases: (a) Imagen returns a hard policy reject (its content policy is stricter than ours need to be for thumbnail use cases), and (b) Imagen 5xx errors after retries. We never use FLUX as a primary today because cost would exceed the per-user-per-month budget at the planned 10-generation cap. Both providers are wrapped by `lib/imagegen/` with a unified interface; a third provider can be added without touching the service layer.

**Why Sharp for text, not the image-gen model itself.** Image-gen models (both Imagen and FLUX) reliably produce typographic artifacts: garbled signage in the background, misspelled words inside the headline, kerning that breaks at small sizes. Rendering the overlay programmatically with Sharp on a curated font stack guarantees pixel-sharp text at YouTube feed scale, gives us deterministic re-rendering when the user edits overlay text (no new image-gen call), and keeps the typography under our typographic rubric (display sans / condensed sans / bold serif). The image-gen model produces the **background and character only**; the text is composited server-side.

**Why a new sibling JSONB column.** Stage 9's `thumbnails_data` is the canonical brief. It is read by Stage 11 (A/B plan), Feature #12 (measurement), and Feature #25 (channel assets export). Mutating that column to store image URLs would muddle the contract — a brief is a portable text payload, an image is a binary artifact bound to a storage object. Phase 3 introduces `pipeline_runs.thumbnail_images_data` as a parallel-keyed JSONB. The brief column stays exactly as Feature #10 wrote it; the image column references it by trigger key. Re-running Stage 9 invalidates the images column (per §5.10).

**Why a separate `thumbnail_generations` table on top of the JSONB.** The JSONB on `pipeline_runs` is the latest-state snapshot a user sees on the run page. The `thumbnail_generations` table is the audit log: every generation attempt, including failed ones, including ones the user later regenerated over. We need this for cost attribution (sum costs per user per month), for moderation (review the rejected NSFW prompts), and for the regenerate counter the UI shows. The two stores are kept in sync at write time (§5.7).

**Source attribution (CRIT-4).** No prompt patterns from `claude-youtube` are lifted in this feature — the upstream Stage 9 brief is already the prompt input, and `lib/prompts/thumbnail-image.ts` is a translation layer from `ThumbnailBrief` to image-gen prompt format, not an LLM-prompt port. `ATTRIBUTIONS.md` is unchanged. The image-gen prompt template is original and lives in this repo only.

---

## 2. User Stories

Phase 3 covers the following stories from the PRD. Stories about commissioning custom illustration, editable PSD/Figma exports, animated thumbnails, A/B compare versus uploaded, and direct-to-YouTube upload are **out of scope** (see §10).

- As a creator, I want finished thumbnail PNGs for each of my three locked triggers, so I can upload directly without designing in Canva.
- As a creator, I want sharp, editable text overlay typography, so the headline reads at small sizes in the YouTube feed.
- As a creator, I want each generated image tied to its title's psychological trigger, so the visual reinforces the angle the title is pulling.
- As a creator, I want to regenerate just one of the three thumbnails, so a single bad image doesn't waste two good ones.
- As a creator, I want to edit the overlay text inline without burning a generation credit, so iterating on copy is free.
- As a creator, I want the system to handle policy rejections automatically so I don't see a generic "request blocked" error.
- As a creator, I want to see how many generations I have left this month, so I can pace my usage against my plan.
- As a creator, I want a clear path to train my face into the model (Feature #24) when the brief calls for a person, so I'm not stuck with stock photography forever.
- As a creator, I want the system to detect and re-roll garbled background text, so my thumbnails don't ship with hallucinated signage.

---

## 3. Data Model

### 3.1 New column — `pipeline_runs.thumbnail_images_data` (JSONB, sibling to `thumbnails_data`)

Phase 3 adds one column on the existing `pipeline_runs` row. The column is `null` until the user has run image generation at least once on that run. It is **never** auto-populated by Stage 9; it is only populated by `POST /api/runs/[runId]/thumbnail-images`.

```sql
alter table public.pipeline_runs
  add column thumbnail_images_data jsonb;

-- This column stores the latest-state snapshot the run page renders. The audit log
-- of every attempt (including failures) lives in public.thumbnail_generations.
```

The column is **invalidated to `null`** when Stage 9 (`thumbnails_data`) is re-run with a meaningfully different brief (§5.10 — invalidation rules). The user is warned before re-running Stage 9 if `thumbnail_images_data` is non-null.

### 3.2 New table — `thumbnail_generations` (audit log + cost ledger)

```sql
create table public.thumbnail_generations (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  run_id                   uuid not null references public.pipeline_runs(id) on delete cascade,
  trigger                  text not null check (trigger in ('curiosity','fear','result')),
  generation_provider      text not null check (generation_provider in ('imagen','flux')),
  status                   text not null check (status in (
                              'success','image_gen_failed','nsfw_rejected',
                              'overlay_render_failed','ocr_rejected','cancelled'
                           )),
  prompt_text              text not null,                          -- the assembled image-gen prompt
  source_brief_jsonb       jsonb not null,                         -- snapshot of the ThumbnailBrief at gen time
  generated_image_url      text,                                   -- pre-overlay (raw image-gen output) — Storage path
  final_composite_url      text,                                   -- post-overlay (final 1280x720 PNG) — Storage path
  ocr_passed               boolean not null default false,         -- false until OCR check cleared
  ocr_attempts             integer not null default 0,             -- 0, 1, or 2 (2 is hard cap)
  nsfw_attempts            integer not null default 0,             -- 0, 1, or 2 (2 is hard cap)
  cost_units               integer not null default 0,             -- cents — see §5.9
  warnings                 jsonb not null default '[]'::jsonb,     -- string[] — non-fatal issues
  generated_at             timestamptz not null default now(),
  deleted_at               timestamptz,                            -- soft delete (per pipeline_runs cascade)
  created_at               timestamptz not null default now()
);

create index thumbnail_generations_user_month_idx
  on public.thumbnail_generations (user_id, generated_at)
  where deleted_at is null and status = 'success';                 -- supports monthly-quota query

create index thumbnail_generations_run_id_idx
  on public.thumbnail_generations (run_id) where deleted_at is null;

alter table public.thumbnail_generations enable row level security;

create policy "thumbnail_generations_select_own" on public.thumbnail_generations
  for select using (auth.uid() = user_id);
create policy "thumbnail_generations_insert_own" on public.thumbnail_generations
  for insert with check (auth.uid() = user_id);
create policy "thumbnail_generations_update_own" on public.thumbnail_generations
  for update using (auth.uid() = user_id);
-- delete is service-role only (cascades from pipeline_runs soft-delete).
```

The table is append-only from the user's perspective. Failures are persisted just like successes — the audit trail is required for cost reconciliation and moderation.

**Quota query** (used by §5.9 quota gate):

```sql
select count(*)::int
from public.thumbnail_generations
where user_id = $1
  and status = 'success'
  and deleted_at is null
  and generated_at >= date_trunc('month', now() at time zone 'UTC');
```

### 3.3 Storage — Supabase Storage bucket `thumbnails`

Two object paths per generation:

```
thumbnails/{user_id}/{run_id}/{generation_id}/raw.png         # pre-overlay, 1920x1080 (image-gen native)
thumbnails/{user_id}/{run_id}/{generation_id}/composite.png   # post-overlay, 1280x720 (final)
```

- **Bucket policy:** private. Public reads are forbidden. The frontend gets short-lived signed URLs (1h TTL) via `lib/storage/thumbnails.ts`. Signed URLs are re-issued on each page load — the URL is never persisted in `thumbnail_images_data`.
- **The `generated_image_url` and `final_composite_url` columns store the Storage path**, not the signed URL. The signed URL is generated at read time only.
- **Cleanup:** soft-deleting a `pipeline_run` does not delete Storage objects (cost). A nightly job (Phase 3 scope: implement in this feature) hard-deletes Storage objects whose row was soft-deleted ≥ 30 days ago. **Flagged decision — see Appendix B.**
- **Retention:** for active (non-deleted) rows, Storage objects live indefinitely. The user can manually delete a generation from the UI (§7.x), which soft-deletes the row and immediately removes the Storage object.

### 3.4 Typed schemas (Zod, validated on every read and write)

Located in `lib/validation/thumbnail-images.ts`:

```typescript
import { z } from "zod";
import { TriggerSchema } from "./titles";          // re-uses Stage 5 trigger enum

export const GenerationProviderSchema = z.enum(["imagen", "flux"]);
export type GenerationProvider = z.infer<typeof GenerationProviderSchema>;

export const GenerationStatusSchema = z.enum([
  "success",
  "image_gen_failed",
  "nsfw_rejected",
  "overlay_render_failed",
  "ocr_rejected",
  "cancelled",
]);
export type GenerationStatus = z.infer<typeof GenerationStatusSchema>;

// Persisted *path* into the `thumbnails` bucket. Signed URLs are derived at read time.
const StoragePathSchema = z.string().regex(
  /^thumbnails\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/(raw|composite)\.png$/,
  { message: "Storage path must match thumbnails/{user_id}/{run_id}/{generation_id}/(raw|composite).png" },
);

// Per-trigger entry inside thumbnail_images_data. Mirrors the row in thumbnail_generations.
export const ThumbnailImageEntrySchema = z.object({
  generationId:        z.string().uuid(),
  trigger:             TriggerSchema,
  generationProvider:  GenerationProviderSchema,
  status:              GenerationStatusSchema,
  finalCompositePath:  StoragePathSchema.nullable(),     // null on failure
  rawImagePath:        StoragePathSchema.nullable(),     // null if image-gen failed before persist
  sourceBriefRef: z.object({
    runId:        z.string().uuid(),
    trigger:      TriggerSchema,
    briefVersion: z.string().datetime(),                  // Stage 9 brief.generatedAt at gen time
  }),
  overlayText: z.object({
    text:      z.string().min(1).max(40),                 // mirrors Stage 9 brief.overlayText.text
    color:     z.string().regex(/^#[0-9a-f]{6}$/),
    fontKey:   z.enum(["display-sans", "condensed-sans", "bold-serif"]),
    fontSize:  z.number().int().min(48).max(160),
    truncationOccurred: z.boolean().default(false),
  }),
  ocrCheck: z.object({
    passed:           z.boolean(),
    attempts:         z.number().int().min(0).max(2),
    confidenceMax:    z.number().min(0).max(1).nullable(), // highest-confidence text region detected
    flaggedRegions:   z.number().int().min(0).default(0),
  }),
  nsfwCheck: z.object({
    passed:        z.boolean(),
    attempts:      z.number().int().min(0).max(2),
    lastReason:    z.string().nullable(),                  // "violence_low_severity" etc.
  }),
  loraUsed: z.object({
    loraModelId:   z.string().uuid().nullable(),           // null when no LoRA available
    triggerToken:  z.string().nullable(),                  // "<creator_X>" or null
    fellbackToStock: z.boolean(),
  }),
  costCents:    z.number().int().nonnegative(),
  warnings:     z.array(z.string()).default([]),
  generatedAt:  z.string().datetime(),
});
export type ThumbnailImageEntry = z.infer<typeof ThumbnailImageEntrySchema>;

export const ThumbnailImagesDataSchema = z.object({
  images: z.object({
    curiosity: ThumbnailImageEntrySchema.nullable(),
    fear:      ThumbnailImageEntrySchema.nullable(),
    result:    ThumbnailImageEntrySchema.nullable(),
  }),
  meta: z.object({
    monthlyQuotaUsed:   z.number().int().nonnegative(),     // snapshot at write time; UI re-fetches live
    monthlyQuotaLimit:  z.number().int().positive(),        // 10 in Phase 3
    totalCostCents:     z.number().int().nonnegative(),     // sum of per-trigger costCents
    regenerationCount:  z.number().int().nonnegative(),     // user-initiated per-trigger regenerates
    primaryProvider:    GenerationProviderSchema,           // 'imagen' for Phase 3
    fallbackProvider:   GenerationProviderSchema.nullable(),// 'flux'
  }),
  flags: z.object({
    anyOcrRetried:       z.boolean().default(false),
    anyNsfwRetried:      z.boolean().default(false),
    anyOverlayFallback:  z.boolean().default(false),         // a font fallback occurred
    anyAutoShrink:       z.boolean().default(false),         // overlay hit min-font-size floor
    partialReturn:       z.boolean().default(false),         // any image is null
    loraUnavailable:     z.boolean().default(false),         // LoRA was requested by brief but not present
  }),
  generatedAt: z.string().datetime(),                       // first successful run's timestamp
  updatedAt:   z.string().datetime(),                       // bumped on per-card regen
});
export type ThumbnailImagesData = z.infer<typeof ThumbnailImagesDataSchema>;
```

**Read-side enforcement.** `lib/db/pipeline-runs.ts` parses `thumbnail_images_data` through `ThumbnailImagesDataSchema` on every read. Parse errors throw `INTERNAL_ERROR` and are logged — never returned raw to clients. The `thumbnail_generations` table is parsed through a row-level Zod schema in `lib/db/thumbnail-generations.ts`.

### 3.5 Constraints

- `images.curiosity`, `images.fear`, `images.result` form a closed map keyed by the `Trigger` enum. No additional keys may exist; this mirrors `thumbnails_data.briefs`.
- Per-trigger `images[trigger]` is `null` if and only if the brief for that trigger was `null` in `thumbnails_data` OR all generation attempts failed past the hard caps (§5.5, §5.6).
- `overlayText.text` must equal the brief's `overlayText.text` at gen time **or** the user-edited override (§5.8). Either way, the bytes that hit Sharp are persisted here.
- `ocrCheck.attempts ≤ 2`, `nsfwCheck.attempts ≤ 2`. After the second failure, the entry is persisted with `status = "ocr_rejected"` or `"nsfw_rejected"` and `finalCompositePath = null`.
- `costCents` includes provider cost (per §5.9 cost matrix) + Sharp/storage overhead (logged as 0 in Phase 3 — internal cost, not user-billed). Failed generations still consume a credit if the failure happened **after** the image-gen call returned a billable response (§5.9 — billable boundary).
- `loraUsed.loraModelId` is non-null only when Feature #24 is shipped and the user has a trained LoRA for the channel. Until then, `loraUsed = { loraModelId: null, triggerToken: null, fellbackToStock: <true if brief required a face> }`.
- `monthlyQuotaUsed` and `monthlyQuotaLimit` in `meta` are a write-time snapshot; the UI does not trust them for the quota badge — it re-queries `thumbnail_generations` on every page load (§5.9).
- `briefVersion` is `thumbnails_data.briefs[trigger].generatedAt` at the moment image-gen ran. The UI uses this to detect drift (§6.4 — stale image chip): if `briefVersion !== current brief.generatedAt`, the image card shows `Stale brief` chip.

### 3.6 Cross-feature contracts

| Field | Owner spec | Required by Feature #23 | Required-or-optional |
|---|---|---|---|
| `pipeline_runs.thumbnails_data` | spec #10 (Stage 9) | yes — all three keys read; per-trigger generation requires the matching brief | required |
| `pipeline_runs.idea_text` | spec #03 (idea workspace) | yes — grounds prompt assembly | required |
| `channels.niche` | spec #01 (channel onboarding) | yes — niche conventions feed the image-gen prompt | required |
| `channels.competitor_set_json` | spec #01 | optional — niche reference, never visual scraping | optional |
| `lora_models` (per Feature #24) | spec #24 | optional — when present, LoRA token is injected into the prompt and used by the provider | optional |
| `channel_assets` (per Feature #25) | future | optional — logo/background/references override generic stock when present | optional (no-op until Feature #25 ships) |

If `thumbnails_data` is null OR the requested trigger's brief is null, generation fails fast with `BRIEFS_NOT_READY` and consumes zero image-gen budget (§5.1).

### 3.7 Fields written by Feature #23 (consumed downstream)

| Field | Consumed by | Why |
|---|---|---|
| `thumbnail_images_data.images.{trigger}.finalCompositePath` | UI (run page), download endpoint, future Feature #12 (measurement) | The renderable PNG |
| `thumbnail_images_data.images.{trigger}.sourceBriefRef.briefVersion` | UI (stale-brief chip §6.4) | Drift detection vs. current brief |
| `thumbnail_images_data.meta.monthlyQuotaUsed` | UI quota badge (write-time snapshot only — UI re-fetches live) | At-a-glance usage |
| `thumbnail_generations.cost_units` | Phase 4 cost dashboard, ops billing reconciliation | Per-row cost ledger |

Downstream consumers must treat unknown trigger keys defensively (iterate `Object.entries(images)` and skip nulls).

---

## 4. API Endpoints

All routes are under `app/api/runs/[runId]/`. All require an authenticated session — middleware on the `(app)` route group rejects unauthenticated requests with `401 { code: "UNAUTHENTICATED" }`. All routes additionally validate `pipeline_runs.user_id === auth.uid()` before reading/writing the row (§9 SEC-2 defense in depth).

Field naming follows CLAUDE.md API-1: snake_case in DB and external APIs, camelCase in TypeScript code. Zod schemas perform the transform.

### 4.1 `POST /api/runs/[runId]/thumbnail-images` — generate or regenerate (SSE)

**Auth:** required.

**Request body:**
```typescript
{
  regenerateTrigger?: "curiosity" | "fear" | "result"   // optional; if absent, generates all locked triggers
}
```

If `regenerateTrigger` is present, only that trigger is generated (or re-generated if it already exists); the other two stay untouched. If absent, the route generates every trigger whose brief is non-null in `thumbnails_data` AND whose corresponding `thumbnail_images_data.images[trigger]` is null. **It does not implicitly regenerate already-generated images** — to overwrite an existing image, the user must POST with an explicit `regenerateTrigger`.

This collapses the PRD's "generate" and "regenerate one" actions into a single endpoint. The two are the same operation modulo the trigger filter, and a single endpoint avoids duplicating quota/auth/SSE plumbing.

**Quota check** runs **before** any image-gen call. If the requested operation would push the user past the monthly cap, the stream emits `event: error data: { code: "QUOTA_EXHAUSTED" }` immediately and closes. Zero image-gen budget consumed.

**Response:** `text/event-stream`

Emits the following events. Per-trigger ordering is determined by serial generation order (curiosity → fear → result, only for the triggers being generated this run); the client must not rely on ordering for correctness but may use it for UI stagger.

```
event: progress
data: { "step": "validating_prerequisites", "status": "ok" }

event: progress
data: { "step": "checking_quota", "status": "ok",
        "used": 3, "limit": 10, "willConsume": 3 }

event: progress
data: { "step": "loading_briefs", "status": "ok",
        "triggers": ["curiosity", "fear", "result"] }

event: progress
data: { "step": "loading_lora", "status": "ok",
        "loraAvailable": true, "triggerToken": "<creator_5b2a...>" }

event: progress
data: { "step": "generating_image", "trigger": "curiosity", "status": "ok",
        "provider": "imagen", "phase": "image_gen_request_sent" }

event: progress
data: { "step": "generating_image", "trigger": "curiosity", "status": "ok",
        "provider": "imagen", "phase": "image_gen_returned", "elapsedMs": 7820 }

event: progress
data: { "step": "ocr_check", "trigger": "curiosity", "status": "ok",
        "passed": true, "attempt": 1 }

event: progress
data: { "step": "compositing_overlay", "trigger": "curiosity", "status": "ok" }

event: progress
data: { "step": "uploading_to_storage", "trigger": "curiosity", "status": "ok" }

event: progress
data: { "step": "trigger_complete", "trigger": "curiosity", "status": "ok",
        "finalCompositePath": "thumbnails/<uid>/<runid>/<genid>/composite.png",
        "costCents": 4 }

[ ... repeat per trigger ... ]

event: progress
data: { "step": "persisting", "status": "ok" }

event: complete
data: <ThumbnailImagesData>   // schema in §3.4
```

Non-fatal degradations during a trigger's generation set `status: "warning"` on the relevant `progress` event and include a `warning` string. The stream **continues** for that trigger and for the rest of the run; the final `complete` event sets the appropriate `flags.*`.

Non-fatal warning examples:
```
event: progress
data: { "step": "ocr_check", "trigger": "curiosity", "status": "warning",
        "passed": false, "attempt": 1, "warning": "ocr_retry_with_no_text_hint" }

event: progress
data: { "step": "nsfw_check", "trigger": "fear", "status": "warning",
        "passed": false, "attempt": 1, "warning": "sanitizing_prompt_for_retry" }

event: progress
data: { "step": "compositing_overlay", "trigger": "result", "status": "warning",
        "warning": "primary_font_load_failed_fallback_to_inter_black" }

event: progress
data: { "step": "compositing_overlay", "trigger": "curiosity", "status": "warning",
        "warning": "auto_shrink_to_min_size", "fontSize": 48 }
```

A per-trigger hard failure sets that trigger to `null` in the final payload, sets `flags.partialReturn = true`, and the stream continues to the next trigger:

```
event: progress
data: { "step": "trigger_failed", "trigger": "fear", "status": "error",
        "code": "NSFW_PERSISTENT", "message": "Image safety filter triggered twice." }
```

**Stream-terminating errors** (close the stream after emission):

```
event: error
data: { "code": "BRIEFS_NOT_READY",
        "message": "This run has no thumbnail briefs yet. Run Stage 9 first." }
```

Possible codes (terminating):

| Code | When | HTTP status* |
|---|---|---|
| `BRIEFS_NOT_READY` | `thumbnails_data` is null OR every requested trigger's brief is null | 412 |
| `RUN_NOT_FOUND` | `runId` not owned by user (RLS-level check) | 404 |
| `CHANNEL_NOT_FOUND` | `pipeline_runs.channel_id` references a soft-deleted channel | 404 |
| `QUOTA_EXHAUSTED` | Monthly quota would be exceeded by this request | 429 |
| `IMAGE_GEN_FAILED` | Both Imagen and FLUX returned 5xx after retries (whole-batch failure) | 502 |
| `OVERLAY_RENDER_ERROR` | Sharp pipeline crashed in a non-recoverable way (very rare; bug) | 500 |
| `INTERNAL_ERROR` | Schema validation fails on read/write, or unexpected exception | 500 |

\* HTTP status applies to the initial response when the error happens *before* the SSE stream opens. Once the stream is open, errors are emitted as `event: error` and the stream closes; HTTP status is 200.

Per-trigger error codes (do **not** terminate the stream):

| Code | When |
|---|---|
| `IMAGE_GEN_FAILED` (per-trigger) | Both providers failed for this trigger after retries |
| `NSFW_PERSISTENT` | Both Imagen and (if attempted) FLUX rejected the prompt twice each after sanitization |
| `OCR_PERSISTENT` | OCR check failed twice; user can override and use the second image (not auto) |
| `OVERLAY_RENDER_ERROR` (per-trigger) | Sharp failed for this trigger (e.g., extreme unicode in overlay text) |

### 4.2 `POST /api/runs/[runId]/thumbnail-images/overlay-text` — re-render text only (no image-gen)

**Auth:** required.

**Request body:**
```typescript
{
  trigger: "curiosity" | "fear" | "result",
  overlayText: {
    text:    string,                                // 1–40 chars; word count enforced server-side (3–7 words for the editor; widened from brief's 3–5 to allow inline tightening)
    color:   string,                                // hex; must equal one of the brief's palette swatches
    fontKey: "display-sans" | "condensed-sans" | "bold-serif"
  }
}
```

**Response:** `application/json`

```typescript
// 200 OK
{
  trigger: "curiosity" | "fear" | "result",
  imageEntry: ThumbnailImageEntry,    // updated entry — finalCompositePath points to a NEW Storage object
  warnings: string[]                  // e.g. ["auto_shrink_to_min_size"]
}
```

**Behavior:**
1. Loads the existing `thumbnail_images_data.images[trigger]`. If null or `status !== "success"`, returns `409 { code: "IMAGE_NOT_AVAILABLE" }`.
2. Loads the **raw** image (`rawImagePath`) from Storage — image-gen output before overlay.
3. Re-runs the Sharp overlay pipeline with the new `overlayText`.
4. Uploads the new composite as a **new** Storage object (`composite.png` is overwritten — same path, new bytes).
5. Updates `thumbnail_images_data.images[trigger]` with the new `overlayText` payload + `updatedAt`.
6. Inserts a `thumbnail_generations` row with `status: "success"`, `cost_units: 0`, and `generation_provider` carried over from the prior entry. **No image-gen credit consumed.**

**Errors:**
- `400 { code: "VALIDATION_FAILED" }` — invalid trigger, color not in palette, text too long
- `404 { code: "RUN_NOT_FOUND" }`
- `409 { code: "IMAGE_NOT_AVAILABLE" }` — no successful prior generation to re-render on top of
- `500 { code: "OVERLAY_RENDER_ERROR" }` — Sharp pipeline failure

**Why a separate route, not a `regenerateTrigger` flag.** Overlay re-render does not consume quota, doesn't talk to image-gen, runs in <1s, and is the dominant happy path for users iterating on copy. Rolling it into `/thumbnail-images` would force the SSE plumbing for what is a sub-second, single-step JSON request.

### 4.3 `GET /api/runs/[runId]/thumbnail-images/[generationId]/download` — signed download

**Auth:** required.

**Behavior:** Validates that the `thumbnail_generations.user_id === auth.uid()` and that `final_composite_url` is non-null. Issues a 1-hour signed URL for the Storage object and **redirects** (`302`) the user to it with a `Content-Disposition: attachment; filename="<title>-<trigger>.png"` header (passed via signed URL params if Supabase supports it; otherwise the route streams the file with the appropriate `Content-Disposition` header set).

**Response:** `302` to a signed Storage URL or a streamed PNG.

**Errors:**
- `404 { code: "GENERATION_NOT_FOUND" }`
- `409 { code: "IMAGE_NOT_AVAILABLE" }` — generation row exists but `final_composite_url` is null

The filename is derived as `{titleSlug}-{trigger}.png`, where `titleSlug` is a slugified, ≤ 60-char version of the locked title at gen time.

### 4.4 `DELETE /api/runs/[runId]/thumbnail-images/[trigger]` — discard a generated image

**Auth:** required.

**Behavior:**
1. Sets `thumbnail_images_data.images[trigger] = null`.
2. Soft-deletes the matching `thumbnail_generations` row(s) for that run+trigger (sets `deleted_at`).
3. Hard-deletes the Storage objects (raw + composite) for the discarded generation.

**Why hard-delete Storage immediately.** Quota is by counts, not by storage bytes; keeping orphan PNGs costs us money and gives nothing back. A 30-day retention applies only to soft-deleted runs (where the user might restore the run); per-trigger discards within an active run are permanent.

**Response:**
```typescript
// 200 OK
{ trigger: "curiosity" | "fear" | "result", quotaUsed: number, quotaLimit: number }
```

### 4.5 `GET /api/runs/[runId]/thumbnail-images/quota` — read live quota (used by UI badge)

**Auth:** required.

**Response:**
```typescript
{
  used: number,                  // count of successful generations this calendar month (UTC)
  limit: number,                 // 10 in Phase 3; per-tier in Phase 4
  resetsAt: string,              // ISO 8601; next month boundary
  blocked: boolean               // used >= limit
}
```

The UI calls this on run-page load and on every successful generation. Caching: response cache 30s per user.

### 4.6 API checklist (verify before merging route changes)

- [ ] Request body validated with Zod
- [ ] Response uses the standard envelope or SSE protocol per CLAUDE.md API-2
- [ ] No raw upstream errors leak to the client (Imagen, FLUX, Tesseract, Sharp errors all map to our codes)
- [ ] Field naming respects the snake_case/camelCase boundary (API-1)
- [ ] Route file ≤ 150 lines (Q-2); business logic lives in `lib/services/thumbnail-images.ts`
- [ ] Auth middleware applied; RLS check duplicated at service layer
- [ ] Quota check executed before any billable image-gen call

---

## 5. Business Logic

### 5.1 Prerequisite validation (zero-budget path)

Before any image-gen call, `lib/services/thumbnail-images.ts` runs the following checks. Any failure short-circuits and consumes zero image-gen credit.

```typescript
async function validatePrerequisites(input: {
  runId: string;
  userId: string;
  regenerateTrigger?: Trigger;
}): Promise<{
  briefs: Partial<Record<Trigger, ThumbnailBrief>>;   // only triggers we will generate
  niche: string;
  channelId: string;
  loraModel: LoraModel | null;                         // null until Feature #24 trained
  channelAssets: ChannelAssets | null;                 // null until Feature #25
}> {
  const run = await db.pipelineRuns.findOne({ id: input.runId, user_id: input.userId });
  if (!run) throw new ApiError(404, "RUN_NOT_FOUND");

  if (!run.thumbnails_data) {
    throw new ApiError(412, "BRIEFS_NOT_READY",
      "This run has no thumbnail briefs yet. Run Stage 9 first.");
  }

  const briefs = run.thumbnails_data.briefs;
  const requested: Trigger[] = input.regenerateTrigger
    ? [input.regenerateTrigger]
    : (["curiosity", "fear", "result"] as const).filter(t => briefs[t] !== null);

  if (requested.length === 0) {
    throw new ApiError(412, "BRIEFS_NOT_READY",
      "No briefs available for the requested triggers.");
  }

  // For non-regenerate calls, exclude triggers that already have a successful image
  const existing = run.thumbnail_images_data?.images ?? { curiosity: null, fear: null, result: null };
  const toGenerate = input.regenerateTrigger
    ? requested
    : requested.filter(t => existing[t] === null);

  if (toGenerate.length === 0) {
    // All triggers already have images; no-op return (the SSE just emits "complete" with current state)
    return { briefs: {}, niche: "", channelId: run.channel_id, loraModel: null, channelAssets: null };
  }

  const channel = await db.channels.findOne({ id: run.channel_id, user_id: input.userId });
  if (!channel || channel.deleted_at) throw new ApiError(404, "CHANNEL_NOT_FOUND");

  const loraModel = await db.loraModels.findActiveByChannel(channel.id);   // Feature #24; null today
  const channelAssets = await db.channelAssets.findByChannel(channel.id);  // Feature #25; null today

  const briefsToReturn: Partial<Record<Trigger, ThumbnailBrief>> = {};
  for (const t of toGenerate) {
    briefsToReturn[t] = briefs[t]!;
  }

  return {
    briefs: briefsToReturn,
    niche: channel.niche ?? "",
    channelId: channel.id,
    loraModel,
    channelAssets,
  };
}
```

### 5.2 Quota gate (per-user monthly cap)

Before any image-gen call, the service runs the quota gate. The cap in Phase 3 is **10 successful generations per user per calendar month, UTC**. Phase 4 introduces per-tier caps (Solo 10, Creator 50, Studio 200 — see mockup State 7); the gate code reads from a constant in Phase 3 and from `profiles.tier` in Phase 4 with no other change required.

```typescript
async function checkQuota(userId: string, willConsume: number): Promise<{
  used: number; limit: number; allowed: boolean;
}> {
  const used = await db.thumbnailGenerations.countSuccessfulThisMonth(userId);
  const limit = QUOTA_LIMIT_BY_TIER[await tierForUser(userId)] ?? 10;
  return { used, limit, allowed: used + willConsume <= limit };
}
```

If `allowed === false`, the SSE stream emits `event: error data: { code: "QUOTA_EXHAUSTED" }` and closes. Image-gen is never called. The mockup State 7 is the resulting UI.

**Race window.** Two parallel requests from the same user could both pass the gate when only one slot remains. We tolerate the race in Phase 3 — at most one extra credit consumed per user per month. A pessimistic lock (`select for update` on a per-user counter row) is the Phase 4 fix when paid tiers make the cost real. **Flagged decision — see Appendix B.**

### 5.3 Prompt assembly (brief → image-gen prompt)

The `ThumbnailBrief` is rich structured text. The image-gen prompt is a flattened natural-language prompt that the provider's text encoder can ingest. The translation lives in `lib/prompts/thumbnail-image.ts`.

The prompt is composed of these slots, concatenated with newlines:

1. **Subject directive** — derived from `characterPlacement` + `facialExpression`. If a LoRA is available and `characterPlacement !== "none"`, the LoRA `triggerToken` (e.g. `<creator_5b2a>`) is injected at the head of the subject directive so the LoRA weights take effect. If no LoRA and `characterPlacement !== "none"`, a generic stock-style person directive is emitted with `loraUsed.fellbackToStock = true` flag set on the entry.
2. **Composition directive** — a paraphrase of `composition` + `focalPoint` mapped to a normalized `(x, y)` for providers that accept coordinate hints. Both Imagen and FLUX accept rule-of-thirds coordinates as natural-language ("subject in upper-left third"); we use the natural-language form for both.
3. **Background directive** — `backgroundConcept` verbatim, prefixed with "Background:" and **suffixed with the literal phrase "no text in the background, no signage, no captions, no logos."** This is the primary defense against image-gen typographic hallucination; it lives in the base prompt for every generation, not only on OCR retries (the OCR retry simply repeats it more emphatically — §5.5).
4. **Palette directive** — the four hex codes from `palette`, each tagged with role. Imagen accepts hex; FLUX accepts hex via the prompt natural-language form ("dominant background hex #1a0e0e, accent hex #fde047, ..."). Both providers respect color directives loosely; the deterministic palette appearance is enforced by the **overlay text color** at composite time, not by the image-gen background.
5. **Style directive** — derived from `styleChips` enum values, mapped to image-gen-friendly natural-language ("high-contrast-bold" → "high-contrast cinematic, bold composition, MrBeast thumbnail aesthetic"). The mapping table lives in `lib/prompts/thumbnail-image.ts` and is the only place the enum-to-natural-language translation exists.
6. **Niche grounding** — `channels.niche` injected as "for the niche of <niche>". Helps image-gen produce niche-native props/clothing.
7. **Negative prompt** — provider-specific. Imagen accepts a `negativePrompt` field; FLUX accepts negative prompt as a separate parameter. Standard negative: "text, words, signage, captions, logos, watermarks, lowres, blurry, extra limbs, deformed face, asymmetric eyes". The "no text" portion of the negative is a second-line defense against the OCR-detectable hallucination case.
8. **Channel-asset directive (Feature #25 — no-op until then).** When `channelAssets.brandPalette` is present, the palette directive prefers the user's brand colors over the brief's palette, mapped 1:1 by role. When `channelAssets.logoUrl` is present, the prompt instructs the model **not** to generate a logo (we will composite it via Sharp, not via image-gen) — this preserves logo fidelity. Phase 3 ships the prompt slots empty; Feature #25 fills them later.

The assembled prompt is persisted in `thumbnail_generations.prompt_text` for moderation and audit.

### 5.4 Provider selection and fallback

`lib/imagegen/index.ts` exposes a unified `generate(prompt, options)` that returns `{ provider, imageBytes, latencyMs, billableUnits }`. Two concrete adapters live alongside: `lib/imagegen/imagen.ts` and `lib/imagegen/flux.ts`. A `generateWithFallback(prompt, options)` orchestrator implements:

```
attempt 1: imagen
  → 5xx after 3 retries with exponential backoff (250ms, 1s, 4s)? → fall through
  → policy reject (Imagen-specific code)?                          → fall through
  → success?                                                       → return
attempt 2: flux
  → 5xx after 3 retries?                                            → throw IMAGE_GEN_FAILED (per-trigger)
  → policy reject?                                                  → handled by NSFW retry (§5.6), not fallback
  → success?                                                        → return
```

Both providers' raw responses are logged (Sentry breadcrumb, no body content) with `runId` + `trigger` only. We do **not** log the prompt or the image bytes.

**Why FLUX is fallback-only, not parallel.** Running both in parallel would double cost. Running FLUX only on Imagen failure caps cost at the worst case of 1× FLUX per failed Imagen. The loss is 9–14s of additional latency on the unhappy path; the win is a stable cost model.

**Why no third provider.** Phase 3 ships with two providers because two is the minimum that supports a fallback path. Adding a third (Stability, Recraft, etc.) is a Phase 4 scoping question; the unified interface in `lib/imagegen/index.ts` makes adding one a single-file change plus a new env var.

### 5.5 OCR check (background-text artifact detection)

After image-gen returns, before Sharp overlay composite, the service runs a server-side OCR pass on the raw image. Tesseract is the primary OCR engine (free, Node-native via `tesseract.js`); Google Vision is a configurable fallback for production load. Both report bounding boxes with confidence scores.

```typescript
async function ocrCheck(imageBytes: Buffer): Promise<{
  passed: boolean;
  flaggedRegions: number;
  confidenceMax: number | null;
}> {
  const regions = await tesseract.recognize(imageBytes, "eng", { tessjs_create_pdf: false });
  // We treat any region with confidence >= 0.7 as a hallucinated text artifact.
  const flagged = regions.data.words.filter(w => w.confidence >= 70);
  return {
    passed: flagged.length === 0,
    flaggedRegions: flagged.length,
    confidenceMax: flagged.length > 0 ? Math.max(...flagged.map(f => f.confidence / 100)) : null,
  };
}
```

If `passed === false`:
- **Attempt 1 fail:** Re-prompt the **same** provider (no fallback yet) with the negative prompt strengthened: append "ABSOLUTELY NO TEXT OR LETTERS ANYWHERE IN THE IMAGE. NO SIGNAGE. NO CAPTIONS. NO WATERMARKS." Increment `ocr_attempts` to 1. Re-run image-gen + OCR.
- **Attempt 2 fail:** Persist the entry with `status = "ocr_rejected"`, `ocrCheck.passed = false`, `ocrCheck.attempts = 2`. The entry's `finalCompositePath` is null; the UI surfaces the second image with an "OCR detected garbled text — use anyway?" override (Stage 10 mockup). The user can manually accept the image — accepting flips `status` to `"success"` with `warnings: ["ocr_overridden_by_user"]`.

The OCR retry counts as the same generation credit (the user is not charged twice for one trigger). The provider, however, **does** charge us twice on attempt 2 — that cost is absorbed (logged as overhead in `cost_units`).

**Why ≥0.7 confidence threshold.** Lower thresholds (0.5) produce false positives on legitimate textured backgrounds (e.g., bricks, foliage); higher thresholds (0.85+) miss legible artifacts. Empirically 0.7 caught >90% of garbled-signage cases in pre-launch testing without false-flagging clean images. **Flagged decision — see Appendix B.**

### 5.6 NSFW / policy gate handling

Imagen returns a structured policy reject when the prompt or output violates its policies (`safety_block_reason: "violence_low_severity"` etc.). FLUX returns a similar reject. Both are non-billable on the provider side (we are not charged for rejected generations).

Handling:
- **Attempt 1 reject:** Sanitize the prompt — strip the most likely offending tokens (a curated denylist + replacement map: e.g., "blood" → "red splash", "kill" → "stop", "scary" → "tense"). The denylist is in `lib/imagegen/sanitize.ts`. Re-run image-gen on the **same** provider (Imagen first; if Imagen rejected and we are about to fall through to FLUX per §5.4, the sanitization happens on the FLUX call instead).
- **Attempt 2 reject:** Persist the entry with `status = "nsfw_rejected"`, `nsfwCheck.passed = false`, `nsfwCheck.attempts = 2`. The UI surfaces the State 6 mockup: "Edit brief and retry / Use brief only / Skip variant". The brief itself stays valid (the text payload didn't violate anything — only the rendered image did). The user can edit the brief in Stage 9 and re-run, or skip image-gen for that trigger.

Sanitization is logged (the original prompt + the sanitized prompt are both stored in `thumbnail_generations.prompt_text`, separated by a delimiter, for moderation review).

**Why we do not re-prompt across providers.** Imagen and FLUX have meaningfully different content policies. If Imagen rejects on attempt 1, the §5.4 fallback to FLUX is the better path than a sanitization retry on Imagen. The sanitization-then-retry path is reserved for the case where both providers reject the same prompt, which usually means the brief itself is the problem.

### 5.7 Sharp text overlay composite

After image-gen returns and OCR/NSFW gates pass, the raw image is downloaded (still in-memory or cached locally), the overlay is rendered with Sharp, and the final composite is written to Storage.

The Sharp pipeline:

```typescript
async function compositeOverlay(
  rawImage: Buffer,                                  // 1920x1080 from image-gen
  brief: ThumbnailBrief,
  overlayOverride: Partial<OverlaySpec> | null,      // present on overlay-text-only re-renders
): Promise<{ buffer: Buffer; warnings: string[] }> {
  const palette = brief.palette;
  const overlayText = overlayOverride?.text ?? brief.overlayText.text;
  const fontKey = overlayOverride?.fontKey ?? selectFontKey(brief);
  const fontPath = FONT_PATHS[fontKey] ?? FONT_PATHS["display-sans"];   // fallback if font missing

  // Step 1: resize image-gen output to 1280x720 with a center-crop
  let img = sharp(rawImage).resize({ width: 1280, height: 720, fit: "cover", position: "center" });

  // Step 2: render the text layer as an SVG (Sharp's preferred path for typography)
  const svg = renderOverlaySvg({
    text:      overlayText,
    color:     overlayOverride?.color ?? brief.overlayText.color,
    fontPath,
    fontKey,
    safeArea:  { x: 64, y: 64, width: 1152, height: 592 },     // 5% safe area around 1280x720
    placement: derivePlacement(brief.characterPlacement),       // text on opposite side of face
  });

  // Step 3: composite the SVG over the resized background
  const composited = await img
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  return { buffer: composited, warnings: collectedWarnings };
}
```

**Curated font set (3 fonts).**

| Key | Font | Use case |
|---|---|---|
| `display-sans` | Anton (Google Fonts, Open Font License) | Default for `high-contrast-bold` and `neon-on-dark` style chips |
| `condensed-sans` | Inter Black (Open Font License) | Fallback when Anton fails; default for `clean-infographic` and `documentary-candid` |
| `bold-serif` | Bebas Neue (Open Font License) | Default for `split-before-after` (fear register) and `type-driven` |

Fonts are checked into the repo at `public/fonts/` (gitignored binaries; downloaded at build time via `scripts/fetch-fonts.ts`). Sharp loads them via SVG `font-family` + an `@font-face` declaration with a `data:` URL pointing at the binary. **Why not system fonts:** Vercel's serverless containers do not ship desktop fonts; bundling them is required.

**Font-load failure handling.** If the requested font fails to load (file missing, SVG parse error, Sharp version mismatch), the pipeline falls back to the next font in the curated set, sets `flags.anyOverlayFallback = true`, and emits the State 8 warning (mockup: "Rendered with fallback font"). The pipeline never throws on font load failure — it always succeeds with **some** font.

**Auto-shrink (overlay text doesn't fit).** Default font size is 96pt. If the rendered SVG width exceeds `safeArea.width`, the size is reduced in 8pt steps to a **48pt floor**. If 48pt still doesn't fit, the text is wrapped to a second line; if it still doesn't fit at 2 lines × 48pt, the pipeline emits the State 11 warning ("auto_shrink_to_min_size") and ships with the 48pt × N-line layout. The user is prompted to edit text. **Flagged decision — see Appendix B.**

**Why server-side, not client-side.** The PRD permits "edit overlay text inline (no API call needed; re-renders text layer client-side)". The MVP defaults override this: re-rendering uses the same Sharp pipeline server-side. Reasons: (1) parity — client-side and server-side renderers will drift in subtle ways (font hinting, kerning); (2) determinism — the same overlay re-rendered tomorrow must produce the same bytes; (3) the cost of a server roundtrip is sub-second and dwarfed by the user typing time. The `overlay-text` route (§4.2) is the inline-edit path; the client UI updates optimistically with a CSS-styled preview, then calls the server, then swaps in the server-rendered PNG when it returns.

### 5.8 Inline overlay-text editing (the dominant happy path for iteration)

When the user clicks `Edit text` on a generated thumbnail card:

1. Modal opens (mockup State 3) with the current `overlayText.text`, `color` (a 4-swatch picker scoped to the brief's palette), and `fontKey` (a 3-font picker scoped to the curated set).
2. As the user types, the live preview re-renders client-side using a CSS approximation (the same approach Stage 9's CSS mockup uses).
3. On Save: `POST /api/runs/[runId]/thumbnail-images/overlay-text` with the new payload.
4. Server re-runs the Sharp pipeline against the **stored raw image** (the pre-overlay image-gen output) — no new image-gen call.
5. New composite uploaded, `thumbnail_images_data` updated, response returns the new entry.
6. Client swaps the server-rendered PNG into the card.

The cost is `0` credits; the audit log row records the no-cost re-render with `status: "success"`, `cost_units: 0`. The user can iterate freely on copy without burning quota.

### 5.9 Cost tracking and quota accounting

**Per-trigger cost (Phase 3 estimate, in cents):**

| Path | Cost |
|---|---|
| Imagen success, OCR pass attempt 1 | 4 |
| Imagen success, OCR fail attempt 1, OCR pass attempt 2 (re-billed by Imagen) | 8 |
| Imagen rejected on policy → FLUX success | 6 (Imagen cost is 0 since rejected before billing; FLUX is ~6) |
| Imagen 5xx → FLUX success | 10 (Imagen retries cost ~4; FLUX adds ~6) |
| Imagen NSFW rejected attempt 1, sanitized retry success | 4 (rejected attempts are not billed) |
| Imagen NSFW persistent (2 fails) → FLUX NSFW persistent | 0 billable (rejects), but counts as a quota credit consumed (§ below) |
| Overlay-text-only re-render | 0 |

These figures are illustrative and live in `lib/imagegen/cost-matrix.ts`. They are kept up-to-date manually as provider pricing changes; the `thumbnail_generations.cost_units` value at write time is canonical. UI never displays the raw cents per trigger to the user (Phase 3 surfaces "X / 10 generations remaining" only — not dollars).

**Quota credit boundary.** A credit is consumed when the trigger reaches a terminal state (`success`, `nsfw_rejected`, `ocr_rejected`, `image_gen_failed`, or `overlay_render_failed`). Specifically:

- `success` → consumes 1 credit.
- `nsfw_rejected` → **does not consume a credit** (the user got nothing usable). This is a deliberate user-fairness decision; the cost we eat is the OCR/sanitization retries.
- `ocr_rejected` → **does not consume a credit** unless the user clicks "Use anyway" (which flips the entry to `success`).
- `image_gen_failed` → **does not consume a credit** (transient infrastructure failure, not user fault).
- `overlay_render_failed` → **does not consume a credit** (our bug, not user fault).

The quota query (§3.2) filters on `status = 'success'`, which encodes this rule.

**Why a soft accounting model.** Hard accounting (every API call burns a credit, success or not) is simpler but unfair to users on infrastructure or content-moderation failures. The soft model means we eat the provider cost on failures; at the projected per-user volume (10 generations × 30k users), the absorbed cost is a known line item. **Flagged decision — see Appendix B.**

### 5.10 Re-run and invalidation rules

**Re-running Stage 9 with new briefs:** The user may re-run Stage 9 (`POST /api/pipeline/thumbnails`) at any time. When this happens, the existing `thumbnail_images_data` is **not auto-cleared**, but the `briefVersion` snapshot in each image entry will mismatch the new `briefs[trigger].generatedAt`, so the UI surfaces the stale-brief chip on every image card. The user may either:
- Click "Regenerate this thumbnail" per card → consumes a credit, refreshes the image with the new brief.
- Leave the stale image — it stays valid as a deliverable PNG; the only consequence is the chip in the UI.

**Why not auto-clear.** A user who tweaks one word in a brief and re-runs Stage 9 should not lose three working images. Auto-invalidation makes Stage 9 destructive in a way it isn't today; the stale-brief chip is the soft-warning mechanism.

**Re-running Feature #23 with no `regenerateTrigger`:** No-op for any trigger that already has an image (per §5.1). The user must explicitly request a per-trigger regenerate to overwrite.

**Re-running Feature #23 with `regenerateTrigger`:** Generates a new image for that trigger. The old image entry is replaced atomically; the old `raw.png` and `composite.png` Storage objects are **kept** (under the old `generation_id` path) until 30-day retention sweep. This means the audit log preserves prior generations even when the user-facing snapshot only shows the latest one. **Flagged decision — see Appendix B (storage retention vs. cost).**

### 5.11 LoRA integration (Feature #24 hook)

The integration with Feature #24 is one read at the top of the pipeline (in `validatePrerequisites`) and one prompt-slot fill in `lib/prompts/thumbnail-image.ts`. Feature #24 owns the `lora_models` table and the training flow; Feature #23 only **consumes** a successfully-trained LoRA.

```typescript
// In validatePrerequisites:
const loraModel = await db.loraModels.findActiveByChannel(channel.id);
// Returns null until Feature #24 ships AND the user has a trained LoRA for this channel.

// In prompt assembly (lib/prompts/thumbnail-image.ts):
const subjectDirective = brief.characterPlacement === "none"
  ? null
  : loraModel
    ? `${loraModel.triggerToken} ${facialExpressionToText(brief.facialExpression)}`
    : `generic creator-style person, ${facialExpressionToText(brief.facialExpression)}`;
```

**Provider integration with LoRA.** When `loraModel` is non-null, the image-gen call must use a provider that supports LoRA weights. In Phase 3:
- **Imagen does not support custom LoRA.** When `loraModel` is non-null, the **primary** flips to FLUX (Replicate supports LoRA via `lora_weights` param) — Imagen falls back to "no-LoRA, generic person" only if FLUX fails.
- **FLUX with LoRA on Replicate** uses the model `black-forest-labs/flux-dev-lora` and accepts `lora_weights: "<replicate-uri>"` plus the `triggerToken` in the prompt.

Cost note: FLUX-with-LoRA is ~$0.06–0.08 per generation, ~50% more than Imagen-without-LoRA. The cost matrix in §5.9 reflects this.

**Stock-fallback UI.** When `characterPlacement !== "none"` AND `loraModel === null`, the entry's `loraUsed.fellbackToStock = true` and `flags.loraUnavailable = true`. The card surfaces the State 9 mockup ("Your face here →" placeholder + Train LoRA banner CTA). The image still ships with a generic stock person — the user gets a usable thumbnail even without LoRA.

### 5.12 Channel assets integration (Feature #25 hook — no-op until shipped)

The prompt slots in §5.3 have empty placeholders for `channelAssets.brandPalette`, `channelAssets.logoUrl`, and `channelAssets.referenceThumbnails`. Phase 3 ships with `channelAssets === null` always — the slots emit empty strings. When Feature #25 ships, populating these slots is a single-file change in `lib/prompts/thumbnail-image.ts` plus a Storage download for the logo (which is then composited via Sharp in `compositeOverlay`, **not** rendered by image-gen).

The placeholder behavior is not exposed in the UI — the user does not see a "channel assets not configured" prompt in Phase 3; the feature is invisible until #25 ships.

---

## 6. State Management

### 6.1 Server state

Authoritative for: `pipeline_runs.thumbnail_images_data`, `thumbnail_generations` rows, Storage objects in the `thumbnails` bucket. Every read of `thumbnail_images_data` parses through Zod (§3.4). Every Storage URL exposed to the client is a freshly-issued 1h signed URL.

The quota counter is **derived** from `thumbnail_generations` (count of `status = 'success'` rows in the current month). It is never persisted as a denormalized counter — sum-from-source-of-truth is cheap at the projected volume (≤ 10 rows per user per month, indexed by `user_id`).

The `meta.monthlyQuotaUsed` snapshot in `thumbnail_images_data` is **informational only** — the UI re-fetches the live quota from `GET /api/runs/[runId]/thumbnail-images/quota` on every page load. The snapshot exists to make the run-page server component renderable without an extra DB hop on the first paint.

### 6.2 Client state

- `/runs/[runId]` is a Server Component. It fetches `pipeline_runs` server-side, passes `thumbnails_data` (briefs) and `thumbnail_images_data` (images) as props to the `ThumbnailsCard` server component.
- `ThumbnailsCard` decides per-trigger which sub-component to render: `ThumbnailBriefCard` (Phase 1, when `images[trigger] === null`) or `ThumbnailImageCard` (Phase 3, when `images[trigger] !== null`).
- The SSE stream from `/api/runs/[runId]/thumbnail-images` is consumed by a client component `ThumbnailImageStreamConsumer.tsx`. It holds in-progress per-trigger state during generation and merges into the final state on `complete`.
- Per-trigger regenerate is optimistic: the card shows a shimmer immediately, the new entry replaces it on response, the request is rolled back on error.
- The overlay-text edit modal is a client component (`ThumbnailOverlayTextEditor.tsx`) that holds form state locally and POSTs to `/overlay-text` on Save.
- No global state library required — props flow + a small SSE reducer inside the stream consumer.

### 6.3 Optimistic updates

- **Per-trigger regenerate:** UI flips the card to shimmer immediately; on success, the SSE `trigger_complete` event swaps the new entry in. On non-recoverable error, the card snaps back to the prior image and a toast surfaces the error. Acceptable because image-gen takes 8–14s and the shimmer state is the dominant UX.
- **Overlay-text edit:** UI swaps the live-preview CSS approximation immediately, then POSTs and swaps in the server-rendered PNG when the response arrives (typically <1s). On error, the previous image stays.
- **Quota badge:** updated optimistically on generation start (`used += willConsume`), then re-fetched after the SSE completes for accuracy.
- **Discard generation (DELETE):** card disappears immediately, then DELETE; on error, the card re-appears with a toast.

### 6.4 Stale-brief detection (UI-only)

If `thumbnail_images_data.images[trigger].sourceBriefRef.briefVersion !== thumbnails_data.briefs[trigger].generatedAt`, the image card shows a `Stale brief` chip with a tooltip: "The paired brief was edited after this image was generated. Regenerate to refresh." The chip is informational; it does not block download or re-edit of overlay text. Same pattern as Stage 9's stale-title chip (§6.4 of spec #10).

### 6.5 SSE stream reconnect

If the SSE stream drops mid-generation (network blip, tab backgrounded for >60s, server pod recycled), the client does **not** auto-reconnect — re-issuing the POST would re-run the quota gate and could double-charge. Instead, the client polls `GET /api/runs/[runId]/thumbnail-images/quota` and the run page on a 5-second interval until either:
- The quota delta confirms the generation completed (count went up by `willConsume`), at which point the page is refreshed and the new images appear.
- 90 seconds elapse with no quota change, at which point the client surfaces "Generation may have failed — please refresh." The server-side generation either completed (and persisted) or is still running (rare given typical latency); a refresh shows ground truth.

This is a Phase 3 trade-off; a proper resumable SSE protocol is a Phase 4 polish. **Flagged decision — see Appendix B.**

---

## 7. UI/UX Behavior

### 7.1 Routes

Feature #23 does not introduce its own route. It renders inside the existing Stage 9 card on `/runs/[runId]`.

| Route | Auth | Purpose |
|---|---|---|
| `/runs/[runId]` | required | Renders the Stage 9 card; when `thumbnail_images_data` is non-null, image cards replace brief cards |

### 7.2 Card states (mapped to mockup States 1–13)

| Mockup state | Trigger | Card UI |
|---|---|---|
| State 1 — Main view | All three triggers have `status: success` images | 3 image cards, each with download / edit text / regenerate / view full-size buttons |
| State 2 — Loading (progressive) | SSE in flight during generation | Per-trigger card shows pending → image-gen running → OCR check → compositing → ready, in sequence |
| State 3 — Edit overlay text (modal) | User clicks "Edit text" | Modal with live preview + form (text, font picker, color picker scoped to palette swatches) |
| State 4 — Empty (briefs not ready) | `thumbnails_data` is null | "Generate concept briefs (Stage 9) first" + CTA. Stage 9 link |
| State 5 — Per-trigger image-gen failed | Trigger entry is null with `status: "image_gen_failed"` after retries | Card shows: "Couldn't generate this image" + Copy brief / Retry generation buttons. Falls back to brief markdown export |
| State 6 — NSFW persistent (2× fail) | `status: "nsfw_rejected"`, `nsfwCheck.attempts === 2` | Modal-style card: "Image rejected by safety filter" + Edit brief and retry / Use brief only / Skip variant |
| State 7 — Quota exhausted | `QUOTA_EXHAUSTED` | Full-screen-like card: "You've used all 10 generations this month" + plan picker (Phase 4 will wire upgrade) + "Use briefs only" |
| State 8 — Font fallback (warning) | `flags.anyOverlayFallback === true` | Inline warning banner above the affected card: "Rendered with fallback font" + Re-render |
| State 9 — LoRA not trained, brief requires face | `flags.loraUnavailable === true` | Banner above the cards: "Brief specifies a person — using generic stock for now" + Train LoRA CTA. Each affected card shows "Stock face" pill |
| State 10 — OCR garbled-text re-roll (in flight) | `ocrCheck.attempts === 1, passed === false`, retry running | Side-by-side: rejected version (OCR boxes overlaid) + re-rendering placeholder |
| State 11 — Overlay auto-shrink hit floor | `flags.anyAutoShrink === true` for that trigger | Inline warning above the card: "Text shrunk to minimum readable size" + Edit text CTA |
| State 12 — Full-size view (modal) | User clicks the thumbnail | 1280×720 native rendering in a modal with prev/next/edit/regenerate/download |
| State 13 — Regenerate-one confirmation | User clicks Regenerate on a card with non-null image | Confirmation modal: "Regenerate Fear thumbnail?" + cost preview (1 credit) + Cancel/Regenerate |

### 7.3 Per-card layout (matches mockup State 1)

```
┌──────────────────────────────────────────────┐
│ [Trigger pill]                    Variant 0N │
│ ┌──── 1280×720 thumbnail (rendered) ────┐    │
│ │   <image-gen background>              │    │
│ │   <Sharp-composited overlay text>     │    │
│ └────────────────────────────────────────┘   │
│ Pairs with title:                             │
│ "<locked title text>"                         │
│ [Stale brief]? if drift                       │
│ [Stock face]? if loraUsed.fellbackToStock     │
│ Overlay: <text> · <fontKey>                   │
│ Generated <provider> · <costCents>¢           │
│ [Download PNG] [Edit text] [Regenerate] [⛶]   │
└──────────────────────────────────────────────┘
```

### 7.4 Run-page Stage 9 card header (with image generation context)

The Stage 9 card header gains:
- A "Generations remaining this month" badge (e.g., `7 / 10`) — from `GET /quota`.
- A "Download all" button (when all 3 images succeeded) — issues 3 sequential downloads.
- A "Generate images" CTA when `thumbnails_data` is non-null but `thumbnail_images_data` is null OR has a null trigger entry whose brief is non-null. Clicking this CTA fires `POST /api/runs/[runId]/thumbnail-images` with no `regenerateTrigger`.

### 7.5 Loading + progress

Per the mockup State 2, the card layout shows three sub-cards (one per trigger), each in one of: queued → image-gen running → OCR check → compositing → ready. The progress is per-trigger so the user sees one image complete while another is still mid-generation. Total expected time: 18–35s for three images (sequential to keep cost predictable; see §5.4).

The estimated remaining time counter is computed naively (assume ~12s per remaining trigger). **Flagged decision — see Appendix B.**

### 7.6 Edit overlay text (mockup State 3)

A modal opens with two columns:
- **Live preview (left).** A 1280×720 frame showing the current raw image background + the editing overlay rendered client-side (CSS approximation of Sharp's output — not pixel-perfect, but close enough for typing).
- **Edit form (right).** Text input (40-char counter), font picker (3 options), color picker (4 options scoped to brief palette), Reset / Apply changes buttons.

On Apply: POST to `/overlay-text`, server returns the new image entry, the live preview is replaced with the actual server-rendered PNG.

### 7.7 Per-image actions

| Action | Behavior |
|---|---|
| Download PNG | `GET /thumbnail-images/[generationId]/download` — 302 to signed URL |
| Edit text | Opens the §7.6 modal |
| Regenerate | Confirmation modal (State 13) → POST with `regenerateTrigger` |
| View full size | Opens the State 12 modal |

### 7.8 Error UX

| Code / state | UI behavior |
|---|---|
| `BRIEFS_NOT_READY` | State 4 (empty) — "Generate concept briefs first" + Stage 9 link |
| `RUN_NOT_FOUND` | Redirect to `/runs` with toast |
| `QUOTA_EXHAUSTED` | State 7 — quota-exhausted modal with plan picker (Phase 4 wires upgrade) and "Use briefs only" |
| `IMAGE_GEN_FAILED` (whole batch) | Banner: "We couldn't generate any thumbnails right now. Try again." + retry button. Logs to Sentry |
| `IMAGE_GEN_FAILED` (per-trigger) | State 5 on the affected card; other cards remain |
| `NSFW_PERSISTENT` (per-trigger) | State 6 modal-style card; other cards remain |
| `OCR_PERSISTENT` (per-trigger) | Side-by-side State 10 → if 2× fail, the user is prompted "Use anyway?" with the second image displayed. Accepting flips status to success |
| `OVERLAY_RENDER_ERROR` | Per-trigger card: "Rendering failed — try editing the text" + Edit text button |
| `INTERNAL_ERROR` | Banner: "Something went wrong" + retry. Sentry log includes `runId` only |

### 7.9 Download-all behavior

`Download all` triggers three sequential `<a download>` clicks on the signed URLs. Browsers throttle simultaneous downloads, so a 250ms stagger between clicks is necessary to ensure all three trigger save dialogs fire. **Flagged decision — see Appendix B (multi-download UX is browser-flaky).**

### 7.10 Cost / quota visualization

The quota badge in the Stage 9 card header is the only place users see usage. Format: `<used> / <limit> generations remaining this month`. When `used >= limit * 0.8` the badge tint shifts to amber. When `used >= limit` the badge becomes a "Quota exhausted" pill that opens the State 7 modal.

The per-image cost in cents is **not** shown to the user in Phase 3. The internal `costCents` value drives the cost ledger only.

---

## 8. Edge Cases

| Case | Behavior |
|---|---|
| User triggers generation, all three triggers' briefs are non-null | All three are generated serially. SSE emits events per trigger as each completes |
| User triggers generation, only `result` brief is non-null | Only `result` is generated. Other two cards remain Phase-1 brief cards. `flags.partialReturn = true` |
| User regenerates `fear` after all three succeeded | Only `fear` is re-generated. Other two stay at their existing `briefVersion`. Quota: 1 credit |
| User regenerates the same trigger 6 times in a session | Quota allows; each consumes a credit. Old generations stay in `thumbnail_generations` (audit) but not in `thumbnail_images_data` (latest-only) |
| User edits overlay text 50 times on one image | Free (no credit). Each edit creates a new audit row with `cost_units: 0` |
| Edit overlay text after image was successful but before user has seen it | Allowed — edit-overlay reads the most recent successful entry |
| Edit overlay text on a trigger with `status: "nsfw_rejected"` | `409 IMAGE_NOT_AVAILABLE` (no raw image to overlay onto) |
| Imagen rejects on policy → FLUX rejects on policy → user clicks "Edit brief and retry" | Sends user to Stage 9 card for that trigger. After Stage 9 re-runs, user re-triggers Feature #23 |
| User has 1 credit left, requests batch of 3 (no `regenerateTrigger`) | `QUOTA_EXHAUSTED` before any image-gen. User must regenerate per-trigger |
| User has 1 credit left, requests `regenerateTrigger: "fear"` | Allowed. After the run, quota = 0; user is shown State 7 if they try another |
| Brief specifies `characterPlacement: "none"` (type-driven), LoRA available | LoRA is **not** used. Prompt does not include the trigger token. Generic type-driven image generated |
| Brief specifies a face, LoRA trained, but Replicate's FLUX endpoint is down | Falls back to Imagen-without-LoRA → emits "Stock face" warning despite having a LoRA. `flags.loraUnavailable = true` (semantically: "LoRA was wanted but not used"). Banner directs user to retry later |
| Brief contains profanity in `overlayText` | Sharp renders it verbatim. We do not filter overlay text — the user is responsible for the copy |
| Brief contains a `null` palette swatch for `overlayText.color` | Stage 9's invariant guarantees this can't happen; if Zod ever sees it on read, throws `INTERNAL_ERROR` |
| User re-runs Stage 9 → all three brief versions change → existing images all show `Stale brief` chip | Expected. User regenerates per-card to refresh |
| Storage upload succeeds for `raw.png` but fails for `composite.png` | Generation is rolled back: the `thumbnail_generations` row is updated to `status: "overlay_render_failed"`, `final_composite_url = null`. Raw image kept (will be cleaned up on retention sweep). User sees per-trigger error |
| User clicks `Download PNG`, signed URL expired between page load and click | Server re-issues a fresh signed URL on the GET endpoint; the redirect path always works |
| User soft-deletes the run | All `thumbnail_generations` rows cascade-soft-delete. Storage objects retained 30 days, then hard-deleted by the nightly job |
| User restores the run within 30 days (Phase 4 feature, deferred) | Storage objects still present; row re-activation is a single update. Phase 3 has no restore UI; Phase 4 may add one |
| Tab closes mid-stream | SSE cancels client-side; server completes any in-flight generation and persists. Re-opening the page renders whatever state landed. `flags.partialReturn = true` if some triggers didn't finish |
| Two browser tabs both run generation against the same runId | Last-write-wins on `thumbnail_images_data`. The audit log preserves both runs' attempts. Acceptable for Phase 3 (same trade-off as Stage 9). **Flagged decision — Appendix B** |
| Provider returns image at unexpected dimensions (e.g., 1024×1024 from Imagen on a config bug) | Sharp resize handles any input; final composite is always 1280×720 with center-crop |
| Provider returns corrupt bytes | Sharp throws on parse; we catch, mark `status: "image_gen_failed"`, retry with the other provider |
| OCR engine times out or crashes | Treated as "OCR passed" (fail-open). Reasoning: OCR is a quality gate, not a security gate; better to ship a possibly-garbled image than to block the whole pipeline. The `ocrCheck.attempts` is set to 1 with `passed: true` and `warnings: ["ocr_engine_unavailable"]`. **Flagged decision — Appendix B** |
| Sharp version upgrade introduces a breaking SVG change | Caught by integration tests in `lib/imagegen/__tests__/composite.test.ts` (golden-file test against committed reference PNGs). Block on CI |
| Long unicode (emoji) in overlay text | Sharp handles emoji rendering via the SVG fallback. If the curated fonts don't have the glyph, the rendered output uses Sharp's font fallback chain. May render as `▢` boxes — `warnings: ["overlay_glyph_missing"]` is set |
| User on free tier (Phase 4) | Behavior differs only in `QUOTA_LIMIT_BY_TIER` lookup. No code-path change in Phase 3 |

---

## 9. Security Considerations

- **Auth-gated:** middleware on the `(app)` route group enforces session presence. Unauthenticated requests to `/api/runs/[runId]/thumbnail-images*` return `401 UNAUTHENTICATED` with no detail.
- **RLS:** every read/write to `pipeline_runs`, `thumbnail_generations`, and `lora_models` is filtered by `auth.uid()`. The service-layer check (`run.user_id !== userId`) is a second line of defense.
- **IDOR protection (CLAUDE.md SEC-2):** every endpoint that takes a `runId` or `generationId` reads the row with `where user_id = auth.uid()`. Rows belonging to other users return 404, never 403 (don't leak existence).
- **Storage authorization:** the `thumbnails` Storage bucket is private. The path layout `thumbnails/{user_id}/...` makes user-scoped access patterns trivial to enforce. Signed URLs are issued only after the service confirms the requesting user owns the `generation_id`.
- **Signed URL TTL:** 1 hour. Long enough for a download flow, short enough that a leaked URL becomes useless quickly. Renewed on each page load.
- **Error-message leakage (CLAUDE.md API-2):** Imagen/FLUX/Tesseract/Sharp error bodies are logged server-side (Sentry) but never returned to the client. The client only sees the codes in §4.x. Specifically:
  - Imagen 4xx (other than policy reject) → `INTERNAL_ERROR` (it's a bug in our prompt assembly)
  - Imagen policy reject → handled by §5.6 NSFW path; never leaked
  - Imagen 429/529 after retries → `IMAGE_GEN_FAILED`
  - Imagen 401/403 → `INTERNAL_ERROR` (key issue)
  - FLUX errors mapped identically
- **Prompt-injection defense:** user-controlled inputs (`idea_text`, `niche`, brief fields) flow into the image-gen prompt. The prompt template wraps user content in delimited blocks (the providers don't have an "instruction vs. data" distinction, but the practical effect of the wrapping is that the user can't redirect the providers' style guidance). We do not rely on this for safety — image-gen is content-policed by the provider, OCR catches text artifacts, NSFW-retry handles policy escalation.
- **Output XSS defense (CLAUDE.md SEC-3):** All brief and image fields rendered through React's default JSX escaping. The signed URL string is only used in `<img src>` and `<a href>`, never `innerHTML`. Hex colors are validated by Zod (`^#[0-9a-f]{6}$`) before being interpolated into inline `style`.
- **Image content moderation:** Imagen and FLUX both have provider-level content policies. We run NSFW retry (§5.6) when their policy fires. We do **not** run our own NSFW classifier on the output bytes; we trust the provider's policy + OCR. **Flagged decision — Appendix B (we may want a lightweight nudity/violence classifier in Phase 4 for cases where the provider policy lets something through that we don't want to host).**
- **OCR adversarial input:** Tesseract is invoked on attacker-controlled image-gen output. Tesseract has had buffer-overflow CVEs historically; we mitigate by running OCR in a sandboxed worker (Node `worker_threads`) with a 30-second hard timeout. A timeout is treated as fail-open per the edge case table.
- **Sharp adversarial input:** Sharp wraps libvips, which has had CVEs. We pin Sharp to a known-good version, run dependency scanning, and limit input image size to 25 MB (Imagen and FLUX outputs are ~3–5 MB each).
- **Rate limits (in addition to monthly quota):** each user is capped at 30 image-gen requests per hour (full-batch + per-trigger combined), enforced via `rate_limits` table or Redis. Beyond the cap → `429 { code: "RATE_LIMITED", retryAfterSec }`. This is a defense against a buggy client looping requests; the monthly cap is the headline limit.
- **Provider API key handling (CLAUDE.md EXT-1):** `GOOGLE_AI_API_KEY` (Imagen) and `REPLICATE_API_TOKEN` (FLUX) are validated by Zod in `lib/env.ts` at boot. The app refuses to start if either is missing in production.
- **Logging:** prompts and image bytes are **not** logged in production. Sentry breadcrumbs include `runId`, `trigger`, `provider`, `status`, `costCents`, `latencyMs`. The full prompt is persisted in `thumbnail_generations.prompt_text` for moderation review (encrypted at rest by Supabase).
- **CSRF:** Next.js Server Actions and same-origin SSE/POST requests are CSRF-protected by default. Routes verify the `Origin` header.
- **Cascade-delete safety:** deleting a `pipeline_run` cascade-soft-deletes `thumbnail_generations` rows; the nightly Storage cleanup respects `deleted_at` and only purges rows older than 30 days. A user who accidentally deletes a run can be restored within 30 days (Phase 4 UX).

---

## 10. Future Considerations (Out of Scope for Phase 3)

The following are intentionally deferred. Each is tracked elsewhere — do not implement as part of this feature.

- **Per-thumbnail editable layer file (PSD/Figma export):** the PRD lists this as Phase 3 stretch; we explicitly defer to Phase 4. Sharp can produce layered PSDs via the `sharp-psd` add-on, but the layer-fidelity requirements (separate text layer, palette swatch metadata, layer naming) are non-trivial. Designers can request the brief markdown today.
- **Animated thumbnails (GIF/WebP/MP4):** out of scope. Image-gen for moving content is a separate feature.
- **A/B compare versus uploaded:** the user already has Stage 11 (A/B test plan) for testing pairs. Direct comparison vs. a manually-uploaded thumbnail (showing the user "your old vs. AI" side-by-side) is a Phase 4 UX experiment, not core.
- **Style-transfer from existing thumbnail:** the user uploads one of their old thumbnails, and AI generates new ones in the same style. Requires a vision model + style-embedding pipeline. Phase 4+.
- **Direct upload to YouTube via OAuth:** Phase 4 feature contingent on YouTube Data API write scopes and OAuth flow. Today the user downloads the PNG and uploads manually.
- **Brand-asset library management UI:** owned by Feature #25 (Channel Assets). Phase 3 reads from `channel_assets` if the table exists; the management UI is a separate spec.
- **Custom font support beyond the curated 3:** the curated set is a deliberate choice (covers 90% of thumbnail typography). Adding a 4th font is a CLAUDE.md decision; user-uploaded fonts are Phase 4+ (security: font files are an attack surface).
- **Vertical thumbnails for Shorts:** Feature #21 owns Shorts thumbnails (9:16 aspect). Separate spec.
- **Per-tier monthly caps (Solo/Creator/Studio):** the Phase 4 monetization cut-over. Phase 3 ships with a hard 10/month for everyone. The `QUOTA_LIMIT_BY_TIER` constant in `lib/services/thumbnail-images.ts` is the single touch-point for the Phase 4 wire-up.
- **Stripe upgrade flow (mockup State 7):** the upgrade button is rendered but only routes to a placeholder `/pricing` page in Phase 3. Stripe integration is a Phase 2/4 feature in its own spec.
- **Cost-attribution dashboard (admin-side):** we persist the data (`thumbnail_generations.cost_units`); the admin dashboard is Phase 4 ops.
- **Multi-image per trigger:** "show me 4 fear variants" is not supported. The 1:1 brief-to-image mapping mirrors Stage 5's title trigger lock-in. **Flagged decision — Appendix B.**
- **Inline brief editing from the image card:** today the user must navigate to the Stage 9 card to edit a brief. An "edit brief here" affordance on the image card is a Phase 4 polish.
- **Preview before commit:** Phase 3 commits as soon as image-gen succeeds. A "preview, then commit" flow (where the user sees the generated image and chooses to spend the credit or discard for free) is a Phase 4 UX experiment. Today, every successful generation consumes a credit.
- **Localization of overlay text:** Phase 3 is English-only. Multi-language overlays require multi-script font support and bidi rendering — a Phase 4+ project.
- **Resumable SSE streams:** Phase 3 polls on disconnect (§6.5). A real resumable stream protocol (with stream IDs and last-event-id) is Phase 4.

---

## Appendix A — File map

This spec implies the following files exist by the end of implementation:

```
app/
  api/
    runs/
      [runId]/
        thumbnail-images/
          route.ts                            # POST → SSE (generate / regenerate)
          overlay-text/route.ts               # POST → JSON (re-render text only)
          [generationId]/download/route.ts    # GET → 302 to signed URL
          [trigger]/route.ts                  # DELETE → discard one
          quota/route.ts                      # GET → live quota
  (app)/
    runs/
      [runId]/
        components/
          ThumbnailsCard.tsx                  # extended from Phase 1 — picks brief vs. image card per trigger
          ThumbnailImageCard.tsx              # NEW — Phase 3 image card
          ThumbnailImageStreamConsumer.tsx    # NEW — SSE consumer
          ThumbnailOverlayTextEditor.tsx      # NEW — modal for overlay text edits
          ThumbnailFullSizeModal.tsx          # NEW — State 12 modal
          ThumbnailRegenerateConfirmation.tsx # NEW — State 13 confirmation
          ThumbnailQuotaBadge.tsx             # NEW — header badge (live quota query)
          ThumbnailQuotaExhaustedModal.tsx    # NEW — State 7
lib/
  services/
    thumbnail-images.ts                       # orchestrator: prerequisites, quota, OCR, NSFW, composite, persist
  imagegen/
    index.ts                                  # generateWithFallback orchestrator
    imagen.ts                                 # Gemini Imagen adapter
    flux.ts                                   # Replicate FLUX adapter (with LoRA support)
    sanitize.ts                               # NSFW prompt sanitization denylist + replacements
    cost-matrix.ts                            # cents-per-path constants
    types.ts                                  # GenerationProvider, RawGenerationResult, etc.
    __tests__/
      composite.test.ts                       # Sharp golden-file tests
      ocr.test.ts                             # OCR fixture tests (clean / garbled samples)
  prompts/
    thumbnail-image.ts                        # brief → image-gen prompt translation
  validation/
    thumbnail-images.ts                       # Zod schemas (§3.4)
  db/
    pipeline-runs.ts                          # extend with thumbnail_images_data getters/setters
    thumbnail-generations.ts                  # NEW — typed CRUD for the audit table
    lora-models.ts                            # NEW (Feature #24 owns; Feature #23 reads via findActiveByChannel)
  storage/
    thumbnails.ts                             # signed-URL issuance, upload, delete, retention sweep
  ocr/
    tesseract.ts                              # tesseract.js wrapper, sandboxed worker
    google-vision.ts                          # optional production fallback
  sharp/
    composite-overlay.ts                      # Sharp pipeline (§5.7)
    overlay-svg.ts                            # SVG generation for the text layer
    fonts.ts                                  # font loading + fallback chain
public/
  fonts/
    Anton-Regular.ttf                         # display-sans (gitignored binary; fetched at build time)
    Inter-Black.ttf                           # condensed-sans
    BebasNeue-Regular.ttf                     # bold-serif
scripts/
  fetch-fonts.ts                              # downloads the curated font set into public/fonts/ at build time
  cleanup-thumbnails.ts                       # nightly retention sweep (cron, 30-day)
```

Each file should respect CLAUDE.md Q-2 length limits:
- API route files ≤ 150 lines (push logic into `lib/services/thumbnail-images.ts`)
- Service file ≤ 300 lines (split provider and OCR helpers into `lib/imagegen/` and `lib/ocr/`)
- Prompt file ≤ 500 lines
- Components ≤ 200 lines each

CLAUDE.md updates required when this spec is implemented:
1. **CRIT-1 amendment** — add a footnote noting that `thumbnail_generations.cost_units` and the monthly quota gate are the cost-control analog for image-gen, parallel to YouTube quota tracking.
2. **EXT-1** — add `GOOGLE_AI_API_KEY` and `REPLICATE_API_TOKEN` to the env-var list.
3. **Stack lock-in** — add Sharp, tesseract.js, Imagen, FLUX (Replicate) to the external-services line.
4. **Common Mistakes** — add an entry if/when an implementation bug surfaces.

---

## Appendix B — Flagged decisions (revisit during build)

These are decisions made in this spec that warrant a second look during implementation. Each is testable; none is irreversible.

1. **Opt-in generation, not auto-trigger on Stage 9 completion (§1, §7.4).** The user must click "Generate images" after briefs are ready. **Risk:** users may not discover the feature; lower activation. **Mitigation:** prominent CTA on the Stage 9 card header with the quota badge alongside (`7/10 generations remaining`). Revisit if Phase 3 telemetry shows <40% activation among users who have briefs.

2. **Storage retention 30 days for soft-deleted runs (§3.3, §5.10).** Cost vs. recoverability trade-off. **Risk:** users who hard-delete and regret it (within 30 days, somehow) can be restored, but our Storage cost grows with the user base. **Mitigation:** sample bucket size monthly; if it exceeds budget, drop retention to 7 days. Alternative: hard-delete on soft-delete; add a UI confirmation that warns "this will delete the generated images permanently".

3. **Race window on quota gate (§5.2).** Two parallel requests from the same user can both pass when one slot remains. **Risk:** off-by-one over-spend per user per month at most. **Mitigation:** acceptable in Phase 3 (free tier); add `select for update` quota lock in Phase 4 when paid tiers make every credit material.

4. **OCR confidence threshold 0.7 (§5.5).** Lower = more false positives; higher = more missed garbled text. **Risk:** at 0.7, ~5% of clean images flagged falsely (re-rolled needlessly), ~10% of garbled images missed. **Mitigation:** monitor `flags.anyOcrRetried` rate; if >25%, raise threshold. If user complaints about garbled text exceed expectations, lower it.

5. **Soft quota accounting — failures don't burn credits (§5.9).** Provider cost on failures is absorbed by us. **Risk:** at 30k users with 10 generations each, even a 5% NSFW-rejection rate means ~$60/month absorbed. **Mitigation:** the alternative (hard accounting) is user-hostile. If absorbed cost exceeds budget, switch to "credit consumed on each provider call" with a fairness exception only for `image_gen_failed` (provider 5xx).

6. **Hard 30-day Storage retention for old generations of the same trigger (§5.10).** When the user regenerates a trigger, the old generation's Storage objects stay 30 days. **Risk:** doubles Storage cost in the worst case. **Mitigation:** make retention 7 days for replaced-by-regenerate (separate from soft-delete-of-run retention). Revisit if Storage cost exceeds budget.

7. **Auto-shrink overlay text floor at 48pt (§5.7).** Below 48pt, mobile YouTube feed renders text unreadably. **Risk:** edge-case briefs with long overlay text (despite 3–5 word constraint) hit the floor and ship at 48pt × 2 lines. **Mitigation:** the State 11 warning prompts the user to edit. Acceptable trade-off; the alternative (refuse to render) is worse than a too-small thumbnail.

8. **Last-write-wins on concurrent same-runId image-gen (§8).** Two browser tabs both running generation → second `complete` overwrites first; both audit rows persist. **Risk:** users with both tabs open lose the first run's images. **Mitigation:** uncommon; per-run advisory lock is cheap to add in Phase 4 if it's a real issue.

9. **OCR fail-open on engine timeout (§8 edge case).** If Tesseract crashes or times out, treat as "passed". **Risk:** a tiny % of images ship with garbled text we missed. **Mitigation:** the `warnings: ["ocr_engine_unavailable"]` is logged for monitoring. Alternative is fail-closed (block image), which is strictly worse for UX in the engine-outage case.

10. **No additional NSFW classifier on output (§9).** We trust provider policy + OCR. **Risk:** provider lets through something we don't want to host (e.g., political imagery the provider permits but we don't). **Mitigation:** add a lightweight nudity/violence classifier in Phase 4 if any incident occurs. Until then, trust + monitor.

11. **Naive remaining-time estimator in UI (§7.5).** Assumes ~12s per remaining trigger. **Risk:** estimator drifts — actual latency is often 6–9s on Imagen, 9–14s on FLUX. **Mitigation:** running average per provider, persisted to `meta.lastLatencyMs` and used for the next estimate. Cheap follow-up.

12. **Multi-image download UX (§7.9).** Sequential `<a download>` with 250ms stagger; browser-flaky. **Risk:** Safari sometimes asks for permission once per file. **Mitigation:** offer a "Download all as ZIP" option in Phase 4 (server zips and streams).

13. **SSE polling fallback on disconnect (§6.5).** No real resumable stream. **Risk:** a 90s disconnect during generation surfaces "may have failed" even when it succeeded. **Mitigation:** the user's quota query confirms success/failure from the source of truth; the UX cost is one extra refresh. Phase 4 polish.

14. **One image per trigger, no multi-variant (§10).** No "show me 4 fear variants". **Risk:** users with rejected images can't pick from a set. **Mitigation:** the regenerate flow is the multi-variant proxy. If users repeatedly regenerate one trigger, that's signal to introduce multi-variant.

15. **Phase 3 ships without per-tier quotas (§5.2, §10).** Hard 10/month for everyone. **Risk:** confusion when Stripe ships and tiers diverge. **Mitigation:** the constant-table abstraction (`QUOTA_LIMIT_BY_TIER`) makes the cut-over a one-line change. Mockup State 7's plan picker rendered but not wired.

16. **Storage path embeds `user_id` (§3.3).** A future migration to multi-tenant orgs would require a path rewrite. **Risk:** schema lock-in. **Mitigation:** if we ever add orgs, the migration is a Storage-side rename; non-trivial but possible. Acceptable trade for the simpler authorization model today.

17. **Sharp-rendered overlay vs. provider-rendered (§5.7).** We always render text via Sharp, never via image-gen. **Risk:** the seams between AI background and SVG text show in some compositions. **Mitigation:** the curated font set + safe-area calculation produce clean comps in 95%+ of cases. The State 8 warning surfaces the rest. Revisit if user complaints suggest seams.
