import "server-only";

import {
  buildSystem,
  callClaude,
  estimateCostMicroUsd,
  extractTextFromMessage,
} from "@/lib/anthropic";
import type { Database } from "@/lib/db/types";
import {
  clearScriptData,
  incrementSpendMicroUsd,
  incrementThrottle,
  readScriptData,
  writeScriptData,
} from "@/lib/db/script";
import {
  SCRIPT_WPM,
  ScriptDataSchema,
  type ScriptData,
} from "@/lib/validation/script";
import { SCRIPT_SYSTEM, SCRIPT_SYSTEM_EST_TOKENS } from "@/lib/prompts/script";
import { assertBudget, assertThrottle } from "./script-budget";
import {
  predictRetentionCurve,
  sectionRetention,
} from "./retention-curve";
import { parseParagraphsFromBlock } from "./script-parse";
import { MissingScriptPrereqError } from "./script";

type RunRow = Database["public"]["Tables"]["pipeline_runs"]["Row"];

function wordsIn(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

// Re-pick: clears script_data entirely (destructive, no archive in Phase 1).
export async function relockScript(args: {
  runId: string;
  userId: string;
}): Promise<void> {
  await clearScriptData(args);
}

// Single-section regenerate — keeps role/title, rewrites the paragraphs, and
// recomputes downstream section time bounds + the retention curve. Does NOT
// auto-queue Stage 8 (only full-script generation does).
export async function regenerateScriptSection(args: {
  runId: string;
  userId: string;
  run: RunRow;
  sectionIndex: number;
}): Promise<ScriptData> {
  const existing = await readScriptData({
    runId: args.runId,
    userId: args.userId,
  });
  if (!existing) throw new MissingScriptPrereqError("no script to regenerate");
  const target = existing.sections[args.sectionIndex];
  if (!target) throw new MissingScriptPrereqError("section index out of range");

  await assertBudget();
  await assertThrottle(args.run.channel_id, "section");

  const otherTitles = existing.sections
    .map((s) => `  SECTION ${s.index} | ${s.title} | role=${s.role}`)
    .join("\n");
  const system = buildSystem(SCRIPT_SYSTEM, SCRIPT_SYSTEM_EST_TOKENS);
  const userPrompt = `Rewrite ONLY section ${args.sectionIndex} (${target.title}, role=${target.role}) of an existing script. Return ONLY that section's beat lines in the wire format ([SKELETON]/[PERSONALITY]/(broll)/(rehook)) — no "## SECTION" header, no <section_break/>. Keep it ~${Math.round((target.endSec - target.startSec) / 60 * SCRIPT_WPM)} words and consistent with the surrounding sections:

${otherTitles}

${args.sectionIndex === 0 ? "This is the cold open — the first [SKELETON] line must stay the locked hook verbatim." : ""}`;

  const message = await callClaude({
    stage: "script",
    system,
    messages: [{ role: "user", content: userPrompt }],
    maxTokens: 2000,
  });
  const paragraphs = parseParagraphsFromBlock(extractTextFromMessage(message));
  if (paragraphs.length === 0) {
    throw new MissingScriptPrereqError("regenerated section was empty");
  }

  // Replace paragraphs; recompute this section's duration + shift the rest.
  const sectionWords = paragraphs.reduce((s, p) => s + wordsIn(p.text), 0);
  const sectionSec = Math.max(1, Math.round((sectionWords / SCRIPT_WPM) * 60));

  let cursor = target.startSec;
  const sections = existing.sections.map((s) => {
    if (s.index < args.sectionIndex) return s;
    if (s.index === args.sectionIndex) {
      const startSec = target.startSec;
      const endSec = startSec + sectionSec;
      cursor = endSec;
      return { ...s, paragraphs, startSec, endSec };
    }
    const dur = s.endSec - s.startSec;
    const startSec = cursor;
    const endSec = cursor + dur;
    cursor = endSec;
    return { ...s, startSec, endSec };
  });

  const totalWordCount = sections.reduce(
    (sum, s) => sum + s.paragraphs.reduce((a, p) => a + wordsIn(p.text), 0),
    0,
  );
  const estimatedRuntimeSec = sections.at(-1)?.endSec ?? existing.estimatedRuntimeSec;
  const retentionCurve = predictRetentionCurve({
    sections,
    rehookBeats: existing.rehookBeats,
    openLoopCount: existing.openLoops.length,
    estimatedRuntimeSec,
  });
  const withRetention = sections.map((s) => ({
    ...s,
    predictedRetention: sectionRetention(retentionCurve, s.startSec, s.endSec),
  }));

  const next: ScriptData = {
    ...existing,
    sections: withRetention,
    retentionCurve,
    totalWordCount,
    estimatedRuntimeSec,
  };
  const validated = ScriptDataSchema.parse(next);
  await writeScriptData(
    {
      runId: args.runId,
      userId: args.userId,
      targetMinutes: existing.targetMinutes,
      lockedTitleIndex: existing.lockedTitleIndex,
      lockedHookIndex: existing.lockedHookIndex,
    },
    validated,
  );
  await incrementSpendMicroUsd(estimateCostMicroUsd("script", message.usage));
  await incrementThrottle(args.run.channel_id, "section");
  return validated;
}
