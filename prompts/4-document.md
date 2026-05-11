# Document Prompt — YouTube Viralizer

Use this **after** the execution prompt has shipped Phase `PHASE_NUMBER` and verification has passed. Update `PHASE_NUMBER` before sending.

---

Good work. Document everything you accomplished in Phase `PHASE_NUMBER`.

## 1. Team-facing phase summary

Write a phase summary document so any team member can read it and understand what shipped without digging into the code.

- **Filename:** `Phase-PHASE_NUMBER-Summary.md`
- **Location:** Same directory as the implementation plan → `Documentation/Projects/Phase-PHASE_NUMBER-Summary.md`
- **Audience:** A new contributor or stakeholder. Be readable, not exhaustive.

Include these sections:

1. **What was built** — high-level bullets, not a file list.
2. **Key implementation decisions** — what trade-offs were made and why (model choices, library picks, structural calls).
3. **Files created or modified** — concise list grouped by area (scaffold, app entry, lib, docs). Long file lists belong in the per-phase `summary.md`; here just hit the headline files.
4. **How to verify it works** — copy-pasteable commands the reader can run (pnpm install, pnpm build, pnpm typecheck, pnpm lint, any negative env tests, any CLI checks).
5. **Issues encountered and how they were resolved** — every deviation from the `task.md` plan. One short paragraph each.

Cross-link the per-phase deep-dive at `Documentation/Projects/Phases/Phase <N>/Phase PHASE_NUMBER .../summary.md` for readers who want full detail.

## 2. Append to the rolling Team Update

Open (or create) `Documentation/Projects/Team-Update.md` and **prepend** a new entry at the top (newest first). Keep the existing entries untouched.

Each entry should fit on a single screen and contain:
- Date + phase number + one-line headline
- Link to the corresponding `Phase-PHASE_NUMBER-Summary.md`
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
