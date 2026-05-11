# Phase 4.2 — Custom LoRA character training

**Parent:** Phase 4 — AI Generation
**Status:** Not Started
**Estimated:** 14-20 hours (THE DEFENSIBILITY MOAT)
**Depends on:** Phase 4.1 (AI thumbnails consumes the LoRA)
**Spec:** `Documentation/Overviews and Summaries/24-lora-character-training/spec.md`

## Goal

Train per-channel LoRA on the user's face for consistent likeness in AI-generated thumbnails. No competitor in creator-AI offers this. Photo upload + face validation → Replicate FLUX-LoRA training → trigger token assigned → sample renders → email notification → integration with Feature #23. Privacy: photos auto-deleted 30 days post-success, encrypted at rest, signed URLs only, user can purge anytime.

## What to Build

### Step 1 — Data layer
- `character_photos` table: id, user_id, channel_id, storage_path, validation_status enum (face_detected|no_face|multiple_faces|low_resolution), face_embedding vector (optional pgvector for variance check), uploaded_at, deleted_at.
- `lora_models` table: id, user_id, channel_id, status enum (not_trained|queued|training|ready|failed), trigger_token, training_steps default 1200, model_weights_url, source_photo_ids uuid[], cost_cents, started_at, completed_at, deleted_at.
- Partial unique `lora_models_active_per_channel ON (channel_id) WHERE deleted_at IS NULL AND status='ready'`.
- `character_training_events` append-only audit log: id, model_id, event_type, payload jsonb, occurred_at.
- `replicate_quota_usage` table: date PK, units_used (cost cents), updated_at — CRIT-1-style budgeting for Replicate ($100/day cap).
- Zod schemas in `lib/validation/character.ts`.

### Step 2 — Photo upload + validation
- Private Supabase Storage `character-photos` bucket: public-read DISABLED, encrypted at rest, signed URL 1h TTL in-app + 7d for email-linked sample renders.
- `lib/replicate/face-detect.ts` wrapper for face-detect endpoint (or Google Vision fallback). Per-photo synchronous validation ~1.5s total for 25 photos.
- `POST /api/character/photos { channelId }` multipart route: 10-25 photo upload, per-photo validation, rejects no-face / multi-face / <768×768 (returns 400 PHOTO_VALIDATION_FAILED with per-photo enum).
- `DELETE /api/character/photos/[photoId]`.
- Photo variance check via `face_embedding` cosine distance: warning when all uniform (would produce limited LoRA).
- 100 photos/day per user rate limit.

### Step 3 — Training pipeline
- Trigger token derivation: `creator_<8-char-base32-hash-of-channelId>` (deterministic + retrain-stable + matches regex `/^creator_[a-z2-7]{8}$/`). Token survives retrains so Feature #23 prompts continue working.
- `POST /api/character/train { channelId }` route: builds training ZIP from photo storage paths, submits to Replicate `flux-lora` training endpoint, inserts `lora_models` row with `status='queued'`.
- Replicate webhook target `POST /api/webhooks/replicate`: HMAC signature verification (double-HMAC with `REPLICATE_WEBHOOK_SECRET` and query-secret). Updates `lora_models.status='ready'` on success, `status='failed'` on training error.
- Concurrent trainings per user = 1 (multi-channel = serial); 5 trainings/day per user; $100/day Replicate budget cap (enforced before submission).
- Configurable steps (default 1200, range 800-1500); 30-minute typical training time.

### Step 4 — Sample renders + email
- Webhook handler: downloads model weights from Replicate, mirrors to Supabase Storage `lora-models` bucket (portability + availability), then renders 4 fixed sample prompts (`<creator_X> smiling in YouTube studio`, etc.) via Feature #23 `generateThumbnail` (~$0.16 added cost).
- `lib/email/character-trained.ts` Resend template — subject "Your character is trained", link to `/character`.
- `lib/email/character-training-failed.ts` Resend template.
- Sample render skipped on training failure (cost savings — Decision D-12).

### Step 5 — API CRUD + privacy
- `GET /api/character/[channelId]` — model status + sample renders + stats.
- `DELETE /api/character/[channelId]/model { confirmText: "DELETE" }` — purges model weights + all source photos (validated confirmation).
- Auto-deletion cron for source photos: 30 days post-success (Phase 2) / 7 days post-failed training.
- 7-day rollback retention for superseded models (retrain replaces but keeps old for week).
- Polling fallback cron when webhook fails.
- Deepfake detection deferred to TOS attestation checkbox before training (Decision D-10).

### Step 6 — UI
- `/character` model status page: 5 states (not_trained → CTA, queued, training with timeline, ready with sample gallery + stats, failed with retry).
- 10s polling for state transitions.
- `/character/train` upload flow: drag-drop area with 10-25 photo grid + per-photo validation badges, "Start training" CTA disabled until ≥10 valid photos. TOS attestation checkbox before training.
- `/character/sample` preview gallery once trained.
- Training-status timeline (queued → training → packaging → ready).
- Retrain CTA, delete-and-restart prominent.
- "Train your character for consistent thumbnails" empty-state hero on `/character` and as CTA banner in Feature #23 when LoRA absent.
- Delete confirmation modal requires typed "DELETE".

### Step 7 — Integration & testing
- Feature #23 reads `getActiveLora(channelId)` when generating thumbnails (verified). Prompt augmented with `<creator_X>` trigger token; `strength: 0.85` parameter.
- Trigger token regex `/^creator_[a-z2-7]{8}$/` matches for any channelId input.
- Uploading 26th photo returns 400 PHOTO_LIMIT_REACHED.
- Webhook with invalid signature returns 401.
- Successful training: `lora_models.photos_deleted_at = completed_at + 30 days` (set by cron at 30d mark).
- Failed training: photos deleted 7d after failure.
- Multi-face photos kept with warning, NOT auto-cropped in v1 (Decision D-1).
- Replicate $100/day budget cap blocks 11th training that day.
- Concurrent training prevention: 2nd training while 1st in flight returns 409 TRAINING_IN_PROGRESS.
- Webhook handler downloads weights + renders samples synchronously before email (~30s extra latency, acceptable inside 30-min wait).
- CLAUDE.md updates per spec Appendix B.2: new env vars `REPLICATE_API_TOKEN`, `REPLICATE_WEBHOOK_SECRET`, `REPLICATE_*`; Replicate added to stack lock-in; `pgvector` extension already in 3.1; `lib/replicate/` + `lib/character/` directories; Replicate quota tracking analogous to YouTube CRIT-1.

## Cross-feature contracts

- Reads `channels.*` (Phase 1.5) for channel ownership verification on photo upload + training.
- Writes `lora_models` — read by Feature #23 via `getActiveLora()` accessor.
- Trigger token format `creator_<8-char-base32>` is deterministic so retrains don't break Feature #23 prompts.
- Independent of `pipeline_runs` (per-channel character, not per-run).
- Sample renders consume Feature #23 quota slot (counted, but absorbed at training cost not user quota).

## Verification

- [ ] `trigger_token` matches `/^creator_[a-z2-7]{8}$/` for any `channelId` input (deterministic + stable across retrains)
- [ ] Uploading 26th photo for a channel returns 400 PHOTO_LIMIT_REACHED
- [ ] Webhook with invalid HMAC signature returns 401
- [ ] Successful training row has `photos_deleted_at` set to `completed_at + 30 days` (verified post-cron)
- [ ] Failed training photos deleted 7 days after `failed_at`
- [ ] Multi-face photos kept with `validation_status='multiple_faces'` warning (NOT auto-cropped)
- [ ] Replicate $100/day cap returns 503 BUDGET_EXCEEDED on 11th expensive training
- [ ] 2nd concurrent training per user returns 409 TRAINING_IN_PROGRESS
- [ ] Successful training renders 4 fixed sample prompts + emails user within 5 min of webhook
- [ ] Sample renders skipped on training failure (no Feature #23 call)
- [ ] DELETE model with `confirmText !== "DELETE"` returns 400
- [ ] DELETE model purges weights + all source photos
- [ ] Storage paths embed `user_id`; signed URL TTL = 3600s in-app, 604800s (7d) in email
- [ ] `lora-models` and `character-photos` buckets are public-read DISABLED (verified by HTTP test on direct URL)
- [ ] CLAUDE.md updated: REPLICATE_* env vars, Replicate stack lock-in, character + replicate lib directories, quota tracking analog

## Out of scope

- Body LoRA (full-body consistency)
- Animation / motion LoRA
- Voice cloning
- Multi-character LoRAs for collab channels
- LoRA marketplace (sharing across users)
- Real-time face swap on existing footage
- Style LoRAs (channel aesthetic, not personal face)
- Automated deepfake detection (TOS attestation only v1)
- Self-hosted training (Replicate only v1; Modal deferred per Decision D-8)
- DB-level uniqueness on `trigger_token` (would interfere with rollback transient state)
