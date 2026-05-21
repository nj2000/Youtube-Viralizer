import "server-only";

import type { Database, Json } from "@/lib/db/types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { readSeoData, writeSeoData } from "@/lib/db/seo";
import { TopVideosSchema, type TopVideo } from "@/lib/validation/channels";
import { ScriptDataSchema, type ScriptData } from "@/lib/validation/script";
import {
  TRIGGER_ORDER,
  TitlesDataSchema,
} from "@/lib/validation/titles";
import {
  SEO_MODEL,
  SeoDataSchema,
  type SeoData,
  type SeoSection,
} from "@/lib/validation/seo";
import { publish } from "@/lib/services/pipeline-bus";
import {
  registerStageHandler,
  type StageContext,
} from "@/lib/services/pipeline-stages";
import { MissingDependencyError } from "./errors";
import { chaptersAreFallback, deriveChapters } from "./seo-chapters";
import {
  generateDescription,
  generateEndScreen,
  generateHashtags,
  generatePinned,
  generateTags,
  InvalidSeoError,
  type SeoUsage,
} from "./seo-llm";

export class MissingSeoPrereqError extends Error {
  constructor(reason: string) {
    super(`seo prerequisites not met: ${reason}`);
    this.name = "MissingSeoPrereqError";
  }
}

export function seoErrorCode(err: unknown): string {
  if (err instanceof MissingSeoPrereqError || err instanceof MissingDependencyError) {
    return "MISSING_PREREQUISITES";
  }
  return "UPSTREAM_ERROR";
}

type Base = { title: string; idea: string; niche: string };
type EndScreenCandidate = {
  videoId: string;
  title: string;
  affinityType: "most_watched" | "high_affinity";
};

function lockedTitle(run: StageContext["run"]): string | null {
  const parsed = TitlesDataSchema.safeParse(run.titles_data);
  if (!parsed.success) return null;
  for (const t of TRIGGER_ORDER) {
    const v = parsed.data[t];
    if (v && v.lockedIn) return v.text;
  }
  return null;
}

function overlapScore(a: string, b: string): number {
  const words = (s: string) =>
    new Set(s.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/).filter((w) => w.length > 3));
  const sa = words(a);
  let n = 0;
  for (const w of words(b)) if (sa.has(w)) n++;
  return n;
}

// Heuristic: top-1 by views (most_watched) + top-1 by title overlap (high_affinity).
function pickCandidates(topVideos: TopVideo[], title: string): EndScreenCandidate[] {
  if (topVideos.length === 0) return [];
  const byViews = [...topVideos].sort((a, b) => b.viewCount - a.viewCount);
  const mostWatched = byViews[0]!;
  const out: EndScreenCandidate[] = [
    { videoId: mostWatched.videoId, title: mostWatched.title, affinityType: "most_watched" },
  ];
  const rest = topVideos.filter((v) => v.videoId !== mostWatched.videoId);
  const affinity = rest
    .map((v) => ({ v, score: overlapScore(title, v.title) }))
    .sort((a, b) => b.score - a.score)[0];
  if (affinity && affinity.score > 0) {
    out.push({ videoId: affinity.v.videoId, title: affinity.v.title, affinityType: "high_affinity" });
  }
  return out;
}

async function loadChannel(channelId: string): Promise<{ niche: string; topVideos: TopVideo[] }> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("channels")
    .select("niche, top_videos_json")
    .eq("id", channelId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  const tv = TopVideosSchema.safeParse(data?.top_videos_json);
  return { niche: data?.niche ?? "", topVideos: tv.success ? tv.data : [] };
}

type SeoContext = {
  base: Base;
  script: ScriptData;
  candidates: EndScreenCandidate[];
  isSponsored: boolean;
};

async function buildContext(ctx: StageContext): Promise<SeoContext> {
  const title = lockedTitle(ctx.run);
  if (!title) throw new MissingSeoPrereqError("no locked title");
  const script = ScriptDataSchema.safeParse(ctx.run.script_data);
  if (!script.success) throw new MissingSeoPrereqError("script_data missing");
  const { niche, topVideos } = await loadChannel(ctx.run.channel_id);
  return {
    base: { title, idea: ctx.run.idea_text, niche },
    script: script.data,
    candidates: pickCandidates(topVideos, title),
    isSponsored: ctx.run.is_sponsored === true,
  };
}

const ZERO_COUNTS = {
  description: 0,
  tags: 0,
  hashtags: 0,
  chapters: 0,
  endScreen: 0,
  pinnedComment: 0,
};

export async function seoStageHandler(ctx: StageContext): Promise<Json> {
  const c = await buildContext(ctx);
  const note = (message: string) =>
    publish(ctx.runId, { event: "progress", payload: { stage: 10, message } });

  await note("Writing description…");
  const desc = await generateDescription(c.base, { isSponsored: c.isSponsored });
  await note("Generating tags & hashtags…");
  const tags = await generateTags(c.base);
  const hashtags = await generateHashtags(c.base);
  await note("Deriving chapters & end screen…");
  const chapters = deriveChapters(c.script);
  const endscreen = await generateEndScreen(c.base.title, c.candidates);
  await note("Drafting pinned comment…");
  const pinned = await generatePinned(c.base);

  const nowIso = new Date().toISOString();
  const payload: SeoData = {
    description: desc.description,
    tags: tags.tags,
    hashtags: hashtags.hashtags,
    chapters,
    endScreenSuggestions: endscreen.endScreen,
    pinnedCommentDraft: pinned.pinned,
    flags: {
      descriptionTruncated: desc.description.truncated,
      tagsTrimmed: tags.trimmed,
      tagsTrimmedList: tags.trimmedList,
      chaptersFallback: chaptersAreFallback(chapters),
      sponsoredDisclosure: desc.flags.sponsoredDisclosure,
      complianceDisclaimer: desc.flags.complianceDisclaimer,
      endScreenSubscribeOnly: endscreen.subscribeOnly,
    },
    regenerationCounts: { ...ZERO_COUNTS },
    model: SEO_MODEL,
    generatedAt: nowIso,
    updatedAt: nowIso,
    schemaVersion: 1,
  };
  return SeoDataSchema.parse(payload) as unknown as Json;
}

// --- Per-section regenerate (preserves the other sections) ---

export async function regenerateSeoSection(args: {
  runId: string;
  userId: string;
  run: Database["public"]["Tables"]["pipeline_runs"]["Row"];
  section: SeoSection;
}): Promise<SeoData> {
  const existing = await readSeoData({ runId: args.runId, userId: args.userId });
  if (!existing) throw new MissingSeoPrereqError("no seo data to regenerate");
  const c = await buildContext({ runId: args.runId, userId: args.userId, run: args.run });

  const next: SeoData = {
    ...existing,
    flags: { ...existing.flags },
    regenerationCounts: {
      ...existing.regenerationCounts,
      [args.section]: existing.regenerationCounts[args.section] + 1,
    },
    updatedAt: new Date().toISOString(),
  };

  switch (args.section) {
    case "description": {
      const r = await generateDescription(c.base, { isSponsored: c.isSponsored });
      next.description = r.description;
      next.flags.descriptionTruncated = r.description.truncated;
      next.flags.sponsoredDisclosure = r.flags.sponsoredDisclosure;
      next.flags.complianceDisclaimer = r.flags.complianceDisclaimer;
      break;
    }
    case "tags": {
      const r = await generateTags(c.base, { avoid: existing.tags });
      next.tags = r.tags;
      next.flags.tagsTrimmed = r.trimmed;
      next.flags.tagsTrimmedList = r.trimmedList;
      break;
    }
    case "hashtags":
      next.hashtags = (await generateHashtags(c.base)).hashtags;
      break;
    case "chapters": {
      next.chapters = deriveChapters(c.script);
      next.flags.chaptersFallback = chaptersAreFallback(next.chapters);
      break;
    }
    case "endScreen": {
      const r = await generateEndScreen(c.base.title, c.candidates);
      next.endScreenSuggestions = r.endScreen;
      next.flags.endScreenSubscribeOnly = r.subscribeOnly;
      break;
    }
    case "pinnedComment":
      next.pinnedCommentDraft = (await generatePinned(c.base)).pinned;
      break;
  }

  const validated = SeoDataSchema.parse(next);
  await writeSeoData({ runId: args.runId, userId: args.userId }, validated);
  return validated;
}

export { InvalidSeoError };
export type { SeoUsage };

registerStageHandler("seo", seoStageHandler);
