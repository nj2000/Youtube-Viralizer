# Document Prompt — YouTube Viralizer

Use this **after** the execution prompt has shipped Phase `PHASE_NUMBER` and verification has passed. Update `PHASE_NUMBER` before sending.

---

Good work. Document everything you accomplished in Phase `PHASE_NUMBER`.

## 1. Phase deep-dive (already written during execution)

The execution prompt already wrote the per-phase deep-dive at
`Documentation/Projects/Phases/Phase <N>/Phase PHASE_NUMBER .../summary.md`
(audience: a contributor who wants the full per-file breakdown + verification log).

**Do NOT create a separate flat `Documentation/Projects/Phase-PHASE_NUMBER-Summary.md`** — that tier duplicated the deep-dive and cluttered the folder, so it was removed. There are two doc layers, not three: the rolling **Team Update** (readable, team-facing) and the per-phase **`summary.md`** (detail). 

If the deep-dive `summary.md` is thin, flesh it out now so it covers: what was built (bullets), key implementation decisions + trade-offs, headline files, how to verify (copy-pasteable commands: pnpm typecheck / lint / test / build), and every deviation from `task.md`.

## 2. Append to the rolling Team Update

Open (or create) `Documentation/Projects/Team-Update.md` and **prepend** a new entry at the top (newest first). Keep the existing entries untouched.

Each entry should fit on a single screen and contain:
- Date + phase number + one-line headline
- A `Detail:` pointer to that phase's `Projects/Phases/…/summary.md`
- "What's new" — 4–7 bullets
- "How to run it locally" — copy-pasteable commands if behavior changed
- "Heads up for the next contributor" — gotchas, deferred items, deprecations
- "What's next" — one line on the upcoming phase

This is the file a team member opens to catch up without reading every phase summary.

## 3. Update the implementation plan

Open `Documentation/Projects/Implementation-Plan.md` and:

- Mark Phase `PHASE_NUMBER` complete by prefixing its bullet with `- [x]` (and any partial sibling phases with `- [ ]` if not already checkboxed).
- Update the parent phase **Status** line (e.g. `Not Started` → `In Progress` when at least one subphase ships; `Complete` when all subphases ship).
- Update the document-level **Status** line if appropriate.
- Do NOT rewrite or reformat sections unrelated to the status change. Minimum diff.

## 4. Commit all changes

- One new commit (NOT an amend) referencing the phase number in the subject.
- Subject ≤72 chars, e.g. `Phase PHASE_NUMBER: documentation + plan status update`.
- Body: 2–4 lines listing what the commit contains.
- Sign off with the `Co-Authored-By: Claude` footer.

## 5. Push (only if I told you to)

Push to `origin main` **only if** I've explicitly authorized a push in this conversation. Otherwise, leave the commit local and tell me the commit is ready and ask before pushing.
