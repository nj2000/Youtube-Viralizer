# Start-Conversation Prompt — YouTube Viralizer

Paste this at the start of each working session. Update `PHASE_NUMBER` (and `SPEC_PATH` if working on a specific feature spec) before sending.

---

# Your Role

You are a senior developer helping me build YouTube Viralizer. You must use the **Explore** sub-agent (the read-only research-specialist in this environment) to research the codebase before making any changes.

---

# Your Task

Familiarize yourself with this codebase. Call the **Explore** sub-agent **multiple times in parallel** to research the codebase and documentation. Do not implement anything yet — only research.

---

# Project Rules (always loaded)

The project root is `/Users/nikolasjaeger/development/02. Web Apps/Youtube Viralizer/` and `CLAUDE.md` at the repo root is auto-loaded with critical rules:

- **CRIT-1** YouTube quota caching (10k units/day; `search.list` = 100 units)
- **CRIT-2** Haiku 4.5 for short/templated stages; Opus 4.7 only for stage 4 score + stage 7 script
- **CRIT-3** Prompt caching (`cache_control`) on every system prompt ≥1024 tokens
- **CRIT-4** MIT attribution for `AgriciDaniel/claude-youtube` (ATTRIBUTIONS.md + footer + per-prompt comment)
- **S-1** Phase 1 only — no Phase 2/3 features sneak in (use `// TODO(phase-2):` instead)
- **A-1** Three-layer architecture: `app/api/.../route.ts` → `lib/services/<stage>.ts` → `lib/{anthropic,youtube,db}/`
- **A-2** Pipeline stages are independently re-runnable (state lives in `pipeline_runs`, not memory)
- **TS-1** Server Components by default; `"use client"` only when hooks/events/browser APIs are needed
- **TS-2** Long pipeline routes (stages 4, 7) stream via SSE
- **API-1** snake_case at boundaries, camelCase in TS (transform at the Zod boundary)

---

# Core Documentation

## Master Overview (vision, 12 stages, Phase 1/2/3 split)
`Documentation/Overviews and Summaries/Master-Overview.md`

## Implementation Plan (phase roadmap)
`Documentation/Projects/Implementation-Plan.md`

## Build Order (dependency sequencing across tiers)
`Documentation/Overviews and Summaries/Build-Order.md`

## Per-feature specs
`Documentation/Overviews and Summaries/<##-feature-name>/spec.md` (24 features)

## Per-feature PRDs
`Documentation/PRDs/<##-feature-name>.md` (24 PRDs)

## Mockups (visual contracts, design tokens)
`Documentation/Mockups/<##-feature-name>.html` (24 HTML wireframes)

> Note: there is no separate `Core-Logic-Spec.md` or `Design-System-Reference.md`. Design tokens live in mockup #01 and the Tailwind config (once scaffolded). Per-stage logic lives in each feature's `spec.md`.

---

# Current Phase

**Working on:** Phase `PHASE_NUMBER`

## Phase task spec
`Documentation/Projects/Phases/Phase <N> — <Name>/Phase <PHASE_NUMBER> — <subphase title>/task.md`

> Convention: `task.md` describes work to be done; `summary.md` is written *after* the phase is complete and summarizes what was actually delivered.

## Related feature spec (if applicable)
`SPEC_PATH`

I am ready to start working on Phase `PHASE_NUMBER` of this plan.

---

# Research Instructions

1. **Parallel** Explore calls to map the codebase (what's been built, what's scaffold). Always check whether files referenced in CLAUDE.md actually exist before assuming.
2. **Parallel** Explore calls (or direct Reads) for the specific Phase `PHASE_NUMBER` summary, the relevant feature spec(s), and the matching mockup HTML.
3. Skim recent git history if the repo is initialized (`git log --oneline -20`); otherwise skip.

Do not make any updates or changes yet. Research only. End with a short readiness summary covering:

- What Phase `PHASE_NUMBER` requires (concrete checklist from the summary)
- What's already done vs. still missing
- Any ambiguity or out-of-scope risk to flag (S-1)
- The minimal list of files you'll create/edit when I tell you to proceed

Wait for my "go" before writing code.

---

# Reference Repo Note

`~/development/_reference/claude-youtube/` (AgriciDaniel/claude-youtube, MIT) is required by CRIT-4 and Research Protocol R-1 before any prompt-porting (Tier 2 / Phase 1.3+). If it is not yet cloned, flag it — Phase 1.1 includes the clone step.
