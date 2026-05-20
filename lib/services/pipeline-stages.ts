import "server-only";

import { type Stage } from "@/lib/anthropic";
import type { Database, Json } from "@/lib/db/types";
import { TitlesDataSchema, hasAnyLockedTitle } from "@/lib/validation/titles";
import { HookDataSchema, hasLockedHook as hookIsLocked } from "@/lib/validation/hook";

type RunRow = Database["public"]["Tables"]["pipeline_runs"]["Row"];

export type StageNumber = 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

type StageColumn = Extract<
  keyof RunRow,
  | "competitor_data"
  | "score_data"
  | "titles_data"
  | "hook_data"
  | "script_data"
  | "lint_data"
  | "thumbnails_data"
  | "seo_data"
  | "ab_plan_data"
  | "engagement_drafts_data"
>;

type StaleColumn = Extract<
  keyof RunRow,
  | "stale_competitor"
  | "stale_score"
  | "stale_titles"
  | "stale_hook"
  | "stale_script"
  | "stale_lint"
  | "stale_thumbnails"
  | "stale_seo"
  | "stale_ab_plan"
  | "stale_engagement_drafts"
>;

export const stageColumn: Record<Stage, StageColumn> = {
  competitor: "competitor_data",
  score: "score_data",
  titles: "titles_data",
  hook: "hook_data",
  script: "script_data",
  lint: "lint_data",
  thumbnails: "thumbnails_data",
  seo: "seo_data",
  ab: "ab_plan_data",
  engagement: "engagement_drafts_data",
};

export const staleColumn: Record<Stage, StaleColumn> = {
  competitor: "stale_competitor",
  score: "stale_score",
  titles: "stale_titles",
  hook: "stale_hook",
  script: "stale_script",
  lint: "stale_lint",
  thumbnails: "stale_thumbnails",
  seo: "stale_seo",
  ab: "stale_ab_plan",
  engagement: "stale_engagement_drafts",
};

export const stageDependencies: Record<Stage, Stage[]> = {
  competitor: [],
  score: ["competitor"],
  titles: ["score"],
  hook: ["score", "titles"],
  thumbnails: ["score", "titles"],
  script: ["score", "titles", "hook"],
  lint: ["script"],
  seo: ["titles", "script"],
  ab: ["titles", "thumbnails"],
  engagement: ["titles", "script"],
};

// Spec §5.6 cascade map — re-running a stage marks these downstream stages
// stale. The verification matrix is the source of truth: re-running titles
// (stage 5) flips stale flags on 6/7/8/10/12, which is *not* the same as
// stageDependencies inverted. The cascade reflects which downstream outputs
// the spec author considers semantically invalid; stageDependencies reflects
// which inputs a stage strictly *needs* to compute.
export const DOWNSTREAM: Record<Stage, Stage[]> = {
  competitor: [
    "score",
    "titles",
    "hook",
    "script",
    "lint",
    "thumbnails",
    "seo",
    "ab",
    "engagement",
  ],
  score: [
    "titles",
    "hook",
    "script",
    "lint",
    "thumbnails",
    "seo",
    "ab",
    "engagement",
  ],
  titles: ["hook", "script", "lint", "seo", "engagement"],
  hook: ["script", "lint", "engagement"],
  script: ["lint", "seo", "engagement"],
  lint: [],
  thumbnails: ["ab"],
  seo: [],
  ab: [],
  engagement: [],
};

// Topological order — each stage's dependencies appear before it.
export const PIPELINE_ORDER: Stage[] = [
  "competitor",
  "score",
  "titles",
  "hook",
  "thumbnails",
  "script",
  "lint",
  "seo",
  "ab",
  "engagement",
];

export const STAGE_NUMBER: Record<Stage, StageNumber> = {
  competitor: 3,
  score: 4,
  titles: 5,
  hook: 6,
  script: 7,
  lint: 8,
  thumbnails: 9,
  seo: 10,
  ab: 11,
  engagement: 12,
};

export const STAGE_BY_NUMBER: Record<StageNumber, Stage> = {
  3: "competitor",
  4: "score",
  5: "titles",
  6: "hook",
  7: "script",
  8: "lint",
  9: "thumbnails",
  10: "seo",
  11: "ab",
  12: "engagement",
};

export const GATE_THRESHOLD = 92;

// Stage 5 (titles) is a checkpoint: these downstream stages need a *locked*
// title, not merely a populated titles_data column (spec §3.5). Stage 8
// (lint) is absent because it depends on script (7), which is already gated.
const REQUIRES_LOCKED_TITLE: ReadonlySet<Stage> = new Set<Stage>([
  "hook",
  "script",
  "thumbnails",
  "seo",
  "ab",
  "engagement",
]);

// Stage 6 (hook) is a checkpoint: Stage 7 (script) consumes the *locked* hook
// variant as its first section, so script can't run on a merely-populated
// hook_data. lint/seo/engagement depend on script transitively, so gating
// script alone covers them.
const REQUIRES_LOCKED_HOOK: ReadonlySet<Stage> = new Set<Stage>(["script"]);

export function hasLockedTitle(run: RunRow): boolean {
  const parsed = TitlesDataSchema.safeParse(run.titles_data);
  return parsed.success && hasAnyLockedTitle(parsed.data);
}

export function hasLockedHook(run: RunRow): boolean {
  const parsed = HookDataSchema.safeParse(run.hook_data);
  return parsed.success && hookIsLocked(parsed.data);
}

// True when `stage` may run for this run: its data dependencies are present
// and any checkpoint locks it requires (locked title / locked hook) are set.
export function canRunStage(stage: Stage, run: RunRow): boolean {
  const depsMet = stageDependencies[stage].every(
    (dep) => run[stageColumn[dep]] !== null,
  );
  if (!depsMet) return false;
  if (REQUIRES_LOCKED_TITLE.has(stage) && !hasLockedTitle(run)) return false;
  if (REQUIRES_LOCKED_HOOK.has(stage) && !hasLockedHook(run)) return false;
  return true;
}

export type StageContext = {
  runId: string;
  userId: string;
  run: RunRow;
};

export type StageHandler = (ctx: StageContext) => Promise<Json>;

const handlers = new Map<Stage, StageHandler>();

export function registerStageHandler(
  stage: Stage,
  handler: StageHandler,
): void {
  handlers.set(stage, handler);
}

export function clearStageHandlers(): void {
  handlers.clear();
}

export function getStageHandler(stage: Stage): StageHandler | undefined {
  return handlers.get(stage);
}

// Phase 1.6 default stubs. Phase 2 specs each replace their stage by calling
// `registerStageHandler(stage, realHandler)` at module load. The score stub
// passes the 92-point gate so the lifecycle verification test reaches a
// `complete` terminal status under stubs.
function makeStub(stage: Stage): StageHandler {
  return async ({ runId }) => {
    if (stage === "score") {
      return { score: 95, passed: true, stubbed: true } as Json;
    }
    return { stubbed: true, stage, runId } as Json;
  };
}

export function registerDefaultStubs(): void {
  for (const stage of PIPELINE_ORDER) {
    if (!handlers.has(stage)) {
      handlers.set(stage, makeStub(stage));
    }
  }
}

// Auto-register stubs at module load so production routes don't have to call
// `registerDefaultStubs()` explicitly. Tests can `clearStageHandlers()` then
// register custom handlers (the Phase 1.3 test pattern).
registerDefaultStubs();
