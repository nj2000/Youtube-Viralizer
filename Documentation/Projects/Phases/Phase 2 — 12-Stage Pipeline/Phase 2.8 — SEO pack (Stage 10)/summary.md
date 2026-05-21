# Phase 2.8 — SEO metadata pack (Stage 10) — Summary

**Status:** Complete · **Stage:** 10 of 12 · **Model:** Haiku 4.5 (5 LLM sub-calls; chapters are deterministic)
**Spec:** `Documentation/Overviews and Summaries/11-seo-metadata-pack/spec.md`

The full copy-paste SEO pack from the locked title + script: description (≤5000,
above-fold first 2 lines), tags (8–15, joined ≤500), hashtags (3 primary + 5
optional), **deterministic chapters** (from script section timestamps, no LLM),
end-screen suggestions (heuristic candidates + Haiku reason copy), and a pinned
comment. FTC disclosure + niche compliance disclaimers injected deterministically.

## Build decisions (A/A/A + the migration)

1. **Bus transport** for the run; JSON for regenerate-section / copy-format /
   sponsored (over the spec's SSE — established A/A/A).
2. **Built fully, including the `is_sponsored` migration (`0011`).** Applied to the
   dev DB via the **Supabase Management API** (`POST /database/query`, HTTP +
   non-interactive) rather than `supabase db push` — sidesteps the EXT-4 IPv6 /
   interactive-password risk. The migration is idempotent (`add column if not
   exists`), so a later `db push` is a harmless no-op. Types regenerated via the
   CLI (`pnpm db:types`); the diff was exactly the three `is_sponsored` lines.
3. **Rate limit (5/hr) deferred** `// TODO(phase-2):`.

## Files delivered

- `supabase/migrations/0011_is_sponsored.sql` — `pipeline_runs.is_sponsored` + partial index (applied).
- `lib/validation/seo.ts` — Description/Tags/Hashtags(3+5)/Chapter(first=0, ≥10s gap)/EndScreen/PinnedComment sub-schemas + `SeoData` (flags, regenerationCounts, model literal, schemaVersion), `SeoSection` enum.
- `lib/services/seo-chapters.ts` — **deterministic** `deriveChapters` (per-section → first 0:00 → ≥10s merge → short-form cap-3 → max-10 prune → 4-chapter fallback), label title-casing. Pure, unit-tested, **zero LLM**.
- `lib/services/seo-compliance.ts` — FTC + finance/medical disclaimer literals; `applyDisclosures` (FTC **prepended** so a sponsored description starts with it).
- `lib/prompts/seo.ts` — 5 section systems (description/tags cacheable ≥1024; hashtags/endscreen/pinned short) + user builders, CRIT-4 attribution to `metadata.md`.
- `lib/services/seo-llm.ts` — per-section call+coerce: description truncate+reprompt, tag trim-to-500 (drops lowest-priority, keeps ≥8), hashtag 3+5 dedup+reprompt, end-screen reasons (videoIds from TS-picked candidates).
- `lib/services/seo.ts` — handler (5 calls + deterministic chapters + end-screen candidate selection + compliance), `regenerateSeoSection`, `registerStageHandler`, `seoErrorCode`.
- `lib/db/seo.ts` — read/write `seo_data` + `setSponsored`.
- Routes: `POST /api/pipeline/seo` (202 bus), `/regenerate-section` (JSON), `GET /copy-format`, `PATCH /api/runs/[runId]/sponsored`.
- UI: `Stage10Card` + `stage10/{shared,Sections}.tsx` (YouTube-Studio-style stacked sections, char counters, copy buttons, tag chips, hashtag callouts, chapter rows, end-screen cards, pinned, **sponsor toggle**, Copy-all) + `lib/hooks/useSeo.ts`.
- `tests/services/seo.test.ts` — 13 tests. Wiring: barrel import + `Stage10Card` in `RunView`.

## Deviations / notes

- **Migration applied via Management API**, not `db push` (see decision 2). Idempotent.
- **The `≤500` tag-join refine is belt-and-suspenders** — unreachable for a valid set (≤15 tags × ≤30 chars = max 464); the service's `trimTagsToFit` is the real enforcer. Test asserts the invariant.
- **End-screen videos** are picked in TS from `channels.top_videos_json` (top-1 by views + top-1 by title overlap); the model writes only the reason copy → `videoId` is guaranteed to exist in the channel's videos.
- **Partial-section failure** isn't graceful — an `InvalidSeoError` fails the whole stage (vs the spec's partial pack). Phase-1 simplification.
- FTC is **prepended**, so a sponsored description's above-fold preview leads with the disclosure (matches the verification "starts with the FTC prefix").

## Verification (task.md checklist)

- [x] First chapter `timeSec === 0` always (deterministic + `ChaptersSchema` refine, tested)
- [x] Tag chars + delimiters ≤ 500 (refine + `trimTagsToFit`; invariant tested)
- [x] Description above-fold first 2 lines stored in `description.aboveFold`
- [x] Description > 5000 → single re-prompt then sentence-boundary truncate
- [x] Regenerate section leaves the others byte-identical (`{...existing, [section]: …}`)
- [x] Chapters generated DETERMINISTICALLY (no `callClaude` in the path; `deriveChapters` is synchronous, tested)
- [x] `is_sponsored = true` → description starts with the FTC prefix (tested)
- [x] End-screen `videoId` exists in `channels.top_videos_json` (candidates sourced from it)
- [x] CRIT-2: Haiku 4.5 for the 5 LLM calls; chapters bypass the model
- [x] CRIT-3: description + tags prompts carry `cache_control` (EST ≥ 1024); shorter prompts correctly uncached
- [x] Hashtags exactly 3 primary + 5 optional (`HashtagsSchema`, tested)
- [x] CRIT-4 attribution to `sub-skills/metadata.md`

**Gate:** `pnpm typecheck` + `lint` clean; `pnpm test` → **156 passed** (13 new). All 4 routes load on the dev server (no 500s). Migration `0011` applied to the dev DB; types regenerated.
**Not click-tested:** the multi-section UI wasn't exercised in a browser this session.

## Follow-ups / known gaps

- `// TODO(phase-2):` 5-runs/hour rate limit; graceful partial-pack on a single-section failure; richer niche-policy disclaimer detection.
- `seo_data` is a leaf (no downstream stage consumes it). Stages 11–12 remain stubs.
