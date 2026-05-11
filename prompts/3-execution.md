# Execution Prompt — YouTube Viralizer

Use this **after** the focus prompt has been processed and you've approved the task list. Update `PHASE_NUMBER` (and `SPEC_PATH` if zooming on a feature) before sending.

---

GitHub repo: `https://github.com/nj2000/Youtube-Viralizer.git`

Execute and implement Phase `PHASE_NUMBER` of the plan.

## Critical requirements

- Follow the phase `task.md` and the relevant `spec.md` exactly.
- **No scope creep** — only implement what Phase `PHASE_NUMBER` specifies. Defer everything else with `// TODO(phase-X):` comments (CLAUDE.md S-1).
- Use the **minimum viable** code changes possible.
- Follow existing patterns in the codebase (Zod at boundaries, three-layer architecture A-1, Server Components by default per TS-1, snake_case ↔ camelCase transform at the Zod boundary per API-1).
- Match the coding style and conventions already present (Prettier 2-space indent, named exports, no default exports outside `app/`, no `any`).
- Write tests for new functionality **only if** a testing framework is already configured. Otherwise note "no test framework — deferred to Phase 1.x" and skip.
- Use the **Explore** sub-agent (the research-specialist in this environment) for any additional research needed during implementation — call it in parallel where possible.

## Workflow

1. Re-read `Documentation/Projects/Phases/Phase <N>/Phase <PHASE_NUMBER>/task.md` and the linked spec.
2. Implement file-by-file in the order from the focus-prompt task list. Run typecheck/lint after each logical group.
3. Honor every CRITICAL rule in `CLAUDE.md` (CRIT-1 quota cache, CRIT-2 model routing, CRIT-3 prompt caching, CRIT-4 attribution).
4. Final verification: run every checkbox from the phase `task.md` Verification section. Report pass/fail per box.
5. **Do not push to the GitHub remote without explicit confirmation.** Stage and commit locally; ask before `git push`.
6. **Write the post-phase `summary.md`** in the same folder as `task.md`, summarizing:
   - What was actually delivered (file list with one-line purpose each)
   - Any deviations from `task.md` and why
   - Verification results (which checkboxes passed)
   - Follow-ups / known gaps for the next phase

Begin implementation.
