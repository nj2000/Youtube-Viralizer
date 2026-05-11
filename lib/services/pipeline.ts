import "server-only";

import { type Stage } from "@/lib/anthropic";
import type { Database, Json } from "@/lib/db/types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import {
  GateFailedError,
  MissingDependencyError,
  RunNotFoundError,
  StageNotImplementedError,
} from "./errors";

type RunRow = Database["public"]["Tables"]["pipeline_runs"]["Row"];
type RunUpdate = Database["public"]["Tables"]["pipeline_runs"]["Update"];
type RunStatus = Database["public"]["Enums"]["pipeline_run_status"];

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

export const stageDependencies: Record<Stage, Stage[]> = {
  competitor: [],
  score: ["competitor"],
  titles: ["score"],
  hook: ["score"],
  thumbnails: ["score", "titles"],
  script: ["score", "titles", "hook"],
  lint: ["script"],
  seo: ["titles", "script"],
  ab: ["titles", "thumbnails"],
  engagement: ["titles", "script"],
};

// Topological order — each stage's dependencies appear before it.
const PIPELINE_ORDER: Stage[] = [
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

export const GATE_THRESHOLD = 92;

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

async function loadRun(runId: string, userId: string): Promise<RunRow> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("pipeline_runs")
    .select("*")
    .eq("id", runId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new RunNotFoundError(runId, userId);
  return data;
}

async function writeStageOutput(
  runId: string,
  userId: string,
  column: StageColumn,
  payload: Json,
  status: RunStatus,
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const patch = { [column]: payload, status } as RunUpdate;
  const { error } = await supabase
    .from("pipeline_runs")
    .update(patch)
    .eq("id", runId)
    .eq("user_id", userId);
  if (error) throw error;
}

async function writeStatus(
  runId: string,
  userId: string,
  status: RunStatus,
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("pipeline_runs")
    .update({ status })
    .eq("id", runId)
    .eq("user_id", userId);
  if (error) throw error;
}

function isGateFailed(scoreData: Json): boolean {
  if (!scoreData || typeof scoreData !== "object" || Array.isArray(scoreData)) {
    return false;
  }
  const record = scoreData as Record<string, unknown>;
  if (record.passed === false) return true;
  const score = record.score;
  return typeof score === "number" && score < GATE_THRESHOLD;
}

export async function runStage(
  runId: string,
  stage: Stage,
  userId: string,
): Promise<Json> {
  const run = await loadRun(runId, userId);

  const missing = stageDependencies[stage].filter(
    (dep) => run[stageColumn[dep]] === null,
  );
  if (missing.length > 0) throw new MissingDependencyError(stage, missing);

  const handler = handlers.get(stage);
  if (!handler) throw new StageNotImplementedError(stage);

  await writeStatus(runId, userId, "running");

  let output: Json;
  try {
    output = await handler({ runId, userId, run });
  } catch (err) {
    await writeStatus(runId, userId, "error");
    throw err;
  }

  const gated = stage === "score" && isGateFailed(output);
  const nextStatus: RunStatus = gated ? "gated_failed" : "running";

  await writeStageOutput(runId, userId, stageColumn[stage], output, nextStatus);

  if (gated) {
    const score =
      typeof output === "object" &&
      output !== null &&
      !Array.isArray(output) &&
      typeof (output as Record<string, unknown>).score === "number"
        ? ((output as Record<string, unknown>).score as number)
        : 0;
    throw new GateFailedError(score);
  }

  return output;
}

export async function runFullPipeline(
  runId: string,
  userId: string,
): Promise<void> {
  for (const stage of PIPELINE_ORDER) {
    try {
      await runStage(runId, stage, userId);
    } catch (err) {
      if (err instanceof GateFailedError) return;
      throw err;
    }
  }
  await writeStatus(runId, userId, "complete");
}
