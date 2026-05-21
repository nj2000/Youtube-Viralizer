import "server-only";

import { buildSystem } from "@/lib/anthropic";
import type { Database, Json } from "@/lib/db/types";
import { readThumbnailsData, writeThumbnailsData } from "@/lib/db/thumbnails";
import {
  THUMBNAILS_SYSTEM,
  THUMBNAILS_SYSTEM_EST_TOKENS,
} from "@/lib/prompts/thumbnails";
import {
  TRIGGER_ORDER,
  TitlesDataSchema,
  type TitleTrigger,
  type TitlesData,
} from "@/lib/validation/titles";
import {
  THUMBNAILS_MODEL,
  ThumbnailsDataSchema,
  briefsOf,
  type ThumbnailBrief,
  type ThumbnailsData,
} from "@/lib/validation/thumbnails";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { publish } from "@/lib/services/pipeline-bus";
import {
  registerStageHandler,
  type StageContext,
} from "@/lib/services/pipeline-stages";
import { anyBriefsCollide } from "./thumbnails-palette";
import { generateOneBrief, InvalidThumbnailError } from "./thumbnails-llm";

export class MissingThumbnailPrereqError extends Error {
  constructor(reason: string) {
    super(`thumbnail prerequisites not met: ${reason}`);
    this.name = "MissingThumbnailPrereqError";
  }
}

type LockedTitle = { trigger: TitleTrigger; title: string; audienceCluster: string };

async function loadNiche(channelId: string): Promise<string> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("channels")
    .select("niche")
    .eq("id", channelId)
    .is("deleted_at", null)
    .maybeSingle<{ niche: string | null }>();
  if (error) throw error;
  return data?.niche ?? "";
}

function lockedTitlesOf(titles: TitlesData): LockedTitle[] {
  const out: LockedTitle[] = [];
  for (const trigger of TRIGGER_ORDER) {
    const v = titles[trigger];
    if (v && v.lockedIn) {
      out.push({ trigger, title: v.text, audienceCluster: v.audienceCluster });
    }
  }
  return out;
}

async function buildContext(
  ctx: StageContext,
): Promise<{ niche: string; ideaText: string; locked: LockedTitle[] }> {
  const titles = TitlesDataSchema.safeParse(ctx.run.titles_data);
  if (!titles.success) throw new MissingThumbnailPrereqError("titles_data missing");
  const locked = lockedTitlesOf(titles.data);
  if (locked.length === 0) {
    throw new MissingThumbnailPrereqError("no locked title");
  }
  return {
    niche: await loadNiche(ctx.run.channel_id),
    ideaText: ctx.run.idea_text,
    locked,
  };
}

function emptySnapshot() {
  return { curiosity: null, fear: null, result: null } as Record<
    TitleTrigger,
    string | null
  >;
}

export async function thumbnailsStageHandler(ctx: StageContext): Promise<Json> {
  const startedAt = Date.now();
  const { niche, ideaText, locked } = await buildContext(ctx);
  const system = buildSystem(THUMBNAILS_SYSTEM, THUMBNAILS_SYSTEM_EST_TOKENS);

  const briefs: Record<TitleTrigger, ThumbnailBrief | null> = {
    curiosity: null,
    fear: null,
    result: null,
  };
  const snapshot = emptySnapshot();
  let truncationOccurred = false;
  let paletteContrastFail = false;
  let partialReturn = false;
  let typeDrivenCount = 0;
  const tokens = { input: 0, output: 0, cached: 0, cacheHit: false };

  for (const lt of locked) {
    snapshot[lt.trigger] = lt.title;
    await publish(ctx.runId, {
      event: "progress",
      payload: { stage: 9, message: `Designing ${lt.trigger} thumbnail concept…` },
    });
    try {
      const r = await generateOneBrief(system, {
        trigger: lt.trigger,
        title: lt.title,
        ideaText,
        niche,
        audienceCluster: lt.audienceCluster,
        avoidComposition: null,
      });
      briefs[lt.trigger] = r.brief;
      truncationOccurred ||= r.truncated;
      paletteContrastFail ||= !r.contrastPassed;
      if (r.typeDriven) typeDrivenCount++;
      tokens.input += r.usage.inputTokens;
      tokens.output += r.usage.outputTokens;
      tokens.cached += r.usage.cachedInputTokens;
      tokens.cacheHit ||= r.usage.cacheHit;
    } catch (err) {
      if (err instanceof InvalidThumbnailError) {
        partialReturn = true;
        continue;
      }
      throw err;
    }
  }

  const nowIso = new Date().toISOString();
  const payload: ThumbnailsData = {
    curiosity: briefs.curiosity,
    fear: briefs.fear,
    result: briefs.result,
    flags: {
      diversityWarning: anyBriefsCollide(briefsOfRecord(briefs)),
      typeDrivenFallback: typeDrivenCount >= 2,
      paletteContrastFail,
      partialReturn,
      truncationOccurred,
      regenerationCount: 0,
    },
    meta: {
      model: THUMBNAILS_MODEL,
      cacheHit: tokens.cacheHit,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      cachedInputTokens: tokens.cached,
      elapsedMs: Date.now() - startedAt,
      titleSnapshot: snapshot,
    },
    generatedAt: nowIso,
    updatedAt: nowIso,
    schemaVersion: 1,
  };
  return ThumbnailsDataSchema.parse(payload) as unknown as Json;
}

function briefsOfRecord(
  briefs: Record<TitleTrigger, ThumbnailBrief | null>,
): ThumbnailBrief[] {
  return [briefs.curiosity, briefs.fear, briefs.result].filter(
    (b): b is ThumbnailBrief => b !== null,
  );
}

// --- Single-trigger regenerate (preserves the other two byte-for-byte) ---

export async function regenerateThumbnailTrigger(args: {
  runId: string;
  userId: string;
  run: Database["public"]["Tables"]["pipeline_runs"]["Row"];
  trigger: TitleTrigger;
}): Promise<ThumbnailsData> {
  const existing = await readThumbnailsData({
    runId: args.runId,
    userId: args.userId,
  });
  if (!existing) throw new MissingThumbnailPrereqError("no thumbnails to regenerate");

  const { niche, ideaText, locked } = await buildContext({
    runId: args.runId,
    userId: args.userId,
    run: args.run,
  });
  const lt = locked.find((l) => l.trigger === args.trigger);
  if (!lt) throw new MissingThumbnailPrereqError(`${args.trigger} title not locked`);

  const system = buildSystem(THUMBNAILS_SYSTEM, THUMBNAILS_SYSTEM_EST_TOKENS);
  const r = await generateOneBrief(system, {
    trigger: lt.trigger,
    title: lt.title,
    ideaText,
    niche,
    audienceCluster: lt.audienceCluster,
    avoidComposition: existing[args.trigger]?.composition ?? null,
  });

  const nowIso = new Date().toISOString();
  const next: ThumbnailsData = {
    ...existing,
    [args.trigger]: r.brief,
    flags: {
      ...existing.flags,
      regenerationCount: existing.flags.regenerationCount + 1,
      truncationOccurred: existing.flags.truncationOccurred || r.truncated,
      paletteContrastFail: existing.flags.paletteContrastFail || !r.contrastPassed,
    },
    meta: {
      ...existing.meta,
      titleSnapshot: { ...existing.meta.titleSnapshot, [args.trigger]: lt.title },
    },
    updatedAt: nowIso,
  };
  next.flags.diversityWarning = anyBriefsCollide(briefsOf(next));
  await writeThumbnailsData({ runId: args.runId, userId: args.userId }, next);
  return next;
}

registerStageHandler("thumbnails", thumbnailsStageHandler);
