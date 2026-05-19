import "server-only";

import type { Database, Json } from "@/lib/db/types";
import {
  CompetitorDataSchema,
  type CompetitorData,
  type CompetitorSkipped,
} from "@/lib/validation/competitor";
import { CompetitorSetSchema, type Competitor } from "@/lib/validation/channels";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { publish } from "@/lib/services/pipeline-bus";
import { assertHeadroom, getUsageToday } from "@/lib/youtube/quota";
import {
  registerStageHandler,
  type StageContext,
} from "@/lib/services/pipeline-stages";
import type { CompetitorPromptOutlier } from "@/lib/prompts/competitor";

import { extractDeltas, mergeDeltas } from "./competitor-delta";
import {
  fetchOutliersForCompetitor,
  type RawOutlier,
} from "./competitor-fetch";

type ChannelRow = Database["public"]["Tables"]["channels"]["Row"];

const TOP_LIMIT = 15;
const DIVERSITY_CAP = 5;
const MAX_COMPETITORS = 8;
const WEAK_SIGNAL_THRESHOLD = 3;
// Spec §5.1 worst-case math: 100 (search) + 1 (videos.list) per competitor.
const PER_COMPETITOR_UNITS = 101;

export class NoCompetitorsError extends Error {
  constructor() {
    super("Channel has no competitors configured");
    this.name = "NoCompetitorsError";
  }
}

export class StaleCacheForReExtractError extends Error {
  constructor() {
    super("Re-extract requested but no prior competitor_data exists");
    this.name = "StaleCacheForReExtractError";
  }
}

export type RunCompetitorStageInput = {
  ctx: StageContext;
  forceFresh?: boolean;
  reExtractOnly?: boolean;
};

function publishedAfter30DaysISO(): string {
  // UTC midnight so cache keys are stable within a day across callers.
  const d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function hoursSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - t) / (1000 * 60 * 60));
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
  if (!data) throw new NoCompetitorsError();
  return data;
}

function dedupeCompetitors(
  competitors: Competitor[],
  excludeChannelId: string | null,
): Competitor[] {
  const seen = new Set<string>();
  const out: Competitor[] = [];
  for (const c of competitors) {
    if (c.youtubeChannelId === excludeChannelId) continue;
    if (seen.has(c.youtubeChannelId)) continue;
    seen.add(c.youtubeChannelId);
    out.push(c);
    if (out.length >= MAX_COMPETITORS) break;
  }
  return out;
}

function rankOutliers(all: RawOutlier[]): RawOutlier[] {
  return [...all].sort((a, b) => {
    if (a.isLivestreamVod !== b.isLivestreamVod) {
      return a.isLivestreamVod ? 1 : -1;
    }
    return b.viewMultiple - a.viewMultiple;
  });
}

function applyDiversityCap(ranked: RawOutlier[]): RawOutlier[] {
  const perChannel = new Map<string, number>();
  const out: RawOutlier[] = [];
  for (const o of ranked) {
    const seen = perChannel.get(o.channelId) ?? 0;
    if (seen >= DIVERSITY_CAP) continue;
    perChannel.set(o.channelId, seen + 1);
    out.push(o);
  }
  return out;
}

function toPromptOutlier(o: RawOutlier): CompetitorPromptOutlier {
  return {
    videoId: o.videoId,
    title: o.title,
    channelTitle: o.channelTitle,
    channelHandle: o.channelHandle,
    channelMedianViews: o.channelMedianViews,
    viewCount: o.viewCount,
    viewMultiple: o.viewMultiple,
    durationSec: o.durationSec,
    publishedDaysAgo: Math.round(hoursSince(o.publishedAt) / 24),
    isShort: o.isShort,
    isLivestreamVod: o.isLivestreamVod,
    channelBaselineTitles: o._baselineTitles,
  };
}

type AggregatedTop = {
  top: RawOutlier[];
  weakSignal: boolean;
  singleCreatorDominance: boolean;
};

function aggregateTop(
  allOutliers: RawOutlier[],
  activeCompetitorsContributing: number,
): AggregatedTop {
  const ranked = rankOutliers(allOutliers);
  const diverse = applyDiversityCap(ranked);
  const top = diverse.slice(0, TOP_LIMIT);

  const perChannel = new Map<string, number>();
  for (const o of top) {
    perChannel.set(o.channelId, (perChannel.get(o.channelId) ?? 0) + 1);
  }
  const topChannelCount =
    perChannel.size === 0 ? 0 : Math.max(...Array.from(perChannel.values()));
  return {
    top,
    weakSignal: activeCompetitorsContributing < WEAK_SIGNAL_THRESHOLD,
    singleCreatorDominance: topChannelCount >= 5 && top.length >= 6,
  };
}

export async function runCompetitorStage(
  args: RunCompetitorStageInput,
): Promise<Json> {
  const { ctx } = args;
  const channel = await loadChannel(ctx.run.channel_id);
  const parsedSet = CompetitorSetSchema.safeParse(channel.competitor_set_json);
  if (!parsedSet.success || parsedSet.data.length === 0) {
    throw new NoCompetitorsError();
  }
  const competitors = dedupeCompetitors(
    parsedSet.data,
    channel.youtube_channel_id,
  );
  if (competitors.length === 0) throw new NoCompetitorsError();

  // TODO(phase-2): support re-extract with a cache-warmth threshold.
  if (args.reExtractOnly) {
    const parsedPrior = CompetitorDataSchema.safeParse(ctx.run.competitor_data);
    if (!parsedPrior.success || parsedPrior.data.outliers.length === 0) {
      throw new StaleCacheForReExtractError();
    }
    await publish(ctx.runId, {
      event: "progress",
      payload: { stage: 3, message: "Re-extracting deltas (Opus, cache warm)" },
    });
    return await reExtractFromPrior(channel, parsedPrior.data);
  }

  const publishedAfter = publishedAfter30DaysISO();
  const unitsBefore = await getUsageToday();

  await publish(ctx.runId, {
    event: "progress",
    payload: {
      stage: 3,
      message: `Scanning ${competitors.length} competitor channels`,
    },
  });

  const allOutliers: RawOutlier[] = [];
  const skipped: CompetitorSkipped[] = [];
  const fallback90DayUsedFor: string[] = [];
  let videosEvaluated = 0;
  let highestMultipleSeen: number | null = null;
  let activeCompetitorsContributing = 0;

  for (let i = 0; i < competitors.length; i++) {
    const competitor = competitors[i]!;
    // Soft-cap check BEFORE each per-competitor search.list call (spec §5.1).
    await assertHeadroom(PER_COMPETITOR_UNITS);

    await publish(ctx.runId, {
      event: "progress",
      payload: {
        stage: 3,
        message: `Computing baselines · ${i + 1}/${competitors.length} · ${competitor.title}`,
      },
    });

    const result = await fetchOutliersForCompetitor({
      competitor,
      publishedAfter,
    });
    if (result.skipped) {
      skipped.push(result.skipped);
      continue;
    }
    if (result.fallback90Day) {
      fallback90DayUsedFor.push(competitor.youtubeChannelId);
    }
    videosEvaluated += result.videosEvaluated;
    if (result.outliers.length > 0) activeCompetitorsContributing++;
    for (const o of result.outliers) {
      allOutliers.push(o);
      if (highestMultipleSeen === null || o.viewMultiple > highestMultipleSeen) {
        highestMultipleSeen = o.viewMultiple;
      }
    }
  }

  await publish(ctx.runId, {
    event: "progress",
    payload: {
      stage: 3,
      message: `Finding outliers · ${allOutliers.length} candidates so far`,
    },
  });

  const { top, weakSignal, singleCreatorDominance } = aggregateTop(
    allOutliers,
    activeCompetitorsContributing,
  );

  const cachedAt = new Date().toISOString();

  if (top.length === 0) {
    const unitsAfter = await getUsageToday();
    const empty: CompetitorData = {
      outliers: [],
      extractedPatterns: [],
      diagnostics: {
        competitorsScanned: competitors.length,
        competitorsSkipped: skipped,
        videosEvaluated,
        highestMultipleSeen,
        weakSignal,
        singleCreatorDominance: false,
        fallback90DayUsedFor,
        youtubeQuotaUnitsSpent: Math.max(0, unitsAfter - unitsBefore),
      },
      noOutliers: true,
      cachedAt,
      generatedAt: cachedAt,
      schemaVersion: 1,
    };
    return CompetitorDataSchema.parse(empty) as unknown as Json;
  }

  await publish(ctx.runId, {
    event: "progress",
    payload: {
      stage: 3,
      message: `Extracting deltas via Opus 4.7 · ${top.length} outliers`,
    },
  });

  const llm = await extractDeltas({
    userChannelTitle: channel.title ?? "",
    userNiche: channel.niche ?? "",
    outliers: top.map(toPromptOutlier),
  });

  const { outliers, patterns } = mergeDeltas(top, llm);

  const unitsAfter = await getUsageToday();
  const payload: CompetitorData = {
    outliers,
    extractedPatterns: patterns,
    diagnostics: {
      competitorsScanned: competitors.length,
      competitorsSkipped: skipped,
      videosEvaluated,
      highestMultipleSeen,
      weakSignal,
      singleCreatorDominance,
      fallback90DayUsedFor,
      youtubeQuotaUnitsSpent: Math.max(0, unitsAfter - unitsBefore),
    },
    noOutliers: false,
    cachedAt,
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
  };

  return CompetitorDataSchema.parse(payload) as unknown as Json;
}

async function reExtractFromPrior(
  channel: ChannelRow,
  prior: CompetitorData,
): Promise<Json> {
  // Re-LLM only — reuse the prior outliers' YouTube facts, blank deltas,
  // re-extract. Costs ~$0.10 Opus, 0 YouTube units.
  const rawForMerge: RawOutlier[] = prior.outliers.map((o) => ({
    ...o,
    _baselineTitles: [],
  }));

  const llm = await extractDeltas({
    userChannelTitle: channel.title ?? "",
    userNiche: channel.niche ?? "",
    outliers: rawForMerge.map(toPromptOutlier).map((p) => ({
      ...p,
      // Prior baseline titles aren't persisted; an empty array lets the model
      // lean on the outlier title alone (deltaStatus: "partial" fallback).
      channelBaselineTitles: [],
    })),
  });

  const { outliers, patterns } = mergeDeltas(rawForMerge, llm);

  const payload: CompetitorData = {
    ...prior,
    outliers,
    extractedPatterns: patterns,
    generatedAt: new Date().toISOString(),
  };
  return CompetitorDataSchema.parse(payload) as unknown as Json;
}

// Register the stage handler so the orchestrator (runFullPipeline, runFromStage,
// rerun-from) picks it up. The per-stage POST route calls runCompetitorStage
// directly so it can forward forceFresh/reExtractOnly that the registered
// handler doesn't expose.
registerStageHandler("competitor", async (ctx) =>
  runCompetitorStage({ ctx }),
);
