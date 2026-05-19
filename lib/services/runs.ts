import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { STAGE_BY_NUMBER } from "@/lib/services/pipeline-stages";
import type { Database } from "@/lib/db/types";
import { getProfile } from "@/lib/db/profiles";
import {
  countRunsLastHourForUser,
  getRun,
  getRunRow,
  insertRun,
  listRuns,
  softDeleteRun,
  type ListRunsResult,
} from "@/lib/db/runs";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getUsageToday, DAILY_SOFT_CAP } from "@/lib/youtube/quota";
import type {
  RunListItem,
  RunRowView,
  RunStatus,
  StageNumber,
} from "@/lib/validation/runs";

import {
  markRunCancelled,
  markStageComplete,
} from "./pipeline-state";
import { publish } from "./pipeline-bus";
import { runFromStage, runFullPipeline } from "./pipeline";

type Client = SupabaseClient<Database>;

const RUNS_PER_HOUR_LIMIT = 30;

export class NoActiveChannelError extends Error {
  constructor() {
    super("No active channel for user");
    this.name = "NoActiveChannelError";
  }
}

export class QuotaExceededRunError extends Error {
  constructor(
    readonly used: number,
    readonly cap: number,
  ) {
    super(`YouTube quota exceeded: ${used} / ${cap}`);
    this.name = "QuotaExceededRunError";
  }
}

export class RateLimitedError extends Error {
  constructor(readonly retryAfterSec: number) {
    super("Too many runs in the last hour");
    this.name = "RateLimitedError";
  }
}

export class RunNotFoundForUserError extends Error {
  constructor() {
    super("Run not found");
    this.name = "RunNotFoundForUserError";
  }
}

export class RunAlreadyRunningError extends Error {
  constructor() {
    super("Run is currently running");
    this.name = "RunAlreadyRunningError";
  }
}

const TERMINAL_STATUSES: RunStatus[] = [
  "complete",
  "gated_failed",
  "error",
];

export type CreateRunInput = {
  userId: string;
  ideaText: string;
};

export async function createRun(
  client: Client,
  input: CreateRunInput,
): Promise<{ runId: string }> {
  const profile = await getProfile(client, input.userId);
  if (!profile?.active_channel_id) throw new NoActiveChannelError();

  const used = await getUsageToday();
  if (used > DAILY_SOFT_CAP) {
    throw new QuotaExceededRunError(used, DAILY_SOFT_CAP);
  }

  const recent = await countRunsLastHourForUser(client, input.userId);
  if (recent >= RUNS_PER_HOUR_LIMIT) {
    throw new RateLimitedError(60 * 60);
  }

  const run = await insertRun(client, {
    user_id: input.userId,
    channel_id: profile.active_channel_id,
    idea_text: input.ideaText,
    status: "queued",
  });

  // Fire-and-forget. The orchestrator uses the service-role client internally
  // so it doesn't share the request's RLS context. We catch and emit a bus
  // error event on failure so the SSE stream can react.
  void (async () => {
    try {
      await runFullPipeline(run.id, input.userId);
    } catch (err) {
      await publish(run.id, {
        event: "run_error",
        payload: {
          runId: run.id,
          stage: null,
          code: err instanceof Error ? err.name : "INTERNAL_ERROR",
        },
      });
    }
  })();

  return { runId: run.id };
}

export async function listRunsForActiveChannel(
  client: Client,
  args: {
    userId: string;
    q?: string;
    status?: RunStatus;
    page: number;
  },
): Promise<ListRunsResult & { activeChannelId: string }> {
  const profile = await getProfile(client, args.userId);
  if (!profile?.active_channel_id) throw new NoActiveChannelError();

  const result = await listRuns(client, {
    userId: args.userId,
    channelId: profile.active_channel_id,
    q: args.q,
    status: args.status,
    page: args.page,
  });

  return { ...result, activeChannelId: profile.active_channel_id };
}

export async function getRunForUser(
  client: Client,
  args: { runId: string; userId: string },
): Promise<RunRowView> {
  const run = await getRun(client, args.runId);
  if (!run || run.userId !== args.userId) {
    throw new RunNotFoundForUserError();
  }
  return run;
}

export async function softDeleteRunForUser(
  client: Client,
  args: { runId: string; userId: string },
): Promise<void> {
  const row = await getRunRow(client, args.runId);
  if (!row || row.user_id !== args.userId) {
    throw new RunNotFoundForUserError();
  }

  // If the run is currently in flight, the spec wants cancel + soft-delete in
  // one atomic logical step. We update via service client to set the cancel
  // markers AND deleted_at together, then emit the bus event so any open SSE
  // peers can surface the deletion.
  if (row.status === "queued" || row.status === "running") {
    const serviceClient = createSupabaseServiceClient();
    const nowIso = new Date().toISOString();
    const { error } = await serviceClient
      .from("pipeline_runs")
      .update({
        status: "error",
        failure_reason: "cancelled_by_user",
        completed_at: nowIso,
        deleted_at: nowIso,
      })
      .eq("id", args.runId);
    if (error) throw error;
    await publish(args.runId, {
      event: "run_error",
      payload: {
        runId: args.runId,
        stage: row.current_stage ?? null,
        code: "RUN_DELETED",
      },
    });
    return;
  }

  await softDeleteRun(client, args.runId);
}

export async function cancelRunForUser(
  client: Client,
  args: { runId: string; userId: string },
): Promise<{ cancelled: boolean }> {
  const row = await getRunRow(client, args.runId);
  if (!row || row.user_id !== args.userId) {
    throw new RunNotFoundForUserError();
  }

  if (TERMINAL_STATUSES.includes(row.status)) {
    return { cancelled: false };
  }

  await markRunCancelled(args.runId);
  await publish(args.runId, {
    event: "run_error",
    payload: {
      runId: args.runId,
      stage: row.current_stage ?? null,
      code: "RUN_CANCELLED",
    },
  });
  return { cancelled: true };
}

export async function rerunFromStageForUser(
  client: Client,
  args: { runId: string; userId: string; stage: StageNumber },
): Promise<{ runId: string }> {
  const row = await getRunRow(client, args.runId);
  if (!row || row.user_id !== args.userId) {
    throw new RunNotFoundForUserError();
  }
  if (row.status === "running") throw new RunAlreadyRunningError();

  const stage = STAGE_BY_NUMBER[args.stage as 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12];
  if (!stage) throw new RunNotFoundForUserError();

  void (async () => {
    try {
      await runFromStage(args.runId, args.userId, stage);
    } catch (err) {
      await publish(args.runId, {
        event: "run_error",
        payload: {
          runId: args.runId,
          stage: args.stage,
          code: err instanceof Error ? err.name : "INTERNAL_ERROR",
        },
      });
    }
  })();

  return { runId: args.runId };
}

// Exposed so the SSE proxy can also re-emit a stage_complete with a fresh row
// after a server-side cascade write. Currently unused in API routes but kept
// for parity with the spec's bus contract.
export { markStageComplete };

export type { RunListItem };
