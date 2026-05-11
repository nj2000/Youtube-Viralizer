# PRD — Custom LoRA / Character Training

## Feature Name
Custom LoRA / Character Training

## Overview
Trains a custom LoRA (Low-Rank Adaptation) model on photos of the user's face so every generated thumbnail features their consistent likeness in any pose, expression, or scene. This is the **product's defensibility moat**: no competitor in the creator-AI space offers per-creator consistent face on AI-generated thumbnails.

**Problem solved:** AI thumbnail generation (Feature #23) produces generic faces or stock-style people. Big creator agencies pay designers to maintain visual consistency across thumbnails; LoRA training automates that for solo creators.

## User Stories
- As a creator, I want every AI-generated thumbnail to feature my actual face, so my channel maintains visual consistency.
- As a creator, I want to upload 10–20 photos of myself and have a model trained, so I never have to upload again.
- As a creator, I want the trained model usable across all my thumbnails on this channel, so it persists.
- As a creator, I want privacy guarantees on my training photos, so my likeness isn't leaked or repurposed.
- As a creator with multiple identities (multi-channel operator), I want per-channel LoRAs, so each channel maintains its own face.

## Functional Requirements
- Photo upload flow: 10–25 photos, varied angles, expressions, lighting; min resolution 768×768
- Pre-training validation: face-detection on each photo; reject if face not detected, multiple faces, or below resolution
- Training pipeline:
  - Use Replicate or self-hosted FLUX-LoRA training
  - 800–1500 training steps (configurable)
  - Trigger token assigned: `<creator_X>` where X is the channel ID
  - Training time: 15–45 minutes
  - User receives email when training completes
- Per-channel model storage: each channel can have one active LoRA; user can re-train (replaces prior)
- Integration with Feature #23: when active LoRA exists, all face-based thumbnails use the trigger token
- Privacy guarantees:
  - Photos stored encrypted at rest
  - Photos auto-deleted 30 days after training completes (model retains the learned weights, not the source images)
  - User can delete the model and all source photos at any time
  - Model weights are scoped to user account; never shared or trained on cross-user data
- Cost tracking: per-training and per-inference cost surfaced

## User Interface

### Screens
- **`/character/train`**: photo upload, validation feedback, training trigger
- **`/character`**: model status (training / ready / not trained), preview of LoRA on a sample thumbnail, retrain or delete CTA
- **Email**: training-complete notification

### Layout
- Photo upload area with drag-drop and per-photo validation indicators
- Real-time upload progress
- Training-status timeline
- Sample-render preview once trained
- Delete-and-restart prominent when desired

### Key interactions
- Upload photos, watch validation, confirm
- Trigger training
- Wait for email or check status periodically
- Once ready, all Feature #23 generations automatically use the LoRA

## States to Handle

### Happy path
User uploads 15 valid photos → confirms → training queued → user receives email after 30 minutes → preview renders correctly → integrated into thumbnail generation.

### Error states
- Photo validation fails on individual upload → reject with specific reason (no face, multiple faces, low resolution)
- Training fails (provider error, photos too varied) → refund credits if applicable, surface error with retry
- Trained model produces low-quality outputs → user can retrain with different photos
- LoRA file storage fails → model regenerated on next inference; user notified

### Empty states
- No model trained yet → CTA on `/character` and on Feature #23 cards: "Train your character for consistent thumbnails"

### Loading states
- Photo upload progress
- Training status (15–45 min) with estimated remaining time

## Edge Cases
- User uploads photos with hats, sunglasses, varying hairstyles → may produce inconsistent results; warn user about consistency expectations
- User uploads photos with multiple people — auto-crop to the dominant face; warn if unclear which person is the subject
- Training photos are too uniform (all same angle, expression) → warn that LoRA will be limited; suggest more variety
- User wants to update their look (haircut, beard) → must retrain with new photos
- User uses someone else's photos (deepfake risk) → terms of service prohibit; no automated detection in v1 but flagged in TOS
- LoRA preview looks correct in sample but bad in actual generation → user can retry generation with adjusted prompt

## Out of Scope
- Body LoRA (full-body consistency)
- Animation / motion LoRA
- Voice cloning
- Multi-character LoRAs for collab channels
- LoRA marketplace (sharing models across users)
- Real-time face swap on existing footage
- Style LoRAs (channel aesthetic, not personal face)
- Deepfake-detection or anti-misuse infrastructure (terms of service handles ownership; v1 trusts user attestation)
