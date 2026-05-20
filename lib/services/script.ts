import "server-only";

import {
  buildSystem,
  callClaudeStream,
  estimateCostMicroUsd,
  extractTextFromMessage,
} from "@/lib/anthropic";
import type { Database } from "@/lib/db/types";
import {
  incrementSpendMicroUsd,
  incrementThrottle,
  writeScriptData,
} from "@/lib/db/script";
import {
  SCRIPT_MODEL,
  ScriptDataSchema,
  type ScriptData,
  type ScriptSection,
  type ScriptTargetMinutes,
} from "@/lib/validation/script";
import { CompetitorDataSchema } from "@/lib/validation/competitor";
import { HookDataSchema } from "@/lib/validation/hook";
import {
  TRIGGER_ORDER,
  TitlesDataSchema,
} from "@/lib/validation/titles";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  SCRIPT_SYSTEM,
  SCRIPT_SYSTEM_EST_TOKENS,
  buildFormatViolationReprompt,
  buildScriptUserPrompt,
} from "@/lib/prompts/script";
import { assertBudget, assertThrottle } from "./script-budget";
import { checkDrift } from "./script-drift";
import {
  predictRetentionCurve,
  sectionRetention,
} from "./retention-curve";
import {
  SECTION_BREAK,
  parseScriptWireFormat,
  validateScript,
} from "./script-parse";
import { getVoiceFingerprint } from "./voice-fingerprint";

export class MissingScriptPrereqError extends Error {
  constructor(reason: string) {
    super(`script prerequisites not met: ${reason}`);
    this.name = "MissingScriptPrereqError";
  }
}

export class ScriptFormatViolationError extends Error {
  constructor(readonly violations: string[]) {
    super(`script format violation: ${violations.join("; ")}`);
    this.name = "ScriptFormatViolationError";
  }
}

export type ScriptStreamEmitter = {
  progress: (message: string) => void;
  sectionChunk: (data: { sectionIndex: number; deltaText: string }) => void;
  sectionComplete: (data: { section: ScriptSection }) => void;
  rehookInserted: (data: { afterSectionIndex: number; atSec: number; text: string }) => void;
  loopOpened: (data: { loopId: string; setupSectionIndex: number; description: string }) => void;
  loopClosed: (data: { loopId: string; payoffSectionIndex: number }) => void;
};

type Locks = {
  lockedTitleIndex: number;
  lockedTitleText: string;
  lockedHookIndex: number;
  lockedHookText: string;
};

type ChannelRow = Database["public"]["Tables"]["channels"]["Row"];
type RunRow = Database["public"]["Tables"]["pipeline_runs"]["Row"];

function resolveLocks(run: RunRow): Locks {
  const titles = TitlesDataSchema.safeParse(run.titles_data);
  if (!titles.success) throw new MissingScriptPrereqError("titles missing");
  const lockedTrigger = TRIGGER_ORDER.find((t) => titles.data[t]?.lockedIn);
  if (!lockedTrigger) throw new MissingScriptPrereqError("no locked title");
  const lockedTitleIndex = TRIGGER_ORDER.indexOf(lockedTrigger);
  const lockedTitleText = titles.data[lockedTrigger]!.text;

  const hooks = HookDataSchema.safeParse(run.hook_data);
  if (!hooks.success || hooks.data.lockedVariantIndex === null) {
    throw new MissingScriptPrereqError("no locked hook");
  }
  const lockedHookIndex = hooks.data.lockedVariantIndex;
  const variant = hooks.data.variants[lockedHookIndex]!;
  const lockedHookText = variant.beats
    .filter((b) => b.line !== null)
    .map((b) => b.line)
    .join(" ")
    .trim();

  return { lockedTitleIndex, lockedTitleText, lockedHookIndex, lockedHookText };
}

async function loadChannel(channelId: string): Promise<ChannelRow> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("channels")
    .select("*")
    .eq("id", channelId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new MissingScriptPrereqError("channel not found");
  return data;
}

export async function generateScript(args: {
  runId: string;
  userId: string;
  run: RunRow;
  targetMinutes: ScriptTargetMinutes;
  emit: ScriptStreamEmitter;
}): Promise<ScriptData> {
  const { run, targetMinutes, emit } = args;
  if (run.competitor_data === null) {
    throw new MissingScriptPrereqError("competitor_data missing");
  }
  const locks = resolveLocks(run);

  emit.progress("Checking budget + rate limits…");
  await assertBudget();
  await assertThrottle(run.channel_id, "full");

  const channel = await loadChannel(run.channel_id);
  emit.progress("Reading channel voice…");
  const voiceDescriptor = await getVoiceFingerprint({
    channelId: run.channel_id,
    topVideosJson: channel.top_videos_json,
  });

  const competitor = CompetitorDataSchema.safeParse(run.competitor_data);
  const outlierPatterns = competitor.success
    ? competitor.data.extractedPatterns.map((p) => p.pattern)
    : [];

  const system = buildSystem(SCRIPT_SYSTEM, SCRIPT_SYSTEM_EST_TOKENS);
  const userPrompt = buildScriptUserPrompt({
    targetMinutes,
    ideaText: run.idea_text,
    niche: channel.niche ?? "",
    lockedTitle: locks.lockedTitleText,
    lockedHook: locks.lockedHookText,
    voiceDescriptor,
    outlierPatterns,
  });

  emit.progress("Writing script (Opus 4.7)…");
  let costMicroUsd = 0;

  function streamInto(messages: Parameters<typeof callClaudeStream>[0]["messages"]) {
    let seen = "";
    return callClaudeStream({
      stage: "script",
      system,
      messages,
      maxTokens: 8000,
      onTextDelta: (delta) => {
        seen += delta;
        const sectionIndex = (seen.match(/<section_break\/>/g)?.length ?? 0);
        emit.sectionChunk({ sectionIndex, deltaText: delta });
      },
    });
  }

  const first = await streamInto([{ role: "user", content: userPrompt }]);
  costMicroUsd += estimateCostMicroUsd("script", first.usage);
  let rawText = extractTextFromMessage(first);

  let parsed = parseScriptWireFormat(rawText, targetMinutes);
  let violations = validateScript({
    parsed,
    targetMinutes,
    lockedHook: locks.lockedHookText,
  });
  let formatViolationRetried = false;

  if (violations.length > 0) {
    formatViolationRetried = true;
    emit.progress("Fixing format issues…");
    const retry = await streamInto([
      { role: "user", content: userPrompt },
      { role: "assistant", content: rawText.slice(0, 8000) },
      { role: "user", content: buildFormatViolationReprompt(violations) },
    ]);
    costMicroUsd += estimateCostMicroUsd("script", retry.usage);
    rawText = extractTextFromMessage(retry);
    parsed = parseScriptWireFormat(rawText, targetMinutes);
    violations = validateScript({
      parsed,
      targetMinutes,
      lockedHook: locks.lockedHookText,
    });
    if (violations.length > 0) {
      await incrementSpendMicroUsd(costMicroUsd);
      throw new ScriptFormatViolationError(violations);
    }
  }

  // TS-computed retention curve + per-section predicted retention.
  const retentionCurve = predictRetentionCurve({
    sections: parsed.sections,
    rehookBeats: parsed.rehookBeats,
    openLoopCount: parsed.openLoops.length,
    estimatedRuntimeSec: parsed.estimatedRuntimeSec,
  });
  const sections = parsed.sections.map((s) => ({
    ...s,
    predictedRetention: sectionRetention(retentionCurve, s.startSec, s.endSec),
  }));

  for (const s of sections) emit.sectionComplete({ section: s });
  for (const r of parsed.rehookBeats) emit.rehookInserted(r);
  for (const l of parsed.openLoops) {
    emit.loopOpened({ loopId: l.id, setupSectionIndex: l.setupSectionIndex, description: l.description });
    emit.loopClosed({ loopId: l.id, payoffSectionIndex: l.payoffSectionIndex });
  }

  emit.progress("Checking drift vs. title…");
  const drift = await checkDrift({
    lockedTitle: locks.lockedTitleText,
    sections,
  });

  const payload: ScriptData = {
    targetMinutes,
    lockedTitleIndex: locks.lockedTitleIndex,
    lockedHookIndex: locks.lockedHookIndex,
    sections,
    rehookBeats: parsed.rehookBeats,
    openLoops: parsed.openLoops,
    retentionCurve,
    totalWordCount: parsed.totalWordCount,
    estimatedRuntimeSec: parsed.estimatedRuntimeSec,
    drift,
    formatViolationRetried,
    model: SCRIPT_MODEL,
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
  };
  const validated = ScriptDataSchema.parse(payload);

  await writeScriptData(
    {
      runId: args.runId,
      userId: args.userId,
      targetMinutes,
      lockedTitleIndex: locks.lockedTitleIndex,
      lockedHookIndex: locks.lockedHookIndex,
    },
    validated,
  );
  await incrementSpendMicroUsd(costMicroUsd);
  await incrementThrottle(run.channel_id, "full");

  return validated;
}

export { SECTION_BREAK };
