import "server-only";

import { type Stage } from "@/lib/anthropic";
import type { Database, Json } from "@/lib/db/types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { RunNotFoundError } from "./errors";
import {
  DOWNSTREAM,
  STAGE_NUMBER,
  stageColumn,
  staleColumn,
} from "./pipeline-stages";
import { publish } from "./pipeline-bus";

type RunRow = Database["public"]["Tables"]["pipeline_runs"]["Row"];
type RunUpdate = Database["public"]["Tables"]["pipeline_runs"]["Update"];

// ONLY this module may mutate `pipeline_runs` (spec §4.7). Route handlers and
// other services go through one of the four helpers below; that's how we keep
// the status state machine, the staleness cascade, and the failure_reason
// format consistent.

async function applyPatch(runId: string, patch: RunUpdate): Promise<RunRow> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("pipeline_runs")
    .update(patch)
    .eq("id", runId)
    .is("deleted_at", null)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new RunNotFoundError(runId, "service");
  return data;
}

async function loadRun(runId: string): Promise<RunRow> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("pipeline_runs")
    .select("*")
    .eq("id", runId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new RunNotFoundError(runId, "service");
  return data;
}

export async function markStageStarted(
  runId: string,
  stage: Stage,
): Promise<RunRow> {
  const stageNumber = STAGE_NUMBER[stage];
  const row = await applyPatch(runId, {
    status: "running",
    current_stage: stageNumber,
  });
  await publish(runId, {
    event: "progress",
    payload: {
      stage: stageNumber,
      message: `Stage ${stageNumber} starting`,
    },
  });
  return row;
}

export async function markStageComplete(
  runId: string,
  stage: Stage,
  data: Json,
): Promise<RunRow> {
  const existing = await loadRun(runId);

  // Build the patch: write the stage's JSONB column, clear its own stale flag,
  // and flip the downstream stale flags ONLY for stages whose data column is
  // already populated (re-runs on a complete run shouldn't mark currently-empty
  // downstream stages stale — they're not "stale", they're "not yet computed").
  const patch: RunUpdate = {
    [stageColumn[stage]]: data,
    [staleColumn[stage]]: false,
  };

  for (const downstreamStage of DOWNSTREAM[stage]) {
    if (existing[stageColumn[downstreamStage]] !== null) {
      patch[staleColumn[downstreamStage]] = true;
    }
  }

  const row = await applyPatch(runId, patch);
  await publish(runId, {
    event: "stage_complete",
    payload: { stage: STAGE_NUMBER[stage] },
  });
  return row;
}

// Sanitize raw upstream error bodies before persisting. We keep the first
// 200 chars of the message, strip newlines, and prefix with the stage number
// so route handlers can pattern-match `^stage_<n>:` per the verification.
function sanitizeFailureReason(stage: Stage, error: unknown): string {
  const stageNumber = STAGE_NUMBER[stage];
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "unknown error";
  const safe = raw
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 200)
    .trim();
  return `stage_${stageNumber}: ${safe || "failed"}`;
}

export async function markStageFailed(
  runId: string,
  stage: Stage,
  error: unknown,
): Promise<RunRow> {
  const stageNumber = STAGE_NUMBER[stage];
  const failureReason = sanitizeFailureReason(stage, error);
  const row = await applyPatch(runId, {
    status: "error",
    current_stage: stageNumber,
    failure_reason: failureReason,
    completed_at: new Date().toISOString(),
  });
  await publish(runId, {
    event: "run_error",
    payload: {
      runId,
      stage: stageNumber,
      code: "STAGE_FAILED",
    },
  });
  return row;
}

// Reframes will be computed by the stage-4 handler in Phase 2 and stored
// inside score_data. Phase 1.6 doesn't accept them here — the gate signal
// alone is enough to drive the UI; Phase 2 can re-shape the signature when
// the reframes have a concrete schema.
export async function markGateFailed(
  runId: string,
  score: number,
): Promise<RunRow> {
  const row = await applyPatch(runId, {
    status: "gated_failed",
    current_stage: STAGE_NUMBER.score,
    failure_reason: `Score ${score} / 100 — below 92 threshold`,
    completed_at: new Date().toISOString(),
  });
  await publish(runId, {
    event: "run_gated",
    payload: { runId, score },
  });
  return row;
}

export async function markRunComplete(runId: string): Promise<RunRow> {
  const row = await applyPatch(runId, {
    status: "complete",
    completed_at: new Date().toISOString(),
  });
  await publish(runId, {
    event: "run_complete",
    payload: { runId },
  });
  return row;
}

export async function markRunCancelled(runId: string): Promise<RunRow> {
  return applyPatch(runId, {
    status: "error",
    failure_reason: "cancelled_by_user",
    completed_at: new Date().toISOString(),
  });
}
