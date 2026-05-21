# Ideas & Known-Issues Backlog

Captured from live testing sessions. **Not scheduled work** — Phase 1 (the 12-stage
pipeline) ships first (S-1). Items here are candidates for Phase 2/3 or net-new
specs. Each notes where it fits and any hard constraint.

---

## Feature ideas (from testing)

### Ideation phase (pre-idea inspiration) — 🆕 net-new
A step *before* "drop an idea," for when the user has no idea yet. Seed candidate
ideas from the channel's niche + the competitor outlier patterns we already
extract in Stage 3. Strong fit because the outlier data is the perfect seed.

### Bigger competitor set / target list — 🟡 enhancement
Onboarding suggests ~10 competitors. Want to: select/add all, add a manual
selection, and re-run discovery to find more — ideally build toward a curated
**~50-competitor "target list"** persisted per channel.
- **Constraint (CRIT-1 quota):** outlier scans cost 100 units each; the daily cap
  is 10k. Scanning 50 competitors *per run* would exhaust quota fast. Right shape:
  a **persisted** competitor set + **incremental, cached** scans, not 50 live calls
  every run.

### Outlier corpus as a knowledge base — ✅ partly on roadmap (#14 / Phase 3.1)
Treat all competitor outliers as a studyable knowledge base that influences titles,
hooks, and scripts. The hybrid-scoring engine (Feature #14 / Phase 3.1) already
plans a pgvector outlier corpus + nightly cron; this would surface it as a
first-class "niche knowledge base" view, not just an internal scoring input.

### Packaging insights from outliers — 🟡 partial
A dedicated view that studies outlier **titles + thumbnails** together and extracts
packaging insights. Stages 5 (titles) and 9 (thumbnails) already consume outlier
patterns; this makes the analysis explicit and browsable.

### Format extraction from transcripts — 🆕 net-new, high-value
Pull outlier **transcripts**, extract the structural format each uses
(e.g. intro → brief outcome → build phase → reveal), present a taxonomy of formats,
let the user **pick one format and apply it** to their video.
- **Constraint:** needs a transcript data source (captions API / transcription) —
  a new cost + quota line. Closest existing piece is Stage 7's *fixed* section
  taxonomy; this would make the structure *discovered* from competitors.

### Run workspace: left sidebar / stage navigator — 🆕 net-new UX
Keep the nice step-to-step vertical scroll, but add a **persistent left rail** listing
the 12 stages: click to jump to a stage, see status at a glance, and use it as a
per-stage **input/management point** (e.g. pick a title from the side). Run page
becomes a two-pane workspace; each stage can get a more in-depth view.

### Thumbnails: text briefs (near-term) vs. AI images (Phase 4) — easy to conflate
Two distinct tiers:
- **Stage 9 thumbnail *briefs* (Phase 2.7, not built yet):** TEXT only — composition,
  hex palette, facial expression, overlay text. Haiku, **no image-model key needed.**
  Phase 1 scope is explicitly text-only briefs.
- **AI image *generation* (Phase 4.1 / Feature #23):** turns a brief into an actual
  image — Gemini Imagen primary, FLUX (Replicate) fallback, Sharp text overlay.
  **This** is where an image-model API key comes in. #24 / Phase 4.2 adds per-creator
  LoRA face for a consistent look.
User saw Stage 9 show "complete" with no image — that's the **stub**, not the
feature (see known issues). Real briefs arrive in 2.7; real images in Phase 4.

---

## Known issues / papercuts (from testing)

### Gate-override UI doesn't auto-advance — 🐞 (Phase 2.2 surface)
After `POST /api/runs/[runId]/override-gate` succeeds (200) and Stage 5 titles
generate, the run page stays on the gate-failed card — because the run-wide SSE
stream had already closed and there's **no reconnect**, so the client never
refreshes. The user clicks override again (→ 409) and it looks broken.
**Fix:** reconnect the SSE stream (or poll) + refresh the run view after override.
Affects every post-stream-close update, not just override. *Workaround: reload the page.*

### Stage 7 live-stream section breaks lag by one beat — 🐞 cosmetic (Phase 2.5)
While the script streams, the tail sentence of a section briefly renders under the
*next* section before the `<section_break/>`, because the server tags the boundary
delta with the next `sectionIndex`. **Self-corrects on `complete`** (the validated
parse re-renders correctly) — so the saved script is fine; only the live typewriter
view is briefly off. Fix lives in the stream route's section-boundary attribution
(flush pre-delimiter text to the current section before switching index).

### Stub stages (9–12) render "complete" with no output — 🐞 misleading
Stages 9–12 aren't built yet (Phase 2.7–2.10). The Phase 1.6 default stub handler
returns `{ stubbed: true }`, and the generic `StageCard` renders that as
**"complete"** — so e.g. Stage 9 thumbnails looks done but produces nothing. Should
render a "not built / placeholder" state instead of "complete" so stub output isn't
mistaken for real output.

### Root `/` is the Phase 1.1 scaffold placeholder — 🐞 papercut
`app/page.tsx` still renders the "scaffold ready" token demo; it never redirects
into the app. A one-line `redirect("/runs")` fixes it.

### "YouTube didn't respond" copy is misleading — ✏️ copy nit
On an invalid/restricted YouTube key, YouTube *does* respond (400 `API_KEY_INVALID`);
the client message says it didn't. By design we don't leak the raw upstream error
(API-2), but the operator-facing copy could distinguish "key/config problem" from
"YouTube down" without leaking specifics.
