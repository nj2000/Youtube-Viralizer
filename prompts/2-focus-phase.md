# Focus Prompt — YouTube Viralizer

Use this **after** the start-conversation prompt has been processed. Update `PHASE_NUMBER` (and `SPEC_PATH` if zooming on a feature) before sending.

---

Now I want to focus on Phase `PHASE_NUMBER` of the implementation plan.

Use the **Explore** sub-agent (the read-only research-specialist in this environment) — call it **multiple times in parallel** — to familiarize yourself with:

- Everything required for Phase `PHASE_NUMBER` (re-read the subphase `task.md`)
- The relevant sections of the spec(s) at `Documentation/Overviews and Summaries/<##-feature>/spec.md` and the matching PRD at `Documentation/PRDs/<##-feature>.md`
- The matching mockup at `Documentation/Mockups/<##-feature>.html` — extract exact design tokens, copy, and layout cues
- Any **existing code** that Phase `PHASE_NUMBER` will modify or interact with (use grep across `app/`, `lib/`, and config files; if the repo has nothing yet, say so explicitly)
- Existing **patterns** in the codebase that Phase `PHASE_NUMBER` should follow (Zod schemas in `lib/validation/`, service-layer style in `lib/services/`, prompt structure in `lib/prompts/`, SSE helpers in `lib/streaming/`, etc.)
- Cross-references from `CLAUDE.md` (any rule that mentions the phase's surface area) and `Documentation/Overviews and Summaries/Build-Order.md` sections cited in the subphase `task.md`

Do not make any changes yet. Just research and confirm your understanding. End with:

1. A concrete **task list** for Phase `PHASE_NUMBER` (each line = a file to create/modify + the contract it must meet)
2. A list of **decisions I need to make** before you start (package manager, library choices, naming, anything ambiguous)
3. **Out-of-scope items** to defer (`// TODO(phase-2):` candidates), so we honor S-1
4. The **verification checklist** copied from the phase `task.md` so we both agree on the definition of done

Wait for my "go" before writing code.
