# Spec — Feature #24: Custom LoRA / Character Training

> **Status:** Approved · **Phase:** 3 · **Tier:** 4 (AI Thumbnails + LoRA) · **Build Order:** §4.2
> **Source PRD:** `Documentation/PRDs/24-lora-character-training.md`
> **Mockup:** `Documentation/Mockups/24-lora-character-training.html`
> **Sibling spec (host):** Feature #23 — AI Thumbnail Generation (`23-ai-thumbnail-generation/spec.md`)
> **Upstream spec:** Feature #01 — Channel Onboarding (`01-channel-onboarding/spec.md`)

This spec is the engineering contract. It supersedes the PRD on any conflict. Code is built from this document.

---

## 1. Overview

Feature #24 is the **defensibility moat** of YouTube Viralizer. It trains a per-channel LoRA (Low-Rank Adaptation) model on the user's own face, so every AI-generated thumbnail produced by Feature #23 features the creator's actual likeness — same person, any pose, any lighting, any scene. No competitor in the creator-AI space ships per-creator consistent face on thumbnails; with this feature, every output Feature #23 emits is identifiably "the creator", which is the visual consistency signal that the YouTube algorithm and human audiences reward.

**Concrete shape of the feature:**

- A user with an active channel uploads **10–25 photos** of their face.
- Each photo is validated on upload (face-detection, resolution, single-subject) and either accepted, rejected, or warned.
- Once the user has ≥10 valid photos, they trigger training. We submit the photos to **Replicate's FLUX-LoRA training endpoint**, with **1200 training steps** by default.
- A unique **trigger token** is assigned to the channel (e.g., `creator_a1b2c3d4`). Feature #23 uses this token in image-generation prompts to invoke the LoRA at inference time.
- Training runs ~30 minutes asynchronously. Replicate fires a webhook to our backend on completion. We download the model weights to Supabase Storage, generate **4 sample renders** to verify quality, and email the user with a link to `/character`.
- The model is **per-channel** — a multi-channel user has independent LoRAs per channel. Re-training **replaces** the active model (the prior `model_weights_url` is retained for 7 days for rollback).
- **Privacy:** photos are encrypted at rest (Supabase Storage default), public-read is disabled, only owner-scoped signed URLs are issued, and source photos are **auto-deleted 30 days after training completes**. The model retains the learned weights, not the source images. The user can purge model + photos at any time.
- **Cost:** ~$3 per training run (Replicate FLUX-LoRA pricing, recorded as `cost_cents`); per-inference cost lives in Feature #23.

**Why this is in Phase 3 / Tier 4.2 (built last):**

Feature #24 is structurally dependent on Feature #23 having shipped: there is no value in training a face model with no thumbnail generator to use it. Feature #23 is the host. Feature #24 is the defensibility unlock that justifies the price tier, retention claim, and "no other tool does this" positioning in the Master Overview.

**Non-goals (out of scope for this spec):**

- Body LoRA (full-body consistency)
- Animation / motion LoRA
- Voice cloning
- Multi-character LoRAs for collab channels
- LoRA marketplace (sharing models across users)
- Real-time face swap on existing footage
- Style LoRAs (channel aesthetic, not personal face)
- Automated deepfake / consent detection (TOS attestation only in v1)
- Self-hosted training infrastructure (Modal, Replicate-replacement) — deferred; v1 uses Replicate

---

## 2. User Stories

The PRD lists five user stories. The engineering scope below covers all five, with these clarifications:

| Story | Scope notes |
|---|---|
| As a creator, I want every AI-generated thumbnail to feature my actual face, so my channel maintains visual consistency. | Implemented via the trigger-token contract with Feature #23 (§9.1). |
| As a creator, I want to upload 10–20 photos of myself and have a model trained, so I never have to upload again. | Implemented via the upload + train flow on `/character/train`. Hard cap is 25; soft minimum is 10. |
| As a creator, I want the trained model usable across all my thumbnails on this channel, so it persists. | Implemented via the per-channel `lora_models` row, queried by Feature #23 on every render. |
| As a creator, I want privacy guarantees on my training photos, so my likeness isn't leaked or repurposed. | Implemented via §6 (storage architecture) + §7 (privacy controls). |
| As a creator with multiple identities (multi-channel operator), I want per-channel LoRAs, so each channel maintains its own face. | Implemented via the `channel_id` foreign key on `lora_models` and `character_photos`; one active LoRA per channel. |

Two additional stories implied by the PRD's "states to handle" but not enumerated:

- As a creator, I want to **see sample renders** of my LoRA before I trust it on real thumbnails, so I can decide whether to retrain.
- As a creator, I want to **purge my model and photos** at any time, so I can revoke my likeness.

---

## 3. Data Model

### 3.1 `character_photos` table

Stores one row per uploaded source photo. Photo binaries live in Supabase Storage; this table holds metadata, validation results, and the optional face embedding used for variance / dedup checks.

```sql
create table public.character_photos (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  channel_id          uuid not null references public.channels(id) on delete cascade,
  storage_path        text not null,                   -- "character-photos/{userId}/{channelId}/{photoId}.jpg"
  mime_type           text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  byte_size           integer not null check (byte_size > 0 and byte_size <= 10 * 1024 * 1024),
  width               integer,                          -- pixels; null until validation completes
  height              integer,                          -- pixels; null until validation completes
  validation_status   text not null default 'pending'
                      check (validation_status in (
                        'pending',                      -- enqueued, not yet validated
                        'face_detected',                -- VALID
                        'no_face',                      -- REJECTED
                        'multiple_faces',               -- REJECTED
                        'low_resolution',               -- REJECTED — width or height < 768
                        'unreadable',                   -- REJECTED — corrupted / unsupported codec
                        'validation_error'              -- INTERNAL — vision provider failed; retry-eligible
                      )),
  validation_error    text,                             -- human-readable detail when status = validation_error
  face_bbox           jsonb,                            -- { "x": 120, "y": 80, "w": 380, "h": 380 } when face_detected
  face_embedding      vector(512),                      -- pgvector; nullable; used for variance / dedup
  uploaded_at         timestamptz not null default now(),
  validated_at        timestamptz,                      -- set when validation_status moves out of 'pending'
  used_in_training    boolean not null default false,   -- flipped to true when included in a training job
  deleted_at          timestamptz,                      -- soft delete; hard-purge cron clears storage at 30d post-training
  created_at          timestamptz not null default now()
);

create index character_photos_user_channel_idx
  on public.character_photos (user_id, channel_id) where deleted_at is null;
create index character_photos_channel_active_idx
  on public.character_photos (channel_id) where deleted_at is null;
create index character_photos_pending_validation_idx
  on public.character_photos (uploaded_at) where validation_status = 'pending';

alter table public.character_photos enable row level security;

create policy "character_photos_select_own" on public.character_photos
  for select using (auth.uid() = user_id);
create policy "character_photos_insert_own" on public.character_photos
  for insert with check (auth.uid() = user_id);
create policy "character_photos_update_own" on public.character_photos
  for update using (auth.uid() = user_id);
create policy "character_photos_delete_own" on public.character_photos
  for delete using (auth.uid() = user_id);
```

**Notes:**

- `face_embedding` is a pgvector column. The pgvector extension must be enabled (`create extension if not exists vector;`). It is **optional** — if the vision provider doesn't return embeddings, this column stays null and the variance / dedup warnings are skipped.
- `face_bbox` is stored so future features (auto-crop on multi-face images, see §11) can reuse it without re-running face detection.
- `used_in_training` is set when a photo is selected into a training job's `source_photo_ids`. This flag drives the **30-day auto-delete cron** (§7.4): a photo with `used_in_training = true` and a corresponding training run with `completed_at < now() - interval '30 days'` is purged.
- The **public-read flag on the storage bucket is disabled** (§6.1). Access is via signed URLs only.

### 3.2 `lora_models` table

One row per training job; the row also represents the active model for a channel (an active model has `status = 'ready'` and `deleted_at IS NULL`).

```sql
create table public.lora_models (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  channel_id          uuid not null references public.channels(id) on delete cascade,
  status              text not null default 'queued'
                      check (status in (
                        'queued',                       -- accepted by our backend, awaiting Replicate submit
                        'training',                     -- submitted to Replicate, training in progress
                        'ready',                        -- training succeeded, weights downloaded, samples rendered
                        'failed',                       -- terminal failure (Replicate or download)
                        'superseded',                   -- a newer model has replaced this one (kept 7d)
                        'purged'                        -- weights and samples deleted per user request or rollback window
                      )),
  trigger_token       text not null,                    -- e.g., 'creator_a1b2c3d4' — see §5.4 for derivation
  training_provider   text not null default 'replicate' check (training_provider in ('replicate')),
  training_job_id     text,                             -- Replicate prediction id (e.g., 'abc123xyz')
  training_steps      integer not null default 1200 check (training_steps between 800 and 1500),
  training_lr         numeric not null default 0.0004,  -- learning rate; default per Replicate FLUX-LoRA recommendation
  training_resolution integer not null default 1024 check (training_resolution in (768, 1024)),
  base_model          text not null default 'black-forest-labs/flux-1-dev',
  source_photo_ids    uuid[] not null,                  -- snapshot of photos used (10..25)
  source_photo_count  integer not null,                 -- denormalized = array_length(source_photo_ids, 1)
  model_weights_url   text,                             -- Supabase Storage path to .safetensors
  model_weights_bytes bigint,                           -- weight file size, for accounting
  sample_render_urls  jsonb not null default '[]'::jsonb, -- array of 4 URLs (Supabase Storage signed URL paths)
  cost_cents          integer not null default 0,       -- training cost in USD cents (~300 = $3)
  variance_score      numeric,                          -- 0..1 cosine-distance variance across photos; warning if < 0.15
  uniformity_warning  boolean not null default false,   -- true when variance_score < threshold
  hat_or_glasses_warning boolean not null default false,
  warnings_json       jsonb not null default '[]'::jsonb, -- structured warnings list (see §5.6)
  failure_code        text,                             -- TRAINING_FAILED | REPLICATE_QUOTA | DOWNLOAD_FAILED | SAMPLE_FAILED
  failure_detail      text,                             -- internal log (never returned to client)
  webhook_secret      text not null,                    -- random string; included in Replicate webhook URL for HMAC verification
  rollback_until      timestamptz,                      -- set when this row is superseded; weights deleted after this time
  queued_at           timestamptz not null default now(),
  started_at          timestamptz,                      -- set when status moves to 'training'
  completed_at        timestamptz,                      -- set when status moves to 'ready' or 'failed'
  deleted_at          timestamptz,                      -- soft delete; hard-purge cron clears Supabase Storage
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Exactly zero or one active LoRA per channel. Partial unique index across (channel_id) where active.
create unique index lora_models_active_per_channel
  on public.lora_models (channel_id)
  where status = 'ready' and deleted_at is null;

create index lora_models_user_idx        on public.lora_models (user_id) where deleted_at is null;
create index lora_models_channel_idx     on public.lora_models (channel_id) where deleted_at is null;
create index lora_models_status_idx      on public.lora_models (status) where deleted_at is null;
create index lora_models_rollback_idx    on public.lora_models (rollback_until) where status = 'superseded';
create index lora_models_training_job_id on public.lora_models (training_job_id) where training_job_id is not null;

alter table public.lora_models enable row level security;

create policy "lora_models_select_own" on public.lora_models
  for select using (auth.uid() = user_id);
create policy "lora_models_insert_own" on public.lora_models
  for insert with check (auth.uid() = user_id);
create policy "lora_models_update_own" on public.lora_models
  for update using (auth.uid() = user_id);
create policy "lora_models_delete_own" on public.lora_models
  for delete using (auth.uid() = user_id);
```

**Notes:**

- The **partial unique index** `lora_models_active_per_channel` enforces "exactly zero or one active LoRA per channel" at the DB layer. Re-training transitions the prior row from `ready` → `superseded` in the same transaction that inserts the new `queued` row, so the partial index is never violated.
- `webhook_secret` is a 32-byte random string generated at insert time and embedded in the Replicate webhook URL (`/api/character/webhook/{loraModelId}?secret={secret}`). The webhook handler verifies this matches the row before processing.
- `sample_render_urls` is a JSONB array of 4 storage paths populated after training completes (§5.7). Empty array until `status = 'ready'`.
- `warnings_json` is a structured list (see Appendix A schema). Used by the UI to render the per-warning callout cards in States 2–4 of the mockup.

### 3.3 `character_training_events` table (audit log)

Every state transition on a `lora_models` row is logged for debugging and (eventually) cost / quota analytics. This table is **append-only**, no RLS for writes from server-only paths.

```sql
create table public.character_training_events (
  id                uuid primary key default gen_random_uuid(),
  lora_model_id     uuid not null references public.lora_models(id) on delete cascade,
  event_type        text not null check (event_type in (
                      'queued','submitted','training_started','training_succeeded',
                      'training_failed','weights_downloaded','samples_rendered',
                      'superseded','rollback','purged','validation_warning'
                    )),
  payload           jsonb not null default '{}'::jsonb, -- raw provider response (sanitized: no secrets)
  occurred_at       timestamptz not null default now()
);

create index character_training_events_model_idx
  on public.character_training_events (lora_model_id, occurred_at desc);

alter table public.character_training_events enable row level security;
-- read-only via owner; writes are server-side only (service role bypasses RLS).
create policy "character_training_events_select_own" on public.character_training_events
  for select using (
    exists (
      select 1 from public.lora_models lm
      where lm.id = lora_model_id and lm.user_id = auth.uid()
    )
  );
```

### 3.4 Typed schemas (Zod, validated at every boundary)

Located in `lib/validation/character.ts`:

```typescript
import { z } from "zod";

export const ValidationStatusSchema = z.enum([
  "pending",
  "face_detected",
  "no_face",
  "multiple_faces",
  "low_resolution",
  "unreadable",
  "validation_error",
]);

export const FaceBBoxSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});

export const CharacterPhotoSchema = z.object({
  photoId: z.string().uuid(),
  channelId: z.string().uuid(),
  status: ValidationStatusSchema,
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  byteSize: z.number().int().positive(),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  faceBbox: FaceBBoxSchema.nullable(),
  uploadedAt: z.string().datetime(),
  validatedAt: z.string().datetime().nullable(),
  signedThumbUrl: z.string().url().nullable(), // signed URL for the 256px thumbnail; null while pending
});

export const LoRAStatusSchema = z.enum([
  "not_trained", // synthetic — no row exists for this channel
  "queued",
  "training",
  "ready",
  "failed",
  "superseded",
  "purged",
]);

export const WarningSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("uniformity"),       severity: z.enum(["warn"]),  message: z.string() }),
  z.object({ type: z.literal("hat_or_glasses"),   severity: z.enum(["warn"]),  message: z.string() }),
  z.object({ type: z.literal("low_count"),        severity: z.enum(["warn"]),  message: z.string() }),
  z.object({ type: z.literal("multi_face_dropped"),severity: z.enum(["info"]), message: z.string() }),
]);

export const SampleRenderSchema = z.object({
  prompt: z.string(),
  signedUrl: z.string().url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const LoRAModelSchema = z.object({
  loraModelId: z.string().uuid().nullable(),
  channelId: z.string().uuid(),
  status: LoRAStatusSchema,
  triggerToken: z.string().nullable(),
  trainingSteps: z.number().int().min(800).max(1500),
  sourcePhotoCount: z.number().int().min(0),
  sampleRenders: z.array(SampleRenderSchema).max(4),
  costCents: z.number().int().nonnegative(),
  warnings: z.array(WarningSchema),
  queuedAt: z.string().datetime().nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  estimatedCompletionAt: z.string().datetime().nullable(), // computed: started_at + 30min when training
});

export type CharacterPhoto = z.infer<typeof CharacterPhotoSchema>;
export type LoRAModel       = z.infer<typeof LoRAModelSchema>;
export type LoRAStatus      = z.infer<typeof LoRAStatusSchema>;
```

**Read-side enforcement:** `lib/db/character.ts` parses every JSONB column through these schemas before returning to callers. A parse error throws `INTERNAL_ERROR` and is logged — never returned raw to clients.

### 3.5 Constraints

- `(channel_id) WHERE status = 'ready' AND deleted_at IS NULL` on `lora_models` is unique (partial index). Enforces "one active LoRA per channel".
- `source_photo_count` on `lora_models` is constrained between 10 and 25 in application code (not at the DB layer; we may relax max in Phase 4).
- Photos with `used_in_training = true` may be soft-deleted via cron only; user-initiated delete on a used photo updates `deleted_at` but the storage object is preserved until the post-training 30-day window elapses (§7.4).

---

## 4. API Endpoints

All routes are under `app/api/character/`. All require an authenticated session — middleware on the `(app)` route group rejects unauthenticated requests with `401 { code: "UNAUTHENTICATED" }`.

Field naming follows CLAUDE.md API-1: snake_case in DB and external APIs, camelCase in TypeScript code. Zod schemas perform the transform at the boundary.

### 4.1 `POST /api/character/photos` — upload + validate

**Auth:** required.

**Request:** `multipart/form-data`

| Field | Type | Notes |
|---|---|---|
| `channelId` | string (uuid) | required; must belong to `auth.uid()` |
| `photos` | File[] | 1..25 files per request; total request body ≤ 250 MB |

**Per-file constraints:**

- `mime_type ∈ {image/jpeg, image/png, image/webp}`
- `byte_size ≤ 10 MiB`
- Total photos for the channel (after this upload) ≤ 25 valid + warned + pending. Photos with terminal-rejected status (`no_face`, `multiple_faces` flagged as reject, `low_resolution`, `unreadable`) **do not** count toward this cap; the user can re-upload to replace.

**Response (200 OK):**

```typescript
{
  photos: Array<{
    photoId: string,
    fileName: string,                  // echoed from upload (used for client UI mapping)
    status: "face_detected" | "no_face" | "multiple_faces" | "low_resolution" | "unreadable" | "validation_error",
    width: number | null,
    height: number | null,
    faceBbox: FaceBBox | null,
    rejectionReason: string | null,    // human-readable; null when accepted
    signedThumbUrl: string | null,     // 256x256 thumbnail URL, signed for 1h; null on reject
  }>,
  channelTotals: {
    valid: number,                     // count of face_detected for this channel
    warnings: number,                  // count of multiple_faces (kept) + uniformity / glasses warnings
    rejected: number,                  // count of terminal-reject in THIS request only (not the channel)
    minRequired: 10,
    maxAllowed: 25,
  }
}
```

**Persistence behavior:**

1. For each file, validate `mime_type` and `byte_size` synchronously (cheap). Reject the entire request with `400 { code: "VALIDATION_FAILED", details: { fileName, reason } }` if any file fails — no partial writes.
2. For each file, write to Supabase Storage at `character-photos/{userId}/{channelId}/{photoId}.{ext}` with `metadata.encrypted = true`. (Bucket-level encryption is on; this is belt-and-suspenders.)
3. Insert one `character_photos` row per file with `validation_status = 'pending'`.
4. Run validation pipeline (§5.2) **synchronously** for the request. The face-detection call is fast (~300ms per image); 25 photos in parallel completes in ~1.5s. Update each row with terminal status.
5. Generate a 256×256 thumbnail per accepted photo using Sharp; store at `character-photos/{userId}/{channelId}/thumbs/{photoId}.webp`. Issue a 1h signed URL.
6. Return the response, **including rejected photos** (status reflects the rejection — the client uses this to render the rose-themed reject tile in the grid).

**Rate limit:** A user can upload at most **100 photos per channel per day** (validated against the count of `character_photos` inserts in the last 24h, including rejected). Prevents abuse of the face-detection budget. Returns `429 { code: "RATE_LIMITED", retryAfterSec: N }` on breach.

**Error codes:**

| Code | When | HTTP |
|---|---|---|
| `UNAUTHENTICATED` | No session | 401 |
| `VALIDATION_FAILED` | Bad mime, too-large file, missing channelId, invalid form | 400 |
| `CHANNEL_NOT_FOUND` | `channelId` does not belong to user | 404 |
| `PHOTO_VALIDATION_FAILED` | Vision provider hard failure on all photos in the request (zero validations succeeded) | 422 |
| `RATE_LIMITED` | Daily upload cap hit | 429 |
| `STORAGE_FULL` | Channel already has 25 active photos and request would exceed cap | 409 |
| `UPSTREAM_ERROR` | Vision provider transient failure after 3 retries | 502 |
| `INTERNAL_ERROR` | Bug or unexpected state | 500 |

### 4.2 `DELETE /api/character/photos/[photoId]`

**Auth:** required.

**Behavior:**

1. Verify the photo belongs to `auth.uid()` (RLS will also enforce).
2. If `used_in_training = false`: hard-delete the storage objects (full + thumb) and delete the row.
3. If `used_in_training = true`: soft-delete (`deleted_at = now()`) and remove from any training UI selection. Storage retention follows the 30-day post-training cron (§7.4), so the photo remains for legal / audit purposes until then. The user is informed: `{ retainedUntil: "<iso8601>" }`.
4. If a training job is currently `queued` or `training` and includes this photo's id in `source_photo_ids`, return `409 { code: "TRAINING_IN_PROGRESS" }` and refuse the delete. The user must wait or cancel training first.

**Response (200 OK):**

```typescript
{ photoId: string, hardDeleted: boolean, retainedUntil: string | null }
```

### 4.3 `POST /api/character/train` — kick off training

**Auth:** required.

**Request body:**

```typescript
{
  channelId: string,
  trainingSteps?: number,        // optional; 800..1500; defaults to 1200
  acknowledgeWarnings?: boolean, // required true if uniformity_warning or hat_or_glasses_warning will be set
}
```

**Behavior:**

1. Verify the channel belongs to the user. If not: `404 CHANNEL_NOT_FOUND`.
2. Load all `character_photos` for the channel where `validation_status = 'face_detected'` and `deleted_at IS NULL`.
3. If count < 10: `422 { code: "INSUFFICIENT_PHOTOS", details: { have: N, need: 10 } }`.
4. Compute warnings (§5.6). If any warning fires and `acknowledgeWarnings !== true`: return `409 { code: "WARNINGS_REQUIRE_ACK", warnings: [...] }`. Client must re-call with `acknowledgeWarnings: true`.
5. Check if there's an in-flight training for this channel (`status IN ('queued','training')`): if so, `409 { code: "TRAINING_IN_PROGRESS", loraModelId }`.
6. Check Replicate quota (cached in `replicate_quota_usage`, see §8): if exhausted, `503 { code: "REPLICATE_QUOTA" }`.
7. Open a transaction:
   - Mark any existing `status = 'ready'` row for this channel as `superseded` with `rollback_until = now() + interval '7 days'`.
   - Generate `trigger_token = "creator_" + base32(sha256(channelId).slice(0, 5)).toLowerCase()` (§5.4).
   - Generate `webhook_secret = randomBytes(32).toString("hex")`.
   - Insert a new `lora_models` row with `status = 'queued'`, the photo ids, `training_steps`, etc.
   - Mark the selected photos as `used_in_training = true`.
   - Insert a `character_training_events` row of `event_type = 'queued'`.
8. Commit. Asynchronously (in the same request — fire-and-forget but server-side, not via cron) submit to Replicate via `lib/replicate/train.ts` (§5.5). On submission success, update `status = 'training'`, `training_job_id`, `started_at = now()`. On submission failure, update `status = 'failed'`, `failure_code = 'REPLICATE_QUOTA' | 'UPSTREAM_ERROR'`.
9. Return immediately with the new model row.

**Response (202 Accepted):**

```typescript
{
  loraModelId: string,
  channelId: string,
  status: "queued" | "training" | "failed",
  triggerToken: string,
  estimatedCompletionAt: string,   // queuedAt + 30min, refined to startedAt + 30min once training starts
  warningsAcknowledged: Warning[],
}
```

**Error codes:** `UNAUTHENTICATED`, `CHANNEL_NOT_FOUND`, `VALIDATION_FAILED`, `INSUFFICIENT_PHOTOS`, `WARNINGS_REQUIRE_ACK`, `TRAINING_IN_PROGRESS`, `REPLICATE_QUOTA`, `UPSTREAM_ERROR`, `INTERNAL_ERROR`.

### 4.4 `GET /api/character/[channelId]` — model status

**Auth:** required.

**Response (200 OK):**

```typescript
{
  channelId: string,
  status: LoRAStatus,                                // 'not_trained' if no row exists
  loraModelId: string | null,
  triggerToken: string | null,
  trainingSteps: number | null,
  sourcePhotoCount: number,                          // count of valid (face_detected, !deleted) photos
  totalPhotoCount: number,                           // count of all (face_detected, !deleted) photos for the channel
  sampleRenders: SampleRender[],                     // [] until status = 'ready'
  warnings: Warning[],
  costCents: number,
  queuedAt: string | null,
  startedAt: string | null,
  completedAt: string | null,
  estimatedCompletionAt: string | null,              // null when status not in ('queued','training')
  rollbackAvailable: {                                // present only when a 'superseded' model exists within window
    loraModelId: string,
    triggerToken: string,
    expiresAt: string,
  } | null,
  photos: CharacterPhoto[],                          // up to 25, ordered uploadedAt desc
}
```

**Cache:** none — the status page polls this endpoint every 10s when `status IN ('queued','training')`. Keep response < 100 KB by capping `photos` at 25 and `sampleRenders` at 4.

### 4.5 `DELETE /api/character/[channelId]/model` — purge model + photos

**Auth:** required.

**Request body:**

```typescript
{
  scope: "model_only" | "model_and_photos",
  confirmText: string,                  // must be "DELETE" exactly (mockup confirmation modal)
}
```

**Behavior:**

1. Validate ownership; verify `confirmText === "DELETE"` else `400 VALIDATION_FAILED`.
2. If `scope === "model_only"`: soft-delete (`deleted_at = now()`) the active `lora_models` row, schedule storage purge (model weights + sample renders) via cron in 24h (gives the user a brief window to recover via support, though no UI exists for this). Photos remain. Trigger token is freed.
3. If `scope === "model_and_photos"`: do the above, plus soft-delete all `character_photos` for the channel and immediately purge their storage objects. (Photos can be re-uploaded; nothing to recover.)
4. If `status IN ('queued','training')`: cancel the Replicate prediction (`POST /predictions/{id}/cancel`), then proceed with delete. Photos remain `used_in_training = true` (the cron handles them on schedule).

**Response (200 OK):**

```typescript
{
  loraModelId: string,
  modelPurgeScheduledAt: string,       // ISO; 24h from now
  photosDeleted: number,               // 0 if scope = model_only
}
```

### 4.6 `POST /api/character/[channelId]/rollback` — restore previous model (if available)

**Auth:** required.

**Behavior:**

1. Find the most recent `superseded` row for the channel where `rollback_until > now()`.
2. If none: `404 { code: "NO_ROLLBACK_AVAILABLE" }`.
3. In a transaction:
   - Mark the current active `ready` row as `superseded` with `rollback_until = now() + interval '7 days'` (the user can roll back this rollback).
   - Mark the previous `superseded` row as `ready` with `rollback_until = null`.
   - Both rows continue to point at the same `trigger_token` only if the channel's trigger token deterministically derives from `channel_id` (it does — see §5.4); otherwise the rolled-back row's token is restored.
4. Insert `character_training_events` row of type `rollback`.

**Response (200 OK):**

```typescript
{ loraModelId: string, triggerToken: string }
```

### 4.7 `POST /api/character/webhook/[loraModelId]` — Replicate training-complete webhook

**Auth:** **NOT session-based.** Verifies `webhook_secret` query parameter (HMAC-equality) plus the Replicate-signed `webhook-signature` header (HMAC-SHA-256 of body using the per-row secret). Both must match. Failure → `401`. See §5.5.4 for verification details.

**Request body:** Replicate's prediction payload — see Replicate docs. Relevant fields:

```json
{
  "id": "abc123",
  "status": "succeeded" | "failed" | "canceled",
  "output": "https://replicate.delivery/.../trained_model.safetensors",
  "error": "...",
  "metrics": { "predict_time": 1820 }
}
```

**Behavior:**

1. Look up `lora_models` by `loraModelId`. If not found or already terminal (`ready/failed/superseded/purged`): return `200 { ignored: true }` (idempotent).
2. Verify HMAC. On mismatch: log + `401`.
3. If `status === 'succeeded'`:
   - Download `output` URL into Supabase Storage at `lora-models/{userId}/{channelId}/{loraModelId}.safetensors`.
   - Update `model_weights_url`, `model_weights_bytes`, `cost_cents` (computed from `metrics.predict_time` × Replicate's per-second price; default $3 for the standard 1200-step run).
   - Trigger sample-render flow (§5.7) — this is async; samples land in another webhook or are awaited synchronously here (decided per latency budget, see §5.7).
   - Once samples are in: update `status = 'ready'`, `completed_at = now()`. Send the training-complete email (§5.8). Insert `character_training_events` rows of `weights_downloaded`, `samples_rendered`.
4. If `status === 'failed'`:
   - Update `status = 'failed'`, `failure_code = 'TRAINING_FAILED'`, `failure_detail = error` (truncated to 1000 chars), `completed_at = now()`. Reset `used_in_training = false` on the source photos (so the user can retry).
   - Send a training-failed email (§5.8 alt).
5. If `status === 'canceled'`: same as `failed` but with `failure_code = 'CANCELED'` and no email.
6. Return `200 { ok: true }`.

**Response shape:** `200 { ok: true } | 200 { ignored: true } | 401 { error: "INVALID_SIGNATURE" }`.

### 4.8 API contract summary

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/api/character/photos` | Upload + validate photos | session |
| DELETE | `/api/character/photos/[photoId]` | Delete a photo | session |
| POST | `/api/character/train` | Kick off training | session |
| GET | `/api/character/[channelId]` | Model status + photos | session |
| DELETE | `/api/character/[channelId]/model` | Purge model (+ optionally photos) | session |
| POST | `/api/character/[channelId]/rollback` | Restore prior `superseded` model | session |
| POST | `/api/character/webhook/[loraModelId]` | Replicate webhook callback | HMAC |

---

## 5. Business Logic

### 5.1 Photo upload + storage architecture

**Upload path:**

1. Client posts `multipart/form-data` to `/api/character/photos`. Each file is read into memory (max 10 MiB × 25 = 250 MiB worst case; the route handler runs on Vercel's larger-payload runtime, declared via `export const runtime = 'nodejs'` and `export const maxDuration = 60` and a `bodyParser.sizeLimit = '256mb'` config).
2. For each file:
   - **Sniff MIME** using `file-type` (npm) — do not trust the form-supplied content-type.
   - **Probe dimensions + extract metadata** via Sharp (`sharp(buffer).metadata()`).
   - Reject pre-storage if MIME unknown, EXIF-corrupt, or any dimension < 768.
3. Generate `photoId = uuid()`. Upload bytes to Supabase Storage with the path scheme:

```
character-photos/{userId}/{channelId}/{photoId}.{ext}
```

   - Bucket: `character-photos` — **private** (no public-read).
   - Storage encryption at rest is enabled at bucket level (Supabase default for private buckets).
4. Generate a 256×256 cover thumbnail using Sharp (`sharp(buffer).resize(256, 256, { fit: 'cover' }).webp({ quality: 80 })`), upload to the same bucket under `character-photos/{userId}/{channelId}/thumbs/{photoId}.webp`.
5. Insert `character_photos` row with `validation_status = 'pending'`.
6. Run validation (§5.2). On terminal status, update the row.
7. Return signed URL for the thumbnail (1h TTL) so the client can render the tile.

**Why thumbnails:** the model-status page (`/character`) displays up to 25 photo tiles. Loading the full-res images would be wasteful and slow; thumbnails keep the page snappy and let us serve through signed URLs without re-running expensive transforms per request.

**Storage layout (full):**

```
Supabase Storage bucket: character-photos
  {userId}/
    {channelId}/
      {photoId}.{jpg|png|webp}        # full-resolution source
      thumbs/
        {photoId}.webp                # 256x256 cover thumbnail

Supabase Storage bucket: lora-models
  {userId}/
    {channelId}/
      {loraModelId}.safetensors       # trained weights
      samples/
        {loraModelId}-{1..4}.webp     # sample renders
```

Both buckets are private; only signed URLs are issued. The `lora-models` bucket signed URL TTL is 1h (consumer endpoints regenerate as needed).

### 5.2 Validation pipeline

Each uploaded photo runs through a four-step validation:

1. **Format + dimension check** (synchronous, local, free):
   - MIME ∈ {jpg, png, webp}; reject otherwise → `unreadable`.
   - `width >= 768 and height >= 768`; reject otherwise → `low_resolution`.

2. **Face detection** (provider call):
   - Provider: **Replicate face-detect** (`recognizing-anything/face-detection`) is the v1 default. Alternative: Google Cloud Vision `FACE_DETECTION`. Decision driver: Replicate keeps us on a single provider for character training + face detection (one billing, one auth, one quota).
   - Input: full-resolution photo bytes.
   - Output: array of detected face bounding boxes, plus per-face confidence and (optionally) embedding vectors.
   - Mapping:
     - 0 faces → `no_face` (rejected, terminal).
     - 1 face with confidence ≥ 0.85 → `face_detected` (accepted). Store `face_bbox` and `face_embedding`.
     - 1 face with confidence < 0.85 → `no_face` (treat as ambiguous).
     - 2+ faces → `multiple_faces`. **Decision: keep with warning, do not auto-crop in v1** (PRD says auto-crop is desired but adds complexity; defer). The largest face's bbox is recorded for future auto-crop. UI marks the tile amber with "multi-face" pill and excludes it from training selection by default; the user can override via a checkbox.
   - Retry: 3 attempts with exponential backoff per CLAUDE.md EXT-3 on 429/5xx; do not retry on 4xx.
   - Cost: ~$0.0011 per call on Replicate face-detect. 25 photos = ~$0.03 per upload session.

3. **Variance / dedup check** (post-acceptance, local):
   - For each new accepted photo, compute cosine distance against every other accepted photo's embedding.
   - If min distance < 0.05: dedup warning ("very similar to another photo"). Photo is still accepted; UI surfaces the warning. (Not a reject: the user may legitimately want similar photos.)
   - Channel-level variance (see §5.6) is computed at training-trigger time, not here.

4. **Persist + emit event:**
   - Update the `character_photos` row with the terminal status.
   - Insert a `character_training_events` row of type `validation_warning` if any warning surfaced (note: this table refers to `lora_model_id`, so for upload-time warnings we omit the FK and use `NULL` — handled by adding a separate `character_photo_events` table; **decision: skip per-photo audit log in v1**, validation outcomes are captured on `character_photos` itself).

**Why face-detect on every upload (not just at train time):** rejecting bad photos on upload is the only way to give immediate feedback in the UI (mockup State 2). Deferring to train-time means the user uploads 25 photos, hits Train, and gets a generic "validation failed" 30 seconds later — broken UX. The cost is small (~$0.03/session) and the budget is bounded by the per-day rate limit.

### 5.3 Training trigger flow

When the user clicks "Train your character" on `/character/train`:

1. Client POSTs `/api/character/train` with `{ channelId, trainingSteps?, acknowledgeWarnings? }`.
2. Server runs the §4.3 logic.
3. Server response is rendered as a transition: `/character/train` → `/character` with status pill "Training (~30 min)".
4. The `/character` page polls `GET /api/character/[channelId]` every 10s while `status IN ('queued','training')` and shows a progress bar based on `now - startedAt` against the 30-min ETA.
5. When the page receives `status = 'ready'`, polling stops and the sample-renders gallery is rendered.

### 5.4 Trigger token format and uniqueness

Trigger tokens are the special string we inject into image-generation prompts (Feature #23) to invoke the LoRA. They must be:

- **Unique per channel** (so multi-channel users don't cross-contaminate).
- **Stable across re-trains for the same channel** (so Feature #23 prompts don't break when the user retrains).
- **Hard to collide with natural English** (so the base FLUX model doesn't accidentally fire the LoRA when the prompt happens to contain the token).
- **Short enough to fit in prompts** (FLUX prompts are budgeted; tokens beyond ~16 chars eat into the prompt budget).

**Format:** `creator_<8-char-base32-channel-hash>`

```typescript
// lib/character/trigger-token.ts
import { createHash } from "node:crypto";

export function deriveTriggerToken(channelId: string): string {
  // Deterministic per channel — survives retrains.
  const hash = createHash("sha256").update(channelId).digest();
  // Base32 (Crockford alphabet, lowercase, no padding) on the first 5 bytes → 8 chars.
  const base32 = encodeBase32Crockford(hash.subarray(0, 5)).toLowerCase();
  return `creator_${base32}`;
}
```

Examples: `creator_a1b2c3d4`, `creator_x7yk9m2p`. Probability of collision across 1M channels is ≈ 1 in 28 million per the birthday bound.

**Stability:** the token is derived from the immutable `channels.id` UUID. Retraining the LoRA does not change the token, so any thumbnails generated previously continue to invoke the LoRA correctly when the prompt is re-run (idempotency win for Feature #23).

**Reservation:** the token is also written to the `lora_models` row at queue-time, but the canonical source is the derivation function. The DB column exists for ergonomics (joins, logging) and for the rare case where we need to migrate the format (we'd backfill the column without touching the function).

### 5.5 Replicate FLUX-LoRA training integration

**Reference:** Adapted from Replicate's [`ostris/flux-dev-lora-trainer`](https://replicate.com/ostris/flux-dev-lora-trainer) public model. No code is lifted from Replicate examples — the integration is our own — so no MIT-style attribution is required. (CLAUDE.md CRIT-4 attribution applies to `claude-youtube` only.)

#### 5.5.1 Submission

```typescript
// lib/replicate/train.ts
import Replicate from "replicate";

const replicate = new Replicate({ auth: env.REPLICATE_API_TOKEN });

export async function submitTraining(input: {
  loraModelId: string,
  webhookSecret: string,
  triggerToken: string,
  trainingSteps: number,
  resolution: 768 | 1024,
  zipUrl: string,                       // signed URL to a temporary ZIP of the source photos
}): Promise<{ predictionId: string }> {
  const webhookUrl =
    `${env.APP_URL}/api/character/webhook/${input.loraModelId}` +
    `?secret=${input.webhookSecret}`;

  const prediction = await replicate.trainings.create(
    "ostris",
    "flux-dev-lora-trainer",
    "<latest_version_id_pinned_in_env>",
    {
      input: {
        input_images:        input.zipUrl,
        trigger_word:        input.triggerToken,
        steps:               input.trainingSteps,
        resolution:          input.resolution,
        learning_rate:       0.0004,
        batch_size:          1,
        lora_rank:           16,
        optimizer:           "adamw8bit",
        autocaption:         true,            // let trainer auto-caption per photo
      },
      destination: `${env.REPLICATE_USERNAME}/yt-viralizer-${input.loraModelId}`,
      webhook: webhookUrl,
      webhook_events_filter: ["completed"],
    }
  );
  return { predictionId: prediction.id };
}
```

**ZIP packaging:** before submission, we package the selected photos into a single ZIP and upload it to a temp Supabase Storage path (`character-photos/{userId}/{channelId}/training-zips/{loraModelId}.zip`), then issue a 24h signed URL. The ZIP is hard-deleted after the webhook fires (success or failure).

**Why ZIP:** Replicate's FLUX-LoRA trainer accepts `input_images` as a single archive URL or a multi-image upload. ZIP is simpler than orchestrating 25 individual uploads through their API.

#### 5.5.2 Polling fallback

Replicate webhooks are reliable but we run a safety-net cron (`/api/cron/character/poll-training`) every 5 minutes that:

1. Selects all `lora_models` with `status IN ('queued','training')` and `started_at < now() - interval '45 minutes'` (i.e., past the expected 30-min budget plus 15-min slack).
2. For each, calls `replicate.predictions.get(training_job_id)` (1 API call, free per Replicate's pricing).
3. If the remote status is terminal but our DB still says `training`, manually drives the webhook handler logic (idempotent).
4. If the remote status is `processing` after 90 minutes total, marks our row as `failed` with `failure_code = 'TRAINING_TIMEOUT'`.

This catches dropped webhooks, network partitions, and Replicate's occasional retry-loop bugs without burning the user's patience.

#### 5.5.3 Webhook URL signing

The webhook URL has the shape `/api/character/webhook/{loraModelId}?secret={webhookSecret}`. Two layers of verification:

1. **Per-row secret check** — the `secret` query parameter must equal `lora_models.webhook_secret` (constant-time compare).
2. **Replicate-signed body check** — Replicate signs every webhook with our account's webhook secret (configured once in Replicate dashboard, stored in `env.REPLICATE_WEBHOOK_SIGNING_SECRET`). The handler verifies the `webhook-signature` header per Replicate's docs.

Both layers are required. The per-row secret protects against a leaked Replicate secret being used to spoof webhooks for arbitrary models; the Replicate signature protects against an attacker who knows the row layout but not the global signing secret.

#### 5.5.4 Failure modes

| Replicate status | Our `failure_code` | User-facing email | source_photos `used_in_training` |
|---|---|---|---|
| `failed` (training error) | `TRAINING_FAILED` | yes (alt template) | reset to false |
| `failed` (input error — bad zip) | `TRAINING_INPUT_INVALID` | yes (with retry CTA) | reset to false |
| `canceled` (user-initiated via #4.5) | `CANCELED` | no | reset to false |
| timeout (cron, >90 min) | `TRAINING_TIMEOUT` | yes (with retry CTA) | reset to false |
| webhook lost + cron caught it as succeeded | n/a (status moves to ready) | yes (standard) | retained as true |

### 5.6 Pre-training warnings

Computed at `/api/character/train` time (§4.3 step 4) over the **selected** source photos:

#### 5.6.1 Uniformity warning

```typescript
function computeVarianceScore(embeddings: number[][]): number {
  // Pairwise cosine distances → mean distance.
  const distances: number[] = [];
  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      distances.push(cosineDistance(embeddings[i], embeddings[j]));
    }
  }
  return distances.reduce((a, b) => a + b, 0) / distances.length;
}
```

If `variance_score < 0.15`: emit `{ type: 'uniformity', severity: 'warn', message: 'Your photos look very similar. The model will produce limited pose / expression variety. Consider adding photos with different angles, lighting, and expressions.' }`.

If embeddings are unavailable (vision provider didn't return them): skip this check and emit no warning.

#### 5.6.2 Hat / glasses warning

The face-detect provider's optional attributes may include `wearing_hat`, `wearing_sunglasses`. If ≥ 30% of selected photos have either: emit `{ type: 'hat_or_glasses', severity: 'warn', message: 'Many of your photos feature hats or sunglasses. The model may be biased toward those accessories. Consider adding plain-face photos.' }`.

If the provider doesn't support attribute classification: skip.

#### 5.6.3 Low-count warning

If `selectedCount === 10` (the minimum): emit `{ type: 'low_count', severity: 'warn', message: 'You\'re training with the minimum 10 photos. 15–25 is the sweet spot for quality. Consider adding more.' }`. Not a blocker.

#### 5.6.4 Multi-face dropped notice (info)

If any photos with `validation_status = 'multiple_faces'` were excluded: emit `{ type: 'multi_face_dropped', severity: 'info', message: 'N photos with multiple faces were excluded from training.' }`.

**Acknowledgment contract:** any warning of `severity: 'warn'` requires `acknowledgeWarnings: true` on the train POST. `info` warnings do not.

### 5.7 Sample-render flow (post-training quality verification)

When a training job succeeds and weights land in Supabase Storage, we automatically generate **4 sample thumbnails** to verify the LoRA works before notifying the user.

**Sample prompts** (parameterized with the trigger token):

```typescript
const SAMPLE_PROMPTS = [
  "{token} smiling in a YouTube studio with bright lighting, looking at the camera, sharp focus, professional photography, 16:9",
  "{token} pointing at a colorful infographic, dynamic pose, surprised expression, vibrant background, 16:9",
  "{token} in a side profile speaking into a microphone, podcast studio, dramatic lighting, 16:9",
  "{token} wearing a casual hoodie, neutral background, neutral expression, photorealistic, 16:9",
];
```

These are intentionally generic so the visual quality of the LoRA shows through without scene-design noise. They are also chosen to span pose + expression + lighting variance — a LoRA that fails on one but passes the others is informative for the user.

**Generation pipeline:**

1. After webhook handler downloads weights, before sending the email, call Feature #23's image-generation provider (FLUX.1 [dev] via Replicate or a hosted FLUX endpoint — TBD by Feature #23) with each sample prompt.
2. Each render uses:
   - The freshly-trained LoRA (referenced by Replicate model name `${env.REPLICATE_USERNAME}/yt-viralizer-${loraModelId}`).
   - LoRA strength: 0.85 (default for FLUX-LoRA per Replicate's recommended range; tuned later).
   - Resolution: 1280×720 (16:9, YouTube thumbnail aspect).
3. Save each render to `lora-models/{userId}/{channelId}/samples/{loraModelId}-{i}.webp`.
4. Update `lora_models.sample_render_urls` JSONB array with `[{prompt, signedUrl, width, height}]`.
5. Cost: 4 renders × ~$0.04 each (FLUX dev pricing) ≈ $0.16 per training. Recorded in `cost_cents`.

**Latency:** sample rendering takes ~15s per render in parallel = ~15s total. Adding 15s to the 30-min training time is invisible to the user (they're already waiting for the email).

**Failure:** if sample rendering fails for any reason, the training is still marked `ready` but `sample_render_urls = []` and the email is sent anyway. The `/character` page renders an "Samples unavailable — try a real generation" placeholder. Feature #23 still works.

### 5.8 Email notifications (Resend)

**Template registry:** `lib/email/templates/character-trained.tsx` and `character-training-failed.tsx`. React-email components rendered server-side and passed to `resend.emails.send`.

#### 5.8.1 `character-trained` (success)

- **Subject:** `Your character is trained`
- **Preheader:** `Sample renders are ready — preview them in the app.`
- **Body (essentials):**
  - Greeting with channel title.
  - 4 sample-render thumbnails laid out 2×2 (each linked to /character).
  - Primary CTA button: "View your character" → `${APP_URL}/character?channelId={channelId}`.
  - Trigger token disclosed: "Your trigger: `creator_a1b2c3d4` — every AI thumbnail you generate now includes your face."
  - Footer: privacy notice ("Source photos are auto-deleted in 30 days"), unsubscribe link, support contact.
- **Send:** through `lib/email/resend.ts` wrapper. Idempotency key: `character-trained:{loraModelId}` (Resend supports this; ensures duplicate webhooks don't double-send).

#### 5.8.2 `character-training-failed` (failure)

- **Subject:** `Character training didn't finish`
- **Preheader:** `Try again with a different photo selection.`
- **Body:** explains what failed in user-friendly terms (we never expose Replicate's raw error), with a "Try again" CTA → `${APP_URL}/character/train?channelId={channelId}` and a support email link.

#### 5.8.3 Sender + reply-to

- From: `YouTube Viralizer <hello@yt-viralizer.com>` (configured in `env.RESEND_FROM_ADDRESS`).
- Reply-to: `support@yt-viralizer.com`.

---

## 6. Storage Architecture

### 6.1 Bucket configuration

Two private Supabase Storage buckets:

| Bucket | Visibility | Encryption | Avg object size | Retention |
|---|---|---|---|---|
| `character-photos` | private | AES-256 at rest (Supabase default) | 500 KB–4 MB | full: 30d post-training; thumbs: with model |
| `lora-models` | private | AES-256 at rest | weights ~150 MB; samples ~200 KB | weights: with model; samples: with model |

Both buckets have:

- `public: false`
- `file_size_limit: 10485760` (10 MiB) on `character-photos`; `268435456` (256 MiB) on `lora-models`
- `allowed_mime_types: ['image/jpeg','image/png','image/webp']` on `character-photos`; `application/octet-stream` on `lora-models`
- RLS policies on `storage.objects`:

```sql
create policy "character_photos_owner_only" on storage.objects
  for all using (
    bucket_id = 'character-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "lora_models_owner_only" on storage.objects
  for all using (
    bucket_id = 'lora-models'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

### 6.2 Signed URL strategy

- **Photo thumbnails:** signed URL TTL 1h. Re-issued on every `/character` page render. Cached client-side via SWR.
- **Photo full-res:** never directly served to clients. The user has no need to download originals; rendering is via the thumbnail. Internal training pipeline reads via service-role key.
- **Sample renders:** signed URL TTL 1h. Re-issued on every `/character` and email render. Email body uses a longer-lived 7d signed URL since the email is consumed asynchronously and re-issuing is impossible.
- **Model weights:** never exposed to clients. Read only by Feature #23's inference path via service-role key.

### 6.3 Storage budget

Per-user, per-channel, worst case:

| Asset | Count | Size | Subtotal |
|---|---|---|---|
| Source photos | 25 | 4 MiB | 100 MiB |
| Thumbnails | 25 | 50 KiB | 1.25 MiB |
| Model weights | 1 | 150 MiB | 150 MiB |
| Sample renders | 4 | 200 KiB | 0.8 MiB |
| **Total per channel** | | | **~252 MiB** |

For a 3-channel user: ~756 MiB. After 30d auto-delete (source photos go), drops to ~452 MiB per user.

Supabase Pro tier includes 100 GB of storage. We can support ~220 active 3-channel users on storage alone before needing to bump tier — well past Phase 3 traction expectations.

---

## 7. Privacy + Data Retention

### 7.1 Privacy guarantees (user-facing)

The `/character/train` flow displays these guarantees inline (per mockup State 1 and State 2):

1. **Photos are encrypted at rest** — Supabase Storage AES-256.
2. **Photos auto-delete 30 days after training** — the model retains learned weights only.
3. **Photos are owner-scoped** — RLS + storage policies block cross-user access.
4. **Model weights are never used for cross-user training** — explicit guarantee. We never aggregate user weights into a base model.
5. **You can purge everything at any time** — `/api/character/[channelId]/model` with `scope=model_and_photos`.

### 7.2 TOS attestation (deepfake risk)

On the upload screen, a checkbox is required before training: "By training, I confirm the photos are of me, or I have explicit consent from the person depicted." Linked to `${APP_URL}/legal/terms#character-training`.

**No automated detection in v1.** PRD explicitly says "v1 trusts user attestation". Future work may add face-against-channel-banner cross-check.

### 7.3 Cross-user contamination prevention

Three layers:

1. **DB-level:** RLS policies on `character_photos`, `lora_models`, `storage.objects` filter by `auth.uid()`.
2. **Replicate-level:** every training is created in a dedicated `destination` namespace `${REPLICATE_USERNAME}/yt-viralizer-${loraModelId}`. Replicate's training infrastructure does not aggregate trainings across destinations.
3. **Inference-level (Feature #23):** the trigger token `creator_<channelHash>` ensures even if model weights were accidentally shared, only prompts containing the right token would fire the wrong LoRA — and the token is derived from `channelId`, so the cross-fire risk is bounded by hash collisions (negligible).

### 7.4 Auto-deletion cron

A daily cron (`/api/cron/character/auto-delete-photos`) runs at 03:00 UTC:

```typescript
// Daily auto-delete of source photos 30d post-training.
// Soft-delete the row, hard-delete the storage objects.

const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
const photosToPurge = await db
  .from("character_photos")
  .select("id, storage_path, lora_models!inner(completed_at)")
  .eq("used_in_training", true)
  .is("deleted_at", null)
  .lte("lora_models.completed_at", cutoff);

for (const photo of photosToPurge) {
  await supabase.storage.from("character-photos").remove([
    photo.storage_path,
    photo.storage_path.replace(/(\.[^/]+)$/, "").replace(`/${userId}/${channelId}/`, `/${userId}/${channelId}/thumbs/`) + ".webp",
  ]);
  await db.from("character_photos").update({ deleted_at: new Date() }).eq("id", photo.id);
}
```

**Edge case:** if the user has retrained, the same photo set's `used_in_training` may be reset to false (5.5.4 failure path). Those photos are not purged. The 30-day rule applies only when the most recent training that used them succeeded.

### 7.5 Superseded model cleanup cron

A daily cron (`/api/cron/character/purge-superseded`) at 04:00 UTC:

```typescript
// Hard-delete weights of superseded models past their rollback window.

const purgeable = await db
  .from("lora_models")
  .select("id, model_weights_url, sample_render_urls")
  .eq("status", "superseded")
  .lte("rollback_until", new Date());

for (const model of purgeable) {
  if (model.model_weights_url) {
    await supabase.storage.from("lora-models").remove([model.model_weights_url]);
  }
  for (const sample of (model.sample_render_urls ?? [])) {
    await supabase.storage.from("lora-models").remove([sample.storage_path]);
  }
  await db.from("lora_models").update({
    status: "purged",
    model_weights_url: null,
    sample_render_urls: [],
    deleted_at: new Date(),
  }).eq("id", model.id);
  await db.from("character_training_events").insert({
    lora_model_id: model.id,
    event_type: "purged",
  });
}
```

### 7.6 User-initiated purge

`DELETE /api/character/[channelId]/model` with `scope=model_and_photos`:

1. Cancels any in-flight Replicate training.
2. Hard-deletes all storage objects for the channel under both buckets.
3. Hard-deletes (not soft) `character_photos` rows.
4. Soft-deletes the `lora_models` row (kept for audit, weights cleared).
5. Inserts `character_training_events` of type `purged`.

**SLA:** purge completes within 5 seconds for typical channels. The user sees a confirmation toast and is redirected to `/character` empty state.

### 7.7 GDPR / data-export considerations

A user requesting their data via support gets:

- The `character_photos` rows (metadata; binaries already deleted if past 30d).
- The `lora_models` rows (metadata + sample render URLs if still in storage).
- The training event log.

Model weights are **not** exported — they're a derivative work and not user-readable. Supersedes any "data portability" claim in v1; the TOS clarifies this.

---

## 8. External Service Quotas + Cost Controls

### 8.1 Replicate quota tracking

Per CLAUDE.md CRIT-1 spirit (track and budget every external API). New table:

```sql
create table public.replicate_quota_usage (
  id            uuid primary key default gen_random_uuid(),
  bucket_date   date not null,                       -- UTC date bucket
  endpoint      text not null,                       -- 'train' | 'face_detect' | 'inference' | 'cancel' | 'get'
  cost_cents    integer not null,                    -- USD cents
  request_count integer not null default 1,
  created_at    timestamptz not null default now()
);

create index replicate_quota_usage_date_endpoint
  on public.replicate_quota_usage (bucket_date, endpoint);
```

Helper:

```typescript
// lib/replicate/quota.ts
export async function checkReplicateBudget(): Promise<{ allowed: boolean, usedCentsToday: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await db
    .from("replicate_quota_usage")
    .select("cost_cents")
    .eq("bucket_date", today);
  const total = (data ?? []).reduce((a, b) => a + b.cost_cents, 0);
  const dailyCapCents = env.REPLICATE_DAILY_CAP_CENTS; // default 10000 = $100/day
  return { allowed: total < dailyCapCents, usedCentsToday: total };
}
```

`/api/character/train` calls `checkReplicateBudget()` before submission. If exhausted: `503 REPLICATE_QUOTA`.

### 8.2 Cost summary per training

| Item | Cost |
|---|---|
| FLUX-LoRA training (1200 steps) | ~$3.00 |
| Face detection (25 photos) | ~$0.03 |
| Sample renders (4× FLUX inference) | ~$0.16 |
| **Per-training total** | **~$3.19** |

Recorded in `lora_models.cost_cents` (rounded up to whole cents).

### 8.3 Per-user limits

- **Trainings per user per day:** 5. Beyond 5, return `429 RATE_LIMITED`. Prevents runaway loops on a stuck retrain UX.
- **Concurrent trainings per user:** 1. Multi-channel users must train channels serially. Returns `409 TRAINING_IN_PROGRESS` on the second.
- **Photos uploaded per user per day:** 100 (across all channels).

These limits live in `lib/character/limits.ts` and are checked at the top of each route.

---

## 9. Cross-Feature Contracts

### 9.1 Read-side contract with Feature #23 (AI Thumbnail Generation)

Feature #23's image-generation route reads `lora_models` to decide whether to invoke a per-channel LoRA. The contract:

```typescript
// In Feature #23's service (lib/services/thumbnail-generation.ts)
import { getActiveLora } from "@/lib/db/character";

async function generateThumbnail(input: { channelId: string, briefId: string, prompt: string }) {
  const lora = await getActiveLora(input.channelId);

  if (lora?.status === "ready" && lora.modelWeightsUrl) {
    const augmentedPrompt = `${lora.triggerToken} ${input.prompt}`;
    return await imageProvider.generate({
      prompt: augmentedPrompt,
      lora: {
        modelRef: lora.replicateModelRef,        // e.g., 'username/yt-viralizer-{loraModelId}'
        strength: 0.85,
      },
      // ... rest
    });
  }

  // No LoRA: standard generation.
  return await imageProvider.generate({ prompt: input.prompt /* ... */ });
}
```

**`getActiveLora(channelId)` contract** (exported from `lib/db/character.ts`):

```typescript
export type ActiveLora = {
  loraModelId: string,
  channelId: string,
  triggerToken: string,
  modelWeightsUrl: string,
  replicateModelRef: string,
  status: "ready",
};

export async function getActiveLora(channelId: string): Promise<ActiveLora | null> {
  const row = await db
    .from("lora_models")
    .select("*")
    .eq("channel_id", channelId)
    .eq("status", "ready")
    .is("deleted_at", null)
    .maybeSingle();
  return row ? mapRow(row) : null;
}
```

This is **read-only** from Feature #23's perspective. Feature #23 never writes to `lora_models` or `character_photos`.

### 9.2 Read-side contract with Feature #01 (Channel Onboarding)

Feature #24 reads `channels.id`, `channels.user_id`, `channels.title` to validate ownership and personalize emails. No write-side coupling. The trigger token derives from `channels.id` (UUID), which is immutable, so onboarding's idempotent re-onboard logic does not affect existing LoRAs.

If a channel is **soft-deleted** (Feature #01 §4.6), the cascade-delete on `channels` is `ON DELETE CASCADE` for `lora_models` and `character_photos` foreign keys, but Feature #01 uses **soft delete** (`deleted_at` column, no row removal). The cascade therefore does not fire. We rely on a join query in the daily auto-delete cron to handle this:

```sql
-- Channel-soft-delete cascade for character data (runs in the same daily cron):
update public.lora_models lm
set status = 'purged', deleted_at = now()
from public.channels c
where lm.channel_id = c.id
  and c.deleted_at is not null
  and lm.deleted_at is null;

-- Same for character_photos.
```

The cron also schedules storage purge for the now-orphaned objects.

### 9.3 Independence from `pipeline_runs`

Feature #24 does **not** touch `pipeline_runs`. Training is initiated from `/character`, not from a pipeline run. A pipeline run that fires Feature #23 reads the LoRA passively via §9.1. There is no `pipeline_runs.character_state` column — the LoRA's lifecycle is independent of any single run.

### 9.4 Profile / multi-channel contract

A user may have up to 3 channels per Feature #01. Each channel may have 0 or 1 active LoRA. The "currently active channel" (via `profiles.active_channel_id`) determines which LoRA Feature #23 uses by default; channel-switcher routes propagate this naturally.

---

## 10. UI / UX Behavior

### 10.1 Routes

| Route | Auth | Purpose |
|---|---|---|
| `/character` | required | Model status page (dashboard for active channel). States: not_trained / queued / training / ready / failed. |
| `/character/train` | required | Photo upload + warning ack + train CTA. |
| `/character/sample` | required | Sample render gallery — separate page so it can be shared via permalink. |

The active-channel switcher is reused from Feature #01. If the user has no channel, `/character` redirects to `/onboard`.

### 10.2 `/character` (model status)

**State: not_trained** (no `lora_models` row). Renders the empty hero (mockup State 1) with a primary CTA to `/character/train`.

**State: queued / training:**
- Status pill ("Queued", "Training") with elapsed-time badge.
- Progress bar driven by `(now - started_at) / 30min`, capped at 95% (the last 5% jumps to 100% on webhook).
- Cancel button → opens confirmation modal → calls `DELETE /api/character/[channelId]/model` with `scope=model_only`. (Photos are preserved.)
- Polls `GET /api/character/[channelId]` every 10s.

**State: ready:**
- Sample-render gallery (4 thumbnails, 2×2 on desktop, 1-col on mobile).
- Trigger-token chip with a "How this works" tooltip.
- Photos grid (read-only) — 25 thumbnails with a "X" remove on hover. Removing a used photo issues `DELETE /api/character/photos/[photoId]` (soft delete; storage retained until 30d cron).
- Re-train CTA → `/character/train` with current photos pre-selected.
- Delete model CTA → confirmation modal with `confirmText` input.
- If `rollbackAvailable !== null`: renders a "Restore previous model" affordance in a less-prominent secondary action. Click → `POST /api/character/[channelId]/rollback`.

**State: failed:**
- Rose-themed banner with friendly error copy (mapped from `failure_code` to user-facing string in `lib/character/error-strings.ts`).
- "Try again" CTA → `/character/train`.
- Photos grid still shown (the user can adjust the selection).

**State: superseded:**
- Hidden from this view by default — only the active model is shown. The rollback affordance surfaces on the `ready` view.

### 10.3 `/character/train` (upload + train flow)

**Layout (mockup States 2 + 3):**

- Header: "Upload your photos" + per-channel valid/warning/rejected counters.
- Drag-drop zone (large, dashed border).
- Photo grid: 5 cols × 5 rows = 25 slots. Filled tiles show thumbnail + status pill. Empty slots are dashed and labeled with their slot number for visual progress.
- Right rail:
  - Tip card ("For best results: 15–25 varied photos").
  - Privacy card ("Encrypted at rest · auto-deleted after 30d").
  - Estimated cost card (~$3, surfaced if Phase 4 makes the user pay per training).
- Sticky bottom bar:
  - "X valid · Y warnings · Z rejected".
  - "Train your character (~30 min)" CTA — **disabled** until `valid >= 10`.
  - Warning-ack checkbox surfaces above the CTA when warnings exist.

**Upload UX:**
- Files dropped or selected fire a single multipart request to `/api/character/photos`. Up to 25 files at once.
- Per-file optimistic placeholder tiles (blue spinner) render immediately.
- Server response replaces optimistic tiles with terminal status. Rejected tiles show the rose ring + status pill.
- User can click "Replace" on a rejected tile → file picker → re-upload to the same slot (the rejected row is hard-deleted in the same flow).

**Train UX:**
- Click "Train" → optimistic redirect to `/character` (status pill: "Queued").
- Server returns `202` with the new `loraModelId`; the redirect URL includes `?just=trained` for the welcome banner.
- If `WARNINGS_REQUIRE_ACK` returns: the warning banner appears, the checkbox uncovers, the button text changes to "Train anyway", and a second click sends `acknowledgeWarnings: true`.

### 10.4 `/character/sample` (post-training preview)

A standalone page rendering the 4 sample renders large + downloadable. Includes:

- Each render at full 1280×720 resolution (signed URL).
- Per-render prompt visible (so the user understands what the model is doing).
- "Generate a real thumbnail" CTA → `/runs/[runId]/thumbnail` (Feature #23's entry point).
- Share link button (copies `/character/sample` URL to clipboard) — public access still requires auth, so sharing is intra-team.

### 10.5 Active-channel awareness

The `/character*` pages read `profiles.active_channel_id` to decide which channel's LoRA to display. The header shows the channel switcher (reused from Feature #01). Switching channels:

- If the new channel has no LoRA: routes to `/character` empty state.
- If the new channel has a LoRA: routes to `/character` with that channel's status.

### 10.6 Error UX matrix

| Code | UI |
|---|---|
| `INSUFFICIENT_PHOTOS` | Inline banner above the train CTA: "You need 10 valid photos. You have N." |
| `WARNINGS_REQUIRE_ACK` | Warning cards above the CTA + ack checkbox. |
| `TRAINING_IN_PROGRESS` | Toast: "Training is already running. Wait or cancel first." Routes to `/character`. |
| `REPLICATE_QUOTA` | Banner: "We're temporarily over capacity. Try again in a few hours." |
| `PHOTO_VALIDATION_FAILED` (per-photo) | Per-tile status pill (red ring + label). |
| `RATE_LIMITED` | Toast with `retryAfterSec` formatted as "Try again in N min". |
| `STORAGE_FULL` | Banner: "You've reached the 25-photo limit. Delete some to add more." |
| `TRAINING_FAILED` | Rose banner on `/character` with friendly copy + "Try again" CTA. |
| `INTERNAL_ERROR` | Generic "Something went wrong" toast; logs to Sentry. |

### 10.7 Loading states

- Photo upload: per-tile blue spinner with percent badge while bytes upload, then face-detection spinner while validating.
- Training: ETA badge counts down; on completion the page hot-swaps to the success view without a hard refresh (poll-driven re-render).
- Model purge: confirmation modal disables the confirm button + spinner during delete.

### 10.8 Mobile behavior

- Photo grid collapses to 3 cols × 9 rows on screens < 768px.
- Right rail moves below the grid.
- Drag-drop is replaced by a tap-to-pick file input (mobile browsers don't reliably support drag).
- Sticky bottom bar remains.

---

## 11. Edge Cases

| Case | Behavior |
|---|---|
| User uploads 25 photos, 5 rejected → 20 valid | Allowed (≥ 10). Train enabled. |
| User uploads 9 valid photos and clicks train | `INSUFFICIENT_PHOTOS` returned; CTA was disabled but the server enforces too. |
| User uploads 30 files in one request | First 25 accepted; remaining 5 rejected pre-storage with per-file `VALIDATION_FAILED`. |
| User uploads same photo twice | Both stored with different `photoId`s. Variance check warns about near-zero distance ("very similar to another photo"). User can manually delete duplicates. |
| User uploads photos with hats / sunglasses | Per-photo accepted (face still detected). Channel-level `hat_or_glasses_warning` if ≥ 30%. Requires ack to train. |
| User uploads photos with multiple faces | Marked `multiple_faces` (amber pill, multi-face label). Excluded from training selection by default; user can override (advanced toggle). v1 does **not** auto-crop. |
| User uploads photos all from the same angle | Channel-level `uniformity_warning` (variance < 0.15). Requires ack to train. |
| User uploads non-image files | Pre-storage MIME sniff rejects with `VALIDATION_FAILED` ("Unsupported file type"). |
| User uploads corrupted JPG | Sharp metadata probe throws → `unreadable` status. |
| User clicks train, then closes the tab | Training proceeds. Webhook fires when done. User can return to `/character` and see `ready` status; the email also notifies them. |
| Webhook never arrives (network partition / Replicate outage) | Polling cron (§5.5.2) catches it within 5 min after the 45-min slack window. Status moves to `ready` or `TRAINING_TIMEOUT`. |
| User deletes a photo while training is in progress | `409 TRAINING_IN_PROGRESS`. Must wait or cancel. |
| User cancels training mid-way | `DELETE /api/character/[channelId]/model` with `scope=model_only` cancels Replicate prediction, marks row `canceled` with `failure_code='CANCELED'`, resets `used_in_training=false` on photos. No email. |
| User retrains with the same photos | New `lora_models` row inserted. Old row → `superseded` with 7d rollback. Same trigger token (it's derived from `channelId`), so Feature #23 prompts continue to work. |
| User retrains with different photos | Same as above. Old `used_in_training=true` photos remain flagged; the prior model's 30-day photo-purge clock keeps ticking from its `completed_at`. |
| User rolls back to the previous model | Active row → `superseded`, prior `superseded` → `ready`. Trigger token re-derived (same value). Feature #23 transparently uses the rolled-back weights on the next render. |
| User deletes a channel (Feature #01 cascade) | Daily cron sees `channels.deleted_at IS NOT NULL`, marks `lora_models` and `character_photos` for the channel as `purged`/soft-deleted, schedules storage cleanup. |
| User's Replicate training quota hit | `503 REPLICATE_QUOTA`. Banner shown. Cron retries the next day automatically? **No** — quota errors are not retried; the user must re-trigger from the UI. |
| User has an in-flight training and the server restarts | Status persisted in DB. Webhook + polling cron handle the reconnection. No state lost. |
| User's stored weights become unreadable (Supabase outage) | Feature #23's `getActiveLora` returns the row, but image generation falls back to no-LoRA. Eventually we'd surface a "model storage temporarily unavailable" toast on `/character`; v1 swallows silently. |
| Replicate model version drifts (we pin a version) | The `base_model` column captures the pinned version. Future migrations re-train via cron when we bump the version (Phase 4). |
| Trigger-token collision across channels | Probability negligible (1 in 28M). If it ever happened, the second training would still succeed at the model layer (Replicate destinations differ), but Feature #23's prompts could fire the wrong LoRA. Mitigation: a unique constraint on `trigger_token` would refuse the second insert; **decision: do not enforce uniqueness in DB** because the channel hash is deterministic and a real collision means a hash bug, not a data bug. We log a `WARN` if `count(*) where trigger_token = x > 1` from the daily cron. |
| Sample renders fail (FLUX outage) | Training still marked `ready`; `sample_render_urls = []`. Email sent without thumbnails (template handles empty array). |
| User's email bounces | Resend records the bounce; we surface a "couldn't email you" toast on next login. The model is still ready. |
| User on free tier (Phase 4) | Out of scope here; gating logic lives in middleware once Stripe ships. v1 is uniform access. |
| User uploads someone else's face (deepfake) | TOS attestation only; no detection. If reported by a third party, manual review + purge per `DELETE /api/character/[channelId]/model`. |

---

## 12. Security Considerations

- **Auth-gated:** middleware on `(app)` route group enforces session. Webhook route bypasses session and uses HMAC.
- **RLS:** every `character_photos` and `lora_models` query is filtered by `auth.uid()`. Storage bucket policies enforce the same at the file layer.
- **Storage signed URLs:** TTL-bounded (1h for in-app; 7d for email body images). Never public-read.
- **HMAC webhook verification (§5.5.3):** double-layer (per-row secret + Replicate global signature). Constant-time compare on the secret.
- **Input validation:** Zod on every request body, multipart form parser bounded at 256 MiB total + 10 MiB per file. MIME sniff via `file-type` (not trust client header).
- **Path injection:** storage paths are server-constructed from `userId` + `channelId` + `photoId` (UUIDs only). No user-supplied path components.
- **Cross-tenant leakage:** the partial unique index on `lora_models_active_per_channel` plus the RLS `auth.uid() = user_id` filter is the bulwark. Penetration test: try to GET `/api/character/[someoneElsesChannelId]` → returns `404 CHANNEL_NOT_FOUND`, not `403`, to avoid leaking existence.
- **Replicate destination namespace:** every training has a unique destination including `loraModelId`. Replicate's API enforces destination access by `REPLICATE_USERNAME`.
- **PII handling:** training photos are PII (face data). Treated per §7. Logs scrub `face_bbox`, `face_embedding`, and storage paths (kept only in DB rows). Sentry breadcrumbs do not include image bytes or URLs.
- **Rate limits (§8.3):** per-user training caps prevent abuse + cost runaway.
- **TOS attestation:** displayed and required before training starts. Recorded server-side as `acknowledgeWarnings + tosVersion` on the `lora_models` row (extension: add `tos_version_acked` column in Phase 4 if legal requires).
- **Supabase service role:** only server-side webhook + cron paths use service-role key. All user-initiated routes use the user's session token + RLS.

---

## Appendix A — File Map

This spec implies the following files exist by the end of implementation:

```
app/
  (app)/
    character/
      page.tsx                                    # /character — model status
      train/page.tsx                              # /character/train — upload + train
      sample/page.tsx                             # /character/sample — render gallery
  api/
    character/
      photos/
        route.ts                                  # POST upload + validate
        [photoId]/route.ts                        # DELETE photo
      train/route.ts                              # POST start training
      [channelId]/
        route.ts                                  # GET status
        model/route.ts                            # DELETE model
        rollback/route.ts                         # POST rollback
      webhook/[loraModelId]/route.ts              # POST Replicate webhook
    cron/
      character/
        auto-delete-photos/route.ts               # daily 03:00 UTC
        purge-superseded/route.ts                 # daily 04:00 UTC
        poll-training/route.ts                    # every 5 min
lib/
  character/
    trigger-token.ts                              # deriveTriggerToken()
    limits.ts                                     # per-user / per-channel limits
    warnings.ts                                   # variance + hat/glasses warnings
    error-strings.ts                              # failure_code → user copy
    sample-prompts.ts                             # the 4 sample-render prompts
  replicate/
    train.ts                                      # submitTraining()
    quota.ts                                      # checkReplicateBudget()
    face-detect.ts                                # face-detection wrapper
    webhook-verify.ts                             # HMAC verification
  db/
    character.ts                                  # typed CRUD: getActiveLora, etc.
  validation/
    character.ts                                  # Zod schemas (§3.4)
  email/
    templates/
      character-trained.tsx                       # success email
      character-training-failed.tsx               # failure email
    resend.ts                                     # Resend wrapper (shared)
  services/
    character.ts                                  # orchestrator (upload, train, status)
  storage/
    character-photos.ts                           # bucket helpers (upload, sign, purge)
    lora-models.ts                                # bucket helpers (download weights, samples)
```

---

## Appendix B — Flagged Decisions + CLAUDE.md Updates

The following decisions deviate from the PRD or introduce new conventions. Each requires explicit acknowledgment before implementation begins.

### B.1 Decisions made by this spec

1. **`multiple_faces` photos are kept (with warning), not auto-cropped in v1.** PRD says "auto-crop to dominant face"; we defer to Phase 4. Rationale: auto-crop adds a Sharp pipeline + alignment step that risks shipping bad crops. Excluding multi-face from training selection by default with a manual override is simpler and reversible.

2. **Default training steps: 1200** (PRD says "800–1500"). Replicate's FLUX-LoRA documentation recommends 1000–1500 for face-quality LoRAs; 1200 is the cost / quality midpoint. Configurable in the request body.

3. **Trigger token format: `creator_<8-char-base32-channel-hash>`** (PRD says `<creator_X>` where X is the channel ID). Channel UUIDs are 36 chars and unsuitable for FLUX prompts. Hash-derived 8-char tokens are stable across retrains, unique per channel, and short enough to embed.

4. **Sample renders auto-generated post-training** (4 fixed prompts). PRD does not specify; mockup State 4 shows them as "we generated these to verify quality". Cost ~$0.16 per training; small relative to $3 training cost.

5. **Photo retention: 30 days post-training-success only.** Photos from a failed training are kept for 7 days then purged (added to the auto-delete cron — extends §7.4). This gives the user time to retry without re-uploading.

6. **Rollback window: 7 days** (mentioned in user prompt). The `superseded` model's weights are retained for 7 days; after that, hard-purged by §7.5. No UI surfaces rollback beyond the timeline; advanced users can find it via the API or support.

7. **Concurrent trainings per user: 1.** Multi-channel users train serially. Avoids accidental quota burn and racey UI states.

8. **Replicate is the only training provider in v1.** Modal / self-hosted is deferred. The `training_provider` enum has `'replicate'` as its only value; future expansion is a non-breaking schema change.

9. **No DB-level uniqueness on `trigger_token`.** Hash collisions are negligible; enforcing uniqueness at the DB layer would interfere with rollback (where two rows share the same token transiently). Logged as a warning if it ever happens.

10. **No automated deepfake / consent detection in v1.** TOS attestation only. PRD explicitly defers this.

11. **Webhook-handler downloads weights synchronously, then renders samples synchronously, before sending email.** Total post-webhook latency: ~30 seconds. Acceptable because the user is waiting for the email anyway. If sample renders dominate, we could move them to a background job in Phase 4; v1 keeps it simple.

12. **Sample renders on training-failed are not generated.** Saves ~$0.16 on every failure.

13. **Photo upload validation runs synchronously in the request.** PRD describes "real-time per-photo validation indicators" → the simplest path is a single round-trip per upload batch with all validations resolved before responding. Latency: ~1.5s for 25 photos in parallel. The mockup's "uploading 64%" state covers the bytes-upload portion; the validation phase is a brief unified spinner after upload completes.

14. **Model weights kept in Supabase Storage, not Replicate's serving infrastructure.** Replicate serves trained LoRAs from their own URLs by default. We download to Supabase to (a) ensure availability if Replicate purges old models, (b) enable cost-bounded inference via providers that don't natively support Replicate model refs, and (c) stay portable. Cost: ~150 MB × N users; covered by Supabase Pro storage budget (§6.3).

### B.2 CLAUDE.md updates required when this spec is implemented

1. **Add Replicate to the external services list (CRIT-1 spirit):** add a note that Replicate has its own quota budget tracked in `replicate_quota_usage` with a daily cap of $100. New routes that call Replicate must go through `lib/replicate/`.

2. **Add to Stack lock-in:** `Replicate` (FLUX-LoRA training, FLUX inference, face-detection); `pgvector` Postgres extension.

3. **Add to File Organization:** `lib/replicate/` and `lib/character/` directories, consistent with the layered architecture (A-1).

4. **EXT-1 env vars:** add `REPLICATE_API_TOKEN`, `REPLICATE_USERNAME`, `REPLICATE_WEBHOOK_SIGNING_SECRET`, `REPLICATE_DAILY_CAP_CENTS`, `APP_URL` (already exists).

5. **EXT-3 retry policy:** confirm Replicate calls follow the same exponential-backoff-on-429/5xx rule as Anthropic. Document in `lib/replicate/`.

6. **SEC-1 allowlist:** does not change (no new URLs from users); but signed-URL handling needs an entry in security review.

7. **Common Mistakes section:** populate with any implementation bugs that surface during build, per the existing convention.

### B.3 Open questions for the user / product

These do not block this spec but should be answered before Phase 4:

- Should free-tier users have access to character training, or is it paid-only? (Current assumption: paid-tier-only when Stripe ships; uniform free in v1.)
- Should we surface the cost ($3) to the user pre-training, or absorb it as part of a paid tier? (Current assumption: hidden in v1; surfaced post-Stripe.)
- Should multi-face photos be auto-cropped in Phase 4, or should we keep the manual-override flow? (Current decision: manual-override v1; revisit.)
- Should the training-complete email include a sample render inline (raster), or just a link? (Current decision: 4 inline sample renders linked from a single 7d signed URL.)
- Should re-training be allowed unlimited per day, or capped? (Current: 5 per user per day.)
