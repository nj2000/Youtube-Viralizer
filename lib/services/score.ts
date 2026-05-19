import "server-only";

import {
  buildSystem,
  callClaude,
  extractTextFromMessage,
  stageModel,
} from "@/lib/anthropic";
import type { Database, Json } from "@/lib/db/types";
import {
  SCORE_SYSTEM,
  SCORE_SYSTEM_EST_TOKENS,
  buildReframeFollowupPrompt,
  buildScoreUserPrompt,
  type ScorePromptInput,
} from "@/lib/prompts/score";
import {
  GATE_THRESHOLD,
  ReframeSchema,
  ScoreDataSchema,
  ScoreDimensionsSchema,
  computeFinalScore,
  type Reframe,
  type ScoreData,
  type ScoreDimensions,
} from "@/lib/validation/score";
import { CompetitorDataSchema } from "@/lib/validation/competitor";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { publish } from "@/lib/services/pipeline-bus";
import {
  registerStageHandler,
  type StageContext,
} from "@/lib/services/pipeline-stages";
import { UpstreamError } from "@/lib/youtube/errors";

type ChannelRow = Database["public"]["Tables"]["channels"]["Row"];

const LOW_CONFIDENCE_OUTLIER_THRESHOLD = 10;
const PER_DIMENSION_STAGGER_MS = 250;
const DIMENSION_ORDER: Array<keyof ScoreDimensions> = [
  "hook_strength",
  "curiosity_gap",
  "outlier_alignment",
  "niche_fit",
  "title_ability",
];

async function loadChannel(channelId: string): Promise<ChannelRow> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("channels")
    .select("*")
    .eq("id", channelId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new UpstreamError("channel not found for score stage");
  return data;
}

function safeJsonParse(text: string): unknown | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function parseDimensions(raw: unknown): ScoreDimensions | null {
  if (!raw || typeof raw !== "object") return null;
  const dims = (raw as Record<string, unknown>).dimensions;
  if (!dims) return null;
  const parsed = ScoreDimensionsSchema.safeParse(dims);
  return parsed.success ? parsed.data : null;
}

function parseReasoning(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const r = (raw as Record<string, unknown>).reasoning;
  if (typeof r !== "string") return "";
  return r.slice(0, 1800);
}

function parseReframes(raw: unknown): Reframe[] {
  if (!raw || typeof raw !== "object") return [];
  const candidate = (raw as Record<string, unknown>).reframes;
  if (!Array.isArray(candidate)) return [];
  const out: Reframe[] = [];
  for (const item of candidate.slice(0, 3)) {
    const parsed = ReframeSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

async function emitTheatricalDimensions(
  runId: string,
  dimensions: ScoreDimensions,
): Promise<void> {
  for (const dim of DIMENSION_ORDER) {
    await publish(runId, {
      event: "progress",
      payload: {
        stage: 4,
        message: `${dim.replace(/_/g, " ")}: ${dimensions[dim]}/100`,
      },
    });
    await new Promise((r) => setTimeout(r, PER_DIMENSION_STAGGER_MS));
  }
}

function buildPromptInput(
  ideaText: string,
  channel: ChannelRow,
  competitorData: unknown,
): { prompt: ScorePromptInput; outlierPatternCount: number } {
  const parsed = CompetitorDataSchema.safeParse(competitorData);
  if (!parsed.success) {
    return {
      prompt: {
        ideaText,
        niche: channel.niche ?? "",
        outlierPatterns: [],
        outliers: [],
      },
      outlierPatternCount: 0,
    };
  }
  const data = parsed.data;
  return {
    prompt: {
      ideaText,
      niche: channel.niche ?? "",
      outlierPatterns: data.extractedPatterns.map((p) => ({
        pattern: p.pattern,
        evidence: p.evidence,
        confidence: p.confidence,
        category: p.category,
      })),
      outliers: data.outliers.map((o) => ({
        title: o.title,
        channelTitle: o.channelTitle,
        viewMultiple: o.viewMultiple,
        deltaLabel: o.deltaLabel,
        triggerLabels: [...o.triggerLabels],
      })),
    },
    outlierPatternCount:
      data.extractedPatterns.length + data.outliers.length,
  };
}

export async function scoreStageHandler(ctx: StageContext): Promise<Json> {
  const channel = await loadChannel(ctx.run.channel_id);
  const { prompt, outlierPatternCount } = buildPromptInput(
    ctx.run.idea_text,
    channel,
    ctx.run.competitor_data,
  );

  await publish(ctx.runId, {
    event: "progress",
    payload: { stage: 4, message: "Scoring idea via Opus 4.7…" },
  });

  // Build the system block once so the second-pass reframe call hits the
  // ephemeral cache (CRIT-3).
  const system = buildSystem(SCORE_SYSTEM, SCORE_SYSTEM_EST_TOKENS);
  const userPrompt = buildScoreUserPrompt(prompt);

  const first = await callClaude({
    stage: "score",
    system,
    messages: [{ role: "user", content: userPrompt }],
    maxTokens: 2048,
  });
  const firstText = extractTextFromMessage(first);
  const firstParsed = safeJsonParse(firstText);
  const dimensions = parseDimensions(firstParsed);
  if (!dimensions) {
    throw new UpstreamError("score model returned no parseable dimensions");
  }

  const finalScore = computeFinalScore(dimensions);
  const passed = finalScore >= GATE_THRESHOLD;
  const reasoning =
    parseReasoning(firstParsed) ||
    "Model returned dimensions without reasoning.";

  await emitTheatricalDimensions(ctx.runId, dimensions);
  await publish(ctx.runId, {
    event: "progress",
    payload: {
      stage: 4,
      message: passed
        ? `Final score ${finalScore} · gate passed`
        : `Final score ${finalScore} · gate failed (threshold ${GATE_THRESHOLD})`,
    },
  });

  let reframes = passed ? [] : parseReframes(firstParsed);
  let reframeShortfall = false;

  if (!passed && reframes.length < 3) {
    await publish(ctx.runId, {
      event: "progress",
      payload: { stage: 4, message: "Generating reframes (Opus, cache warm)" },
    });
    try {
      const retry = await callClaude({
        stage: "score",
        system,
        messages: [
          { role: "user", content: userPrompt },
          { role: "assistant", content: firstText.slice(0, 4000) },
          {
            role: "user",
            content: buildReframeFollowupPrompt({
              finalScore,
              threshold: GATE_THRESHOLD,
            }),
          },
        ],
        maxTokens: 1024,
      });
      const retryText = extractTextFromMessage(retry);
      const retryReframes = parseReframes(safeJsonParse(retryText));
      if (retryReframes.length > reframes.length) reframes = retryReframes;
    } catch {
      // Best-effort: a reframe-call failure shouldn't blow up the gate.
    }
    if (reframes.length < 3) reframeShortfall = true;
  }

  const payload: ScoreData = {
    finalScore,
    dimensions,
    reasoning,
    passed,
    reframes: passed ? null : reframes,
    reframeShortfall,
    gateOverriddenAt: null,
    outlierPatternCount,
    lowConfidence: outlierPatternCount < LOW_CONFIDENCE_OUTLIER_THRESHOLD,
    scoredAt: new Date().toISOString(),
    model: stageModel.score,
    schemaVersion: 1,
  };

  return ScoreDataSchema.parse(payload) as unknown as Json;
}

registerStageHandler("score", scoreStageHandler);
