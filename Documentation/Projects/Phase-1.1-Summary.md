# Phase 1.1 — Project Scaffold + Env

**Status:** Complete
**Date:** 2026-05-11
**Branch:** `main`
**Detail:** See `Phases/Phase 1 — Foundation/Phase 1.1 — Project scaffold + env/summary.md` for the full per-file breakdown.

---

## What was built

The technical foundation for the entire app — nothing functional yet, but every later phase plugs into this scaffold:

- A Next.js 15 App Router project with TypeScript strict mode (`noUncheckedIndexedAccess` on, `@/*` path alias).
- Tailwind v4 with the **locked design tokens** from mockup #01: the `yt`/`ink` palettes, the `curiosity`/`fear`/`result` trigger colors, the shadow tokens, and the `.glow-bg`/`.grid-bg`/`.card`/`.pulse-dot` utility classes. These are the visual contract every subsequent UI feature inherits.
- A single Zod-validated `lib/env.ts` that parses the 7 required env vars at module load and throws a typed error listing **every** failing key. The app cannot start with bad config.
- `ATTRIBUTIONS.md` at the repo root with the full MIT license for `AgriciDaniel/claude-youtube` and a footer link in the app layout, satisfying CRIT-4 before any prompt code is written.
- ESLint 9 flat config (`next/core-web-vitals` + `next/typescript`), Prettier, `.gitignore`, `.env.example`, and the `pnpm dev`/`build`/`lint`/`typecheck`/`format` scripts.
- A placeholder home page (Server Component) that demonstrates the design tokens are wired up.
- Reusable conversation-flow prompt templates in `prompts/` (start → focus → execute → document).

The reference repo `~/development/_reference/claude-youtube/` was also cloned locally so future phases can lift sub-skill prompts under the MIT terms.

---

## Key implementation decisions

| Decision | Why |
|---|---|
| **pnpm** as the package manager | The phase `task.md` verification commands all assume `pnpm`. Lockfile is `pnpm-lock.yaml`. |
| **Manual scaffold** instead of `create-next-app` | `create-next-app` refused because the directory name `Youtube Viralizer` contains a space and uppercase letters (npm naming rules). Every file the generator would have produced was written by hand with `package.json` `name: "youtube-viralizer"`. Net effect on the deliverable is zero. |
| **Tailwind v4 `@theme` in CSS, not JS config** | v4's idiomatic approach is CSS-side. `tailwind.config.ts` exists as a stub (content paths only); all tokens live in `app/globals.css` so the visual contract is in one place. |
| **`next/font/google` for Inter + JetBrains Mono** | Initial scaffold used a Google Fonts `<link>` tag which tripped the `@next/next/no-page-custom-font` lint warning. Switched to `next/font/google` with CSS-variable exposure. Variables (`--font-inter`, `--font-jetbrains-mono`) feed into the `@theme` block's `--font-sans`/`--font-mono` chain. |
| **Aggregated Zod error message** | When `lib/env.ts` parsing fails, the error lists **all** failing keys at once instead of stopping at the first one, so a developer sees the full picture immediately. |
| **Symlinked reference sub-skills** | The upstream repo nests them at `skills/claude-youtube/sub-skills/`, not at the top level the phase `task.md` assumed. Added a convenience symlink `~/development/_reference/claude-youtube/sub-skills → skills/claude-youtube/sub-skills` so verification step 7 and future per-prompt `// Adapted from sub-skills/<name>.md` comments both resolve. |
| **No tests written** | No testing framework is configured yet; per the execution-prompt policy, tests are deferred to whichever phase first introduces a framework. |
| **Trigger tokens are single-step** | `curiosity`, `fear`, `result` are defined only at `-500` per mockup #01. The phase verification only references `*-500`, so the contract is met without inventing extra shades that aren't in the design. |

---

## Files created or modified

**Scaffold + tooling** (repo root)
```
package.json, pnpm-lock.yaml, tsconfig.json, next.config.ts,
postcss.config.mjs, eslint.config.mjs, .prettierrc, .gitignore,
.env.example, tailwind.config.ts
```

**App entry**
```
app/layout.tsx        Server Component root, fonts, attribution footer
app/page.tsx          Server Component placeholder + token swatch row
app/globals.css       Tailwind v4 import + @theme tokens + utility classes
```

**Library**
```
lib/env.ts            Zod schema for 7 env vars, aggregated error
```

**Attribution**
```
ATTRIBUTIONS.md       MIT license + copyright + source link (CRIT-4)
```

**Documentation & workflow**
```
prompts/1-start-conversation.md    Session-kickoff template
prompts/2-focus-phase.md           Phase-focus template
prompts/3-execution.md             Phase-execution template
prompts/4-document.md              Phase-documentation template
Documentation/Projects/Phases/*/task.md       Renamed from summary.md (27 files)
Documentation/Projects/Phases/.../Phase 1.1.../summary.md  Post-phase deep dive
Documentation/Projects/Implementation-Plan.md  Status update + checkbox on 1.1
```

---

## How to verify it works

From the project root:

```bash
# Install
pnpm install

# Type-check (strict mode)
pnpm typecheck

# Lint (zero warnings expected)
pnpm lint

# Full production build (compiles, lints, type-checks, prerenders)
pnpm build

# Boot the dev server and visit http://localhost:3000
pnpm dev
```

**Verify env validation throws on bad config** (Node 22+ required for `--experimental-strip-types`):

```bash
# Missing keys
env -u ANTHROPIC_API_KEY -u YOUTUBE_API_KEY -u SUPABASE_URL \
    -u SUPABASE_ANON_KEY -u SUPABASE_SERVICE_ROLE_KEY \
    -u RESEND_API_KEY -u SITE_URL \
  node --experimental-strip-types --no-warnings --input-type=module \
       -e "import('./lib/env.ts').catch(e => console.log(e.message))"
# Expected: error lists all 7 missing keys

# Malformed URL
ANTHROPIC_API_KEY=x YOUTUBE_API_KEY=x SUPABASE_URL=not-a-url \
SUPABASE_ANON_KEY=x SUPABASE_SERVICE_ROLE_KEY=x \
RESEND_API_KEY=x SITE_URL=https://example.com \
  node --experimental-strip-types --no-warnings --input-type=module \
       -e "import('./lib/env.ts').catch(e => console.log(e.message))"
# Expected: SUPABASE_URL: SUPABASE_URL must be a valid URL
```

**Verify attribution + gitignore**:

```bash
grep "Copyright (c) 2025 Daniel Agrici" ATTRIBUTIONS.md   # must match
git check-ignore .env.local                              # exit 0 = ignored
ls ~/development/_reference/claude-youtube/sub-skills/   # must list 7 .md files
```

**Verify design tokens compiled**:

```bash
pnpm build
grep -oE "(bg-yt-500|bg-ink-900|bg-curiosity-500|bg-fear-500|bg-result-500)" \
  .next/static/css/*.css | sort -u
# Expected: all 5 classes listed
```

---

## Issues encountered and how they were resolved

**`create-next-app` rejected the directory name.** npm naming rules forbid spaces and capitals, so the generator refused to scaffold into `Youtube Viralizer/`. Fixed by writing every file manually with a valid `package.json` `name: "youtube-viralizer"`. Same output, just authored by hand.

**Lint warning on Google Fonts via `<link>` tag.** Initial scaffold loaded Inter and JetBrains Mono with `<link>` tags in `<head>`, which tripped `@next/next/no-page-custom-font`. Migrated to `next/font/google` with CSS variables wired through the `@theme` block. Lint now zero-warning.

**Reference repo layout didn't match the phase plan.** `task.md` expected `~/development/_reference/claude-youtube/sub-skills/`, but the upstream repo nests them under `skills/claude-youtube/sub-skills/`. Added a top-level symlink to satisfy the verification step without forking the upstream repo. Future per-prompt `// Adapted from sub-skills/<name>.md` comments will resolve through the symlink.

**Token shade ranges in `task.md` didn't match the mockup.** `task.md` said "yt (50–950)" and "ink (50–950)"; mockup #01 actually defines `yt` at 50–900 (no 950) and `ink` at 100–950 with an extra 850 step (no 50). The mockup is the locked visual contract, so the implementation follows the mockup exactly. The verification checkboxes only reference `yt-500` and `ink-900`, both of which exist.

**Memory files initially written to the wrong path.** The harness expects memory at `~/.claude/projects/-Users-nikolasjaeger-.../memory/`, but the first writes landed in the project-root `memory/` directory. Moved the files and removed the misplaced directory before committing.
