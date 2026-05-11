# Phase 1.1 — Project scaffold + env

**Parent:** Phase 1 — Foundation
**Status:** Not Started
**Estimated:** 3-5 hours
**Depends on:** none (first subphase)
**Reference:** Build-Order.md §0.1–§0.3; CLAUDE.md (Stack lock-in, EXT-1, CRIT-4)

## Goal

Stand up the Next.js 15 + TypeScript + Tailwind project shell with the locked design tokens, ship `lib/env.ts` Zod-validated env vars that prevent the app from starting on bad config, and satisfy MIT attribution obligations for the `claude-youtube` reference skill before any prompt code is written.

## What to Build

### Step 1 — Next.js 15 scaffold
- `npx create-next-app@latest` with App Router, TypeScript, Tailwind, ESLint; remove the default starter content.
- `tsconfig.json` with `"strict": true`, `"noUncheckedIndexedAccess": true`, path alias `"@/*": ["./*"]`.
- App Router only (per CLAUDE.md Stack lock-in); Pages Router disabled.
- Server Components default per TS-1 — `app/page.tsx` has no `"use client"`.

### Step 2 — Tailwind design tokens (from mockup #01)
- Tailwind v4 via `@tailwindcss/postcss`; tokens in `tailwind.config.ts` + `app/globals.css` `@theme` block.
- Colors required: `yt` (YouTube red palette 50–950), `ink` (dark neutrals 50–950), `curiosity` (purple/amber trigger), `fear` (red trigger, distinct from `yt`), `result` (green trigger).
- Inter font; system stack fallback. No component library.

### Step 3 — `lib/env.ts` Zod validation (EXT-1)
- Single Zod schema parses `process.env` at module load and throws on malformed config.
- Required: `ANTHROPIC_API_KEY`, `YOUTUBE_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `SITE_URL`.
- Error message lists every failing key (don't stop at first).
- Never `console.log(env)`.
- `.env.example` lists all 7 keys with empty values; `.env.local` is gitignored.

### Step 4 — Attribution + reference clone (CRIT-4)
- `ATTRIBUTIONS.md` at repo root with full MIT license text + literal line `Copyright (c) 2025 Daniel Agrici` + link to `https://github.com/AgriciDaniel/claude-youtube`.
- Clone reference repo to `~/development/_reference/claude-youtube/`; verify `sub-skills/` directory exists.

### Step 5 — Tooling
- ESLint flat config `next/core-web-vitals` + `next/typescript`.
- Prettier (2-space indent).
- `package.json` scripts: `dev`, `build`, `lint`, `typecheck`, `format`.

## Cross-feature contracts

- `lib/env.ts` is consumed by Phase 1.2 (Supabase clients), Phase 1.3 (Anthropic + YouTube wrappers), Phase 1.4 (auth callback URL via `SITE_URL`). Adding env vars later means extending this single Zod object — no parallel env files.
- `~/development/_reference/claude-youtube/` must exist before any Tier 2 prompt-porting begins (Research Protocol R-1, CRIT-4). Stage-prompt files in `lib/prompts/` will reference subskills here.
- Tailwind color tokens are the visual contract for all subsequent UI work — renaming tokens later breaks every component.

## Verification

- [ ] `pnpm dev` boots a placeholder home page on `localhost:3000` without errors
- [ ] `pnpm tsc --noEmit` passes with strict mode
- [ ] `pnpm lint` passes with zero errors
- [ ] Importing `lib/env.ts` with `ANTHROPIC_API_KEY` unset throws a typed Zod error naming the missing key
- [ ] Importing `lib/env.ts` with `SUPABASE_URL=not-a-url` throws a typed Zod error
- [ ] `ATTRIBUTIONS.md` exists at repo root and contains the literal string `Copyright (c) 2025 Daniel Agrici` plus full MIT license text
- [ ] `~/development/_reference/claude-youtube/sub-skills/` directory exists and contains `competitor.md`, `ideate.md`, `seo.md`, `hook.md`, `script.md`, `thumbnail.md`, `metadata.md`
- [ ] Tailwind config exports `yt`, `ink`, `curiosity`, `fear`, `result` color tokens — verified by referencing `bg-yt-500`, `bg-ink-900`, `bg-curiosity-500`, `bg-fear-500`, `bg-result-500` in a throwaway JSX snippet that compiles
- [ ] `.env.example` lists all 7 required env vars with empty values
- [ ] `.env.local` is gitignored (verified by `git check-ignore .env.local`)
- [ ] `app/page.tsx` has no `"use client"` directive

## Out of scope

- Supabase setup and schemas (Phase 1.2)
- Anthropic and YouTube SDK wrappers (Phase 1.3)
- Magic-link auth flow (Phase 1.4)
- Channel onboarding (Phase 1.5)
- Idea workspace pages (Phase 1.6)
- Any `lib/prompts/` files or pipeline service code (Phase 2+)
- CI / GitHub Actions
