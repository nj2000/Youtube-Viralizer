import "server-only";

import { createHash } from "node:crypto";

import type { Database, Json } from "@/lib/db/types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  LintDataSchema,
  LINT_MODEL,
  type LintData,
  type LintIssue,
} from "@/lib/validation/lint";
import { ScriptDataSchema, type ScriptData } from "@/lib/validation/script";
import { HookDataSchema } from "@/lib/validation/hook";
import { TitlesDataSchema, TRIGGER_ORDER } from "@/lib/validation/titles";
import { publish } from "@/lib/services/pipeline-bus";
import {
  registerStageHandler,
  type StageContext,
} from "@/lib/services/pipeline-stages";
import { markStageComplete } from "@/lib/services/pipeline-state";
import { runAntiPatternPass, LintParseError } from "./lint-anti-pattern";
import { runDriftPass } from "./lint-drift";
import { MissingDependencyError } from "./errors";
import { recomputeSummary } from "./lint-mutations";
import {
  extractOpening,
  flattenSections,
  sectionContent,
  totalWordCount,
} from "./lint-script";

type RunRow = Database["public"]["Tables"]["pipeline_runs"]["Row"];

export class MissingLintPrereqError extends Error {
  constructor(reason: string) {
    super(`lint prerequisites not met: ${reason}`);
    this.name = "MissingLintPrereqError";
  }
}

// Maps a lint failure to the API-2 error envelope code (no raw upstream text).
export function lintErrorCode(err: unknown): string {
  if (
    err instanceof MissingLintPrereqError ||
    err instanceof MissingDependencyError
  ) {
    return "MISSING_PREREQUISITES";
  }
  if (err instanceof LintParseError) return "OUTPUT_PARSE_FAILED";
  return "UPSTREAM_ERROR";
}

export type LintInputs = {
  script: ScriptData;
  chosenTitle: string;
  chosenHook: string;
};

function resolveTitle(run: RunRow, script: ScriptData): string {
  const parsed = TitlesDataSchema.safeParse(run.titles_data);
  if (!parsed.success) return "";
  const trigger = TRIGGER_ORDER[script.lockedTitleIndex];
  if (!trigger) return "";
  return parsed.data[trigger]?.text ?? "";
}

function resolveHook(run: RunRow, script: ScriptData): string {
  const parsed = HookDataSchema.safeParse(run.hook_data);
  if (parsed.success) {
    const variant = parsed.data.variants[script.lockedHookIndex];
    const lines = variant?.beats
      .map((b) => b.line)
      .filter((l): l is string => Boolean(l));
    if (lines && lines.length) return lines.join(" ");
  }
  // Fall back to the script's cold-open section (it IS the locked hook).
  const coldOpen = script.sections.find((s) => s.role === "cold_open");
  return coldOpen ? sectionContent(coldOpen) : "";
}

// Resolve the three lint inputs from a run row. Returns null when the script
// (or its locked title/hook) isn't available yet.
export function resolveLintInputs(run: RunRow): LintInputs | null {
  const script = ScriptDataSchema.safeParse(run.script_data);
  if (!script.success) return null;
  const chosenTitle = resolveTitle(run, script.data);
  const chosenHook = resolveHook(run, script.data);
  if (!chosenTitle || !chosenHook) return null;
  return { script: script.data, chosenTitle, chosenHook };
}

export function computeInputsHash(inputs: LintInputs): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        script: inputs.script,
        title: inputs.chosenTitle,
        hook: inputs.chosenHook,
      }),
    )
    .digest("hex");
}

async function loadChannelContext(
  channelId: string,
): Promise<{ niche: string; voiceAvailable: boolean }> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("channels")
    .select("niche, top_videos_json")
    .eq("id", channelId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  const topVideos = data?.top_videos_json;
  const voiceAvailable = Array.isArray(topVideos) && topVideos.length >= 10;
  return { niche: data?.niche ?? "", voiceAvailable };
}

// Stage 8 handler. Runs the two Haiku passes, assembles + persists lint_data.
// Short-circuits with no LLM call when the inputs hash matches the stored lint
// (spec §5.7 dedup) — force re-runs clear lint_data first to bypass this.
export async function lintStageHandler(ctx: StageContext): Promise<Json> {
  const startedAt = Date.now();
  const inputs = resolveLintInputs(ctx.run);
  if (!inputs) {
    throw new MissingLintPrereqError("script, locked title, or locked hook missing");
  }

  const inputsHash = computeInputsHash(inputs);

  const existing = LintDataSchema.safeParse(ctx.run.lint_data);
  if (existing.success && existing.data.inputsHash === inputsHash) {
    await publish(ctx.runId, {
      event: "progress",
      payload: { stage: 8, message: "Lint already current — no changes." },
    });
    return existing.data as unknown as Json;
  }

  const { niche, voiceAvailable } = await loadChannelContext(ctx.run.channel_id);
  const opening = extractOpening(inputs.script);

  await publish(ctx.runId, {
    event: "progress",
    payload: { stage: 8, message: "Scanning script for anti-patterns…" },
  });
  const anti = await runAntiPatternPass({
    sections: flattenSections(inputs.script),
    chosenTitle: inputs.chosenTitle,
    chosenHook: inputs.chosenHook,
    niche,
    voiceAvailable,
  });

  await publish(ctx.runId, {
    event: "progress",
    payload: { stage: 8, message: "Comparing title promise to the script opening…" },
  });
  const driftResult = await runDriftPass(
    { chosenTitle: inputs.chosenTitle, niche, scriptOpening: opening.text },
    opening.wordCount,
  );

  const issues: LintIssue[] = [...anti.issues, ...driftResult.issues].slice(0, 200);
  const summary = recomputeSummary(issues, driftResult.drift, false);

  const lintData: LintData = {
    schemaVersion: 1,
    issues,
    drift: driftResult.drift,
    summary,
    modelId: LINT_MODEL,
    scanWordCount: totalWordCount(inputs.script),
    scanDurationMs: Date.now() - startedAt,
    promptTokensUsed: anti.usage.promptTokens + driftResult.usage.promptTokens,
    outputTokensUsed: anti.usage.outputTokens + driftResult.usage.outputTokens,
    cacheHit: anti.usage.cacheHit || driftResult.usage.cacheHit,
    generatedAt: new Date().toISOString(),
    inputsHash,
    overridden: false,
  };

  return LintDataSchema.parse(lintData) as unknown as Json;
}

// Manual run / re-run path (the "ready to lint" card and the rerun endpoint).
// Unlike the auto path (runStage via runFromStage), this does NOT flip run
// status to "running" — markStageComplete only writes lint_data + the stale
// cascade + a stage_complete event, so re-linting a finished run keeps its
// terminal status. `force` bypasses the inputsHash dedup by nulling the row's
// lint_data before the handler reads it.
export async function runLintManual(
  run: RunRow,
  userId: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  const ctxRun = opts.force ? { ...run, lint_data: null } : run;
  const output = await lintStageHandler({ runId: run.id, userId, run: ctxRun });
  await markStageComplete(run.id, "lint", output);
}

registerStageHandler("lint", lintStageHandler);
