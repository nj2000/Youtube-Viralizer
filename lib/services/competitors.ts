import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import {
  callSonnet,
  extractTextFromMessage,
} from "@/lib/anthropic/onboarding";
import {
  getCachedPayload,
  setCachedPayload,
} from "@/lib/db/youtube-cache";
import {
  ONBOARD_COMPETITOR_QUERIES_SYSTEM,
  ONBOARD_COMPETITOR_QUERIES_SYSTEM_EST_TOKENS,
  ONBOARD_COMPETITOR_RANK_SYSTEM,
  ONBOARD_COMPETITOR_RANK_SYSTEM_EST_TOKENS,
  buildOnboardCompetitorQueriesUserPrompt,
  buildOnboardCompetitorRankUserPrompt,
} from "@/lib/prompts/onboard-competitors";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  CompetitorSchema,
  type Competitor,
} from "@/lib/validation/channels";
import { hydrateCompetitorMetadata } from "@/lib/youtube/onboard";
import { searchVideos } from "@/lib/youtube/cached";

const COMPETITOR_CACHE_TTL_SECONDS = 6 * 60 * 60;
const COMPETITOR_THRESHOLD = 3;
const MAX_COMPETITORS = 8;
const SEARCH_RESULTS_PER_QUERY = 10;

export type IdentifyCompetitorsInput = {
  niche: string;
  country: string | null;
  ownChannelId: string | null;
};

export type IdentifyCompetitorsResult = {
  competitors: Competitor[];
  belowThreshold: boolean;
};

const CompetitorsCacheSchema = z.object({
  competitors: z.array(CompetitorSchema),
  belowThreshold: z.boolean(),
});

function competitorsCacheKey(niche: string, country: string | null): string {
  const hash = createHash("sha256")
    .update(`${niche.trim().toLowerCase()}|${country ?? ""}`)
    .digest("hex");
  return `competitors:v1:${hash}`;
}

const RankResponseSchema = z.object({
  ranked_channel_ids: z.array(z.string().regex(/^UC[\w-]{22}$/)).max(20),
});

async function generateSearchQueries(
  niche: string,
  country: string | null,
): Promise<string[]> {
  const message = await callSonnet({
    system: ONBOARD_COMPETITOR_QUERIES_SYSTEM,
    estSystemTokens: ONBOARD_COMPETITOR_QUERIES_SYSTEM_EST_TOKENS,
    messages: [
      {
        role: "user",
        content: buildOnboardCompetitorQueriesUserPrompt({ niche, country }),
      },
    ],
    maxTokens: 200,
  });

  return extractTextFromMessage(message)
    .split("\n")
    .map((q) => q.trim().replace(/^[-*\d.)\s]+/, ""))
    .filter((q) => q.length > 0 && q.length < 200)
    .slice(0, 5);
}

async function rankCandidates(
  niche: string,
  ownChannelId: string | null,
  candidates: Array<{
    youtubeChannelId: string;
    title: string;
    handle: string | null;
    description: string;
    subscriberCount: number | null;
    medianViews: number | null;
  }>,
): Promise<string[]> {
  if (candidates.length === 0) return [];

  const message = await callSonnet({
    system: ONBOARD_COMPETITOR_RANK_SYSTEM,
    estSystemTokens: ONBOARD_COMPETITOR_RANK_SYSTEM_EST_TOKENS,
    messages: [
      {
        role: "user",
        content: buildOnboardCompetitorRankUserPrompt({
          niche,
          ownChannelId,
          candidates,
        }),
      },
    ],
    maxTokens: 400,
  });

  const raw = extractTextFromMessage(message);
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];

  try {
    const parsed = RankResponseSchema.parse(JSON.parse(jsonMatch[0]));
    return parsed.ranked_channel_ids.slice(0, MAX_COMPETITORS);
  } catch {
    return [];
  }
}

export async function identifyCompetitors(
  input: IdentifyCompetitorsInput,
): Promise<IdentifyCompetitorsResult> {
  if (input.niche.trim().length === 0) {
    return { competitors: [], belowThreshold: true };
  }

  const supabase = createSupabaseServiceClient();
  const cacheKey = competitorsCacheKey(input.niche, input.country);

  const cached = await getCachedPayload(supabase, cacheKey);
  if (cached !== null) {
    const parsed = CompetitorsCacheSchema.safeParse(cached);
    if (parsed.success) return parsed.data;
  }

  const queries = await generateSearchQueries(input.niche, input.country);
  if (queries.length === 0) {
    const result = { competitors: [], belowThreshold: true };
    await setCachedPayload(supabase, cacheKey, result, COMPETITOR_CACHE_TTL_SECONDS);
    return result;
  }

  const seen = new Set<string>();
  if (input.ownChannelId) seen.add(input.ownChannelId);

  for (const query of queries) {
    const search = await searchVideos({
      q: query,
      maxResults: SEARCH_RESULTS_PER_QUERY,
      regionCode: input.country ?? undefined,
      order: "viewCount",
    });
    for (const item of search.items ?? []) {
      const channelId = item.snippet?.channelId;
      if (channelId && /^UC[\w-]{22}$/.test(channelId)) seen.add(channelId);
    }
    if (seen.size >= 50 + (input.ownChannelId ? 1 : 0)) break;
  }

  const candidateIds = Array.from(seen).filter(
    (id) => id !== input.ownChannelId,
  );

  if (candidateIds.length === 0) {
    const result = { competitors: [], belowThreshold: true };
    await setCachedPayload(supabase, cacheKey, result, COMPETITOR_CACHE_TTL_SECONDS);
    return result;
  }

  const hydrated = await hydrateCompetitorMetadata(candidateIds);

  // Median for the rank input stays null — Phase 2 stage 3 will hydrate
  // candidates' medians on demand from the cached uploads-playlist data.
  const candidatesForRank = hydrated.map((c) => ({
    youtubeChannelId: c.youtubeChannelId,
    title: c.title,
    handle: c.handle,
    description: c.description,
    subscriberCount: c.subscriberCount,
    medianViews: null,
  }));

  const ranked = await rankCandidates(
    input.niche,
    input.ownChannelId,
    candidatesForRank,
  );

  const byId = new Map(hydrated.map((c) => [c.youtubeChannelId, c]));
  const competitors: Competitor[] = [];
  for (const channelId of ranked) {
    const meta = byId.get(channelId);
    if (!meta) continue;
    competitors.push({
      youtubeChannelId: meta.youtubeChannelId,
      handle: meta.handle,
      title: meta.title,
      subscriberCount: meta.subscriberCount,
      medianViews: null,
      source: "auto",
    });
    if (competitors.length >= MAX_COMPETITORS) break;
  }

  const result: IdentifyCompetitorsResult = {
    competitors,
    belowThreshold: competitors.length < COMPETITOR_THRESHOLD,
  };

  await setCachedPayload(
    supabase,
    cacheKey,
    result,
    COMPETITOR_CACHE_TTL_SECONDS,
  );

  return result;
}
