import "server-only";

import { buildSystem } from "@/lib/anthropic";
import type { Database, Json } from "@/lib/db/types";
import { readHookData, writeHookData } from "@/lib/db/hook";
import { HOOK_SYSTEM, HOOK_SYSTEM_EST_TOKENS } from "@/lib/prompts/hook";
import { CompetitorDataSchema } from "@/lib/validation/competitor";
import {
  HOOK_MODEL,
  HookDataSchema,
  type HookData,
  type HookVariant,
  type HookWarning,
} from "@/lib/validation/hook";
import {
  TRIGGER_ORDER,
  TitlesDataSchema,
  hasAnyLockedTitle,
  type TitlesData,
} from "@/lib/validation/titles";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { publish } from "@/lib/services/pipeline-bus";
import {
  registerStageHandler,
  type StageContext,
} from "@/lib/services/pipeline-stages";
import {
  computeDropoffRisk,
  computeRetention30s,
  computeSpeakTimeSec,
  computeWarnings,
  computeWordCount,
} from "./hook-metrics";
import {
  generateHookVariants,
  type RawHookVariant,
} from "./hook-llm";
import type { HookPromptTitle } from "@/lib/prompts/hook";

type ChannelRow = Database["public"]["Tables"]["channels"]["Row"];

export class MissingHookPrereqError extends Error {
  constructor(reason: string) {
    super(`hook prerequisites not met: ${reason}`);
    this.name = "MissingHookPrereqError";
  }
}

type HookContext = {
  ideaText: string;
  niche: string;
  titles: HookPromptTitle[];
  outlierPatterns: string[];
};

async function loadChannelNiche(channelId: string): Promise<string> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("channels")
    .select("niche")
    .eq("id", channelId)
    .is("deleted_at", null)
    .maybeSingle<Pick<ChannelRow, "niche">>();
  if (error) throw error;
  return data?.niche ?? "";
}

function titlesForPrompt(titles: TitlesData): HookPromptTitle[] {
  const out: HookPromptTitle[] = [];
  TRIGGER_ORDER.forEach((trigger, index) => {
    const v = titles[trigger];
    if (v) out.push({ index, trigger, text: v.text });
  });
  return out;
}

async function buildContext(ctx: StageContext): Promise<HookContext> {
  const titlesParsed = TitlesDataSchema.safeParse(ctx.run.titles_data);
  if (!titlesParsed.success || !hasAnyLockedTitle(titlesParsed.data)) {
    throw new MissingHookPrereqError("no locked title");
  }
  const competitor = CompetitorDataSchema.safeParse(ctx.run.competitor_data);
  const outlierPatterns = competitor.success
    ? competitor.data.extractedPatterns.map((p) => p.pattern)
    : [];

  return {
    ideaText: ctx.run.idea_text,
    niche: await loadChannelNiche(ctx.run.channel_id),
    titles: titlesForPrompt(titlesParsed.data),
    outlierPatterns,
  };
}

function computeVariant(
  raw: RawHookVariant,
  setEqualityForced: boolean,
): HookVariant {
  const wordCount = computeWordCount(raw.beats);
  const speakTimeSec = computeSpeakTimeSec(wordCount);
  const retention30sPredict = computeRetention30s({
    archetype: raw.archetype,
    openerStrengthRaw: raw.openerStrengthRaw,
    wordCount,
    promise: raw.promise,
    beats: raw.beats,
  });
  const warnings: HookWarning[] = computeWarnings({
    wordCount,
    beats: raw.beats,
    promise: raw.promise,
  });
  if (setEqualityForced) warnings.push("ARCHETYPE_DUPLICATE");
  const { risk, killerCombo } = computeDropoffRisk(
    retention30sPredict,
    warnings,
  );
  if (killerCombo) warnings.push("KILLER_COMBO");

  return {
    linkedTitleIndex: raw.linkedTitleIndex,
    archetype: raw.archetype,
    promise: raw.promise,
    beats: raw.beats,
    reasoning: raw.reasoning,
    openerStrengthRaw: raw.openerStrengthRaw,
    wordCount,
    speakTimeSec,
    retention30sPredict,
    dropoffRiskRating: risk,
    warnings,
  };
}

async function generateComputedVariants(
  ctx: StageContext,
): Promise<HookVariant[]> {
  const hctx = await buildContext(ctx);
  const system = buildSystem(HOOK_SYSTEM, HOOK_SYSTEM_EST_TOKENS);

  await publish(ctx.runId, {
    event: "progress",
    payload: { stage: 6, message: "Writing 3 cold-open hooks…" },
  });

  const { variants, setEqualityForced } = await generateHookVariants(system, {
    ideaText: hctx.ideaText,
    niche: hctx.niche,
    titles: hctx.titles,
    outlierPatterns: hctx.outlierPatterns,
  });

  const computed = variants.map((v) => computeVariant(v, setEqualityForced));
  // Server-simulated per-variant progress for UX parity with the mockup.
  for (let i = 0; i < computed.length; i++) {
    await publish(ctx.runId, {
      event: "progress",
      payload: {
        stage: 6,
        message: `Hook ${i + 1}/3 · ${computed[i]!.archetype} · ${computed[i]!.dropoffRiskRating} risk`,
      },
    });
    await new Promise((r) => setTimeout(r, 150));
  }
  return computed;
}

function assemble(variants: HookVariant[]): HookData {
  return {
    variants: [variants[0]!, variants[1]!, variants[2]!],
    lockedVariantIndex: null,
    allHighRisk: variants.every((v) => v.dropoffRiskRating === "high"),
    lockedAt: null,
    generatedAt: new Date().toISOString(),
    model: HOOK_MODEL,
    schemaVersion: 1,
  };
}

export async function hookStageHandler(ctx: StageContext): Promise<Json> {
  const computed = await generateComputedVariants(ctx);
  return HookDataSchema.parse(assemble(computed)) as unknown as Json;
}

// --- Per-variant regenerate (preserves the other two) ---

export async function regenerateHookVariant(args: {
  runId: string;
  userId: string;
  run: Database["public"]["Tables"]["pipeline_runs"]["Row"];
  variantIndex: 0 | 1 | 2;
}): Promise<HookData> {
  const existing = await readHookData({
    runId: args.runId,
    userId: args.userId,
  });
  if (!existing) throw new MissingHookPrereqError("no hooks to regenerate");

  const computed = await generateComputedVariants({
    runId: args.runId,
    userId: args.userId,
    run: args.run,
  });

  const targetLinked = existing.variants[args.variantIndex]!.linkedTitleIndex;
  const replacement =
    computed.find((v) => v.linkedTitleIndex === targetLinked) ??
    computed[args.variantIndex]!;

  const variants = existing.variants.map((v, i) =>
    i === args.variantIndex
      ? { ...replacement, linkedTitleIndex: targetLinked }
      : v,
  ) as [HookVariant, HookVariant, HookVariant];

  // Regenerating the locked variant clears the lock (content changed).
  const lockedVariantIndex =
    existing.lockedVariantIndex === args.variantIndex
      ? null
      : existing.lockedVariantIndex;

  const next: HookData = {
    ...existing,
    variants,
    lockedVariantIndex,
    lockedAt: lockedVariantIndex === null ? null : existing.lockedAt,
    allHighRisk: variants.every((v) => v.dropoffRiskRating === "high"),
  };
  await writeHookData({ runId: args.runId, userId: args.userId }, next);
  return next;
}

// --- Lock / unlock (no LLM call) ---

export async function lockHook(args: {
  runId: string;
  userId: string;
  variantIndex: 0 | 1 | 2;
}): Promise<HookData> {
  const existing = await readHookData({
    runId: args.runId,
    userId: args.userId,
  });
  if (!existing) throw new MissingHookPrereqError("no hooks to lock");
  const next: HookData = {
    ...existing,
    lockedVariantIndex: args.variantIndex,
    lockedAt: new Date().toISOString(),
  };
  await writeHookData({ runId: args.runId, userId: args.userId }, next);
  return next;
}

export async function unlockHook(args: {
  runId: string;
  userId: string;
}): Promise<HookData> {
  const existing = await readHookData({
    runId: args.runId,
    userId: args.userId,
  });
  if (!existing) throw new MissingHookPrereqError("no hooks to unlock");
  const next: HookData = {
    ...existing,
    lockedVariantIndex: null,
    lockedAt: null,
  };
  await writeHookData({ runId: args.runId, userId: args.userId }, next);
  return next;
}

registerStageHandler("hook", hookStageHandler);
