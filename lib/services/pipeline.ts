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
import {
  GATE_THRESHOLD,
  PIPELINE_ORDER,
  getStageHandler,
  stageColumn,
  stageDependencies,
  type StageContext,
} from "./pipeline-stages";
import {
  markGateFailed,
  markRunComplete,
  markStageComplete,
  markStageFailed,
  markStageStarted,
} from "./pipeline-state";

type RunRow = Database["public"]["Tables"]["pipeline_runs"]["Row"];

export {
  GATE_THRESHOLD,
  PIPELINE_ORDER,
  clearStageHandlers,
  registerStageHandler,
  stageColumn,
  stageDependencies,
  type StageContext,
  type StageHandler,
} from "./pipeline-stages";

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

function isGateFailed(scoreData: Json): boolean {
  if (!scoreData || typeof scoreData !== "object" || Array.isArray(scoreData)) {
    return false;
  }
  const record = scoreData as Record<string, unknown>;
  if (record.passed === false) return true;
  const score = record.score;
  return typeof score === "number" && score < GATE_THRESHOLD;
}

function extractScore(payload: Json): number {
  if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    typeof (payload as Record<string, unknown>).score === "number"
  ) {
    return (payload as Record<string, unknown>).score as number;
  }
  return 0;
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

  const handler = getStageHandler(stage);
  if (!handler) throw new StageNotImplementedError(stage);

  await markStageStarted(runId, stage);

  let output: Json;
  try {
    const ctx: StageContext = { runId, userId, run };
    output = await handler(ctx);
  } catch (err) {
    await markStageFailed(runId, stage, err);
    throw err;
  }

  if (stage === "score" && isGateFailed(output)) {
    const score = extractScore(output);
    await markGateFailed(runId, score);
    throw new GateFailedError(score);
  }

  await markStageComplete(runId, stage, output);
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
  await markRunComplete(runId);
}

export async function runFromStage(
  runId: string,
  userId: string,
  fromStage: Stage,
): Promise<void> {
  const startIndex = PIPELINE_ORDER.indexOf(fromStage);
  if (startIndex < 0) throw new StageNotImplementedError(fromStage);

  for (const stage of PIPELINE_ORDER.slice(startIndex)) {
    try {
      await runStage(runId, stage, userId);
    } catch (err) {
      if (err instanceof GateFailedError) return;
      throw err;
    }
  }
  await markRunComplete(runId);
}
