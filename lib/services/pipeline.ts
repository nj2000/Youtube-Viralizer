import "server-only";

import { type Stage } from "@/lib/anthropic";
import type { Database, Json } from "@/lib/db/types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

// Side-effect import: registers every real stage handler so the orchestrator
// dispatch never silently falls through to the Phase 1.6 stubs.
import "./stage-handlers";

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
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return 0;
  }
  const record = payload as Record<string, unknown>;
  // Phase 2.2 score handler emits `finalScore`; the Phase 1.6 stub emitted
  // `score`. Honor both so re-running an older run doesn't lose the gate
  // message text.
  if (typeof record.finalScore === "number") return record.finalScore;
  if (typeof record.score === "number") return record.score;
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
    await markGateFailed(runId, score, output);
    throw new GateFailedError(score);
  }

  await markStageComplete(runId, stage, output);
  return output;
}

// Stages after which the orchestrator stops and waits for explicit user
// action before continuing. Two checkpoints:
//   - titles (5): user must lock ≥1 title before the fan-out runs.
//   - hook (6): user must lock a hook variant before Stage 7 (script) runs;
//     the locked hook becomes the script's first section verbatim.
// The run stays at status "running" / current_stage N until
// POST /api/runs/[runId]/continue resumes from the next stage.
const PAUSE_AFTER: ReadonlySet<Stage> = new Set<Stage>(["titles", "hook"]);

// Stages the auto-chain must NOT run — they require user input the orchestrator
// can't supply (Stage 7 needs a target length picked on the script card). The
// chain stops BEFORE a manual stage; it runs only via its own endpoint
// (POST /api/pipeline/script), which then resumes the chain from "lint".
const MANUAL_STAGES: ReadonlySet<Stage> = new Set<Stage>(["script"]);

export async function runFullPipeline(
  runId: string,
  userId: string,
): Promise<void> {
  for (const stage of PIPELINE_ORDER) {
    if (MANUAL_STAGES.has(stage)) return;
    try {
      await runStage(runId, stage, userId);
    } catch (err) {
      if (err instanceof GateFailedError) return;
      throw err;
    }
    if (PAUSE_AFTER.has(stage)) return;
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
    // Allow an explicit resume that STARTS at a manual stage (e.g. the script
    // endpoint resuming from "lint" is fine); only skip a manual stage when
    // the chain would roll INTO it.
    if (MANUAL_STAGES.has(stage) && stage !== fromStage) return;
    try {
      await runStage(runId, stage, userId);
    } catch (err) {
      if (err instanceof GateFailedError) return;
      throw err;
    }
    if (PAUSE_AFTER.has(stage)) return;
  }
  await markRunComplete(runId);
}
