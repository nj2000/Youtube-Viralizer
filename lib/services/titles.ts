import "server-only";

import { buildSystem } from "@/lib/anthropic";
import type { Database, Json } from "@/lib/db/types";
import { readTitlesData, writeTitlesData } from "@/lib/db/titles";
import {
  TITLES_SYSTEM,
  TITLES_SYSTEM_EST_TOKENS,
  type TitlePromptInput,
} from "@/lib/prompts/titles";
import { CompetitorDataSchema } from "@/lib/validation/competitor";
import { ScoreDataSchema } from "@/lib/validation/score";
import { TopVideosSchema } from "@/lib/validation/channels";
import {
  TITLES_MODEL,
  TRIGGER_ORDER,
  TitlesDataSchema,
  VOICE_FALLBACK_MIN_SAMPLES,
  VOICE_SAMPLE_COUNT,
  type TitleTrigger,
  type TitleVariant,
  type TitlesData,
} from "@/lib/validation/titles";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { publish } from "@/lib/services/pipeline-bus";
import {
  registerStageHandler,
  type StageContext,
} from "@/lib/services/pipeline-stages";
import {
  generateIntentRewrites,
  generateOneTitle,
  isTooSimilar,
  type RawTitle,
} from "./titles-llm";

type ChannelRow = Database["public"]["Tables"]["channels"]["Row"];

export class MissingTitlePrereqError extends Error {
  constructor(reason: string) {
    super(`titles prerequisites not met: ${reason}`);
    this.name = "MissingTitlePrereqError";
  }
}

type TitleContext = {
  niche: string;
  scoreReasoning: string;
  outlierPatterns: string[];
  voiceSamples: string[];
  voiceFallback: boolean;
  ideaText: string;
};

async function loadChannel(channelId: string): Promise<ChannelRow> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("channels")
    .select("*")
    .eq("id", channelId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new MissingTitlePrereqError("channel not found");
  return data;
}

function extractVoiceSamples(topVideosJson: unknown): string[] {
  const parsed = TopVideosSchema.safeParse(topVideosJson);
  if (!parsed.success) return [];
  return [...parsed.data]
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    )
    .slice(0, VOICE_SAMPLE_COUNT)
    .map((v) => v.title)
    .filter((t) => t.length > 0);
}

// Build the shared LLM context from the run + channel. Throws
// MissingTitlePrereqError before any token spend when the gate hasn't passed
// (or been overridden) — task.md verification.
async function buildContext(
  ctx: StageContext,
): Promise<{ channel: ChannelRow; tctx: TitleContext; patterns: string[] }> {
  const channel = await loadChannel(ctx.run.channel_id);

  if (ctx.run.competitor_data === null) {
    throw new MissingTitlePrereqError("competitor_data missing");
  }
  const score = ScoreDataSchema.safeParse(ctx.run.score_data);
  const gateOverridden = ctx.run.gate_overridden_at !== null;
  if (!score.success) throw new MissingTitlePrereqError("score_data missing");
  if (!score.data.passed && !gateOverridden) {
    throw new MissingTitlePrereqError("score gate not passed");
  }

  const competitor = CompetitorDataSchema.safeParse(ctx.run.competitor_data);
  const patterns = competitor.success
    ? competitor.data.extractedPatterns.map((p) => p.pattern)
    : [];

  const voiceSamples = extractVoiceSamples(channel.top_videos_json);
  const voiceFallback = voiceSamples.length < VOICE_FALLBACK_MIN_SAMPLES;

  return {
    channel,
    patterns,
    tctx: {
      niche: channel.niche ?? "",
      scoreReasoning: score.data.reasoning,
      outlierPatterns: patterns,
      voiceSamples: voiceFallback ? [] : voiceSamples,
      voiceFallback,
      ideaText: ctx.run.idea_text,
    },
  };
}

function promptInputFor(
  trigger: TitleTrigger,
  tctx: TitleContext,
  opts: { diversityRetry?: boolean } = {},
): TitlePromptInput {
  return {
    trigger,
    ideaText: tctx.ideaText,
    niche: tctx.niche,
    scoreReasoning: tctx.scoreReasoning,
    outlierPatterns: tctx.outlierPatterns,
    voiceSamples: tctx.voiceSamples,
    diversityRetry: opts.diversityRetry,
  };
}

function toVariant(
  trigger: TitleTrigger,
  raw: RawTitle,
  nowIso: string,
): TitleVariant {
  return {
    trigger,
    text: raw.text,
    charCount: raw.text.length,
    predictedCtrLift: raw.predictedCtrLift,
    audienceCluster: raw.audienceCluster,
    voiceMatch: raw.voiceMatch,
    reasoning: raw.reasoning,
    vocabRefs: [],
    truncated: raw.truncated,
    originalLength: raw.originalLength,
    lockedIn: false,
    userEdited: false,
    generatedAt: nowIso,
  };
}

export async function titlesStageHandler(ctx: StageContext): Promise<Json> {
  const { tctx, patterns } = await buildContext(ctx);
  // Build the system block once — calls 2/3/4 reuse identical bytes for the
  // ephemeral cache hit (CRIT-3).
  const system = buildSystem(TITLES_SYSTEM, TITLES_SYSTEM_EST_TOKENS);

  async function generateAll(diversityRetry: boolean): Promise<RawTitle[]> {
    const out: RawTitle[] = [];
    for (const trigger of TRIGGER_ORDER) {
      await publish(ctx.runId, {
        event: "progress",
        payload: { stage: 5, message: `Writing ${trigger} title…` },
      });
      out.push(
        await generateOneTitle(
          system,
          promptInputFor(trigger, tctx, { diversityRetry }),
          tctx.voiceFallback,
        ),
      );
    }
    return out;
  }

  let raws = await generateAll(false);
  let diversityWarning = false;
  if (isTooSimilar(raws.map((r) => r.text))) {
    await publish(ctx.runId, {
      event: "progress",
      payload: { stage: 5, message: "Titles too similar — regenerating for diversity" },
    });
    raws = await generateAll(true);
    diversityWarning = isTooSimilar(raws.map((r) => r.text));
  }

  await publish(ctx.runId, {
    event: "progress",
    payload: { stage: 5, message: "Generating intent rewrites…" },
  });
  const intentRewrites = await generateIntentRewrites(system, {
    ideaText: tctx.ideaText,
    niche: tctx.niche,
    titles: raws.map((r) => r.text),
  });

  const nowIso = new Date().toISOString();
  const variants = TRIGGER_ORDER.map((t, i) => toVariant(t, raws[i]!, nowIso));

  const payload: TitlesData = {
    curiosity: variants[0]!,
    fear: variants[1]!,
    result: variants[2]!,
    intentRewrites,
    chosenIndex: null,
    flags: {
      diversityWarning,
      voiceFallback: tctx.voiceFallback,
      partialReturn: false,
      truncationOccurred: raws.some((r) => r.truncated),
      regenerationCount: 0,
    },
    meta: { model: TITLES_MODEL, competitorPatternsUsed: patterns.slice(0, 20) },
    generatedAt: nowIso,
    updatedAt: nowIso,
    schemaVersion: 1,
  };
  return TitlesDataSchema.parse(payload) as unknown as Json;
}

// --- Single-trigger regenerate (preserves the other two byte-for-byte) ---

export async function regenerateTrigger(args: {
  runId: string;
  userId: string;
  run: Database["public"]["Tables"]["pipeline_runs"]["Row"];
  trigger: TitleTrigger;
}): Promise<TitlesData> {
  const existing = await readTitlesData({
    runId: args.runId,
    userId: args.userId,
  });
  if (!existing) throw new MissingTitlePrereqError("no titles to regenerate");

  const { tctx } = await buildContext({
    runId: args.runId,
    userId: args.userId,
    run: args.run,
  });
  const system = buildSystem(TITLES_SYSTEM, TITLES_SYSTEM_EST_TOKENS);

  const prev = existing[args.trigger];
  const raw = await generateOneTitle(
    system,
    { ...promptInputFor(args.trigger, tctx), previousText: prev?.text ?? null },
    tctx.voiceFallback,
  );

  const nowIso = new Date().toISOString();
  const next: TitlesData = {
    ...existing,
    [args.trigger]: toVariant(args.trigger, raw, nowIso),
    flags: {
      ...existing.flags,
      regenerationCount: existing.flags.regenerationCount + 1,
      truncationOccurred: existing.flags.truncationOccurred || raw.truncated,
    },
    updatedAt: nowIso,
  };
  await writeTitlesData({ runId: args.runId, userId: args.userId }, next);
  return next;
}

registerStageHandler("titles", titlesStageHandler);
