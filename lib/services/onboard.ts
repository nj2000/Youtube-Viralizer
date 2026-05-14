import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  callSonnet,
  extractTextFromMessage,
} from "@/lib/anthropic/onboarding";
import {
  countActiveChannels,
  findChannelByYoutubeId,
  insertChannel,
  updateChannel,
} from "@/lib/db/channels";
import {
  createOnboardDraft,
  deleteOnboardDraft,
  getOnboardDraft,
} from "@/lib/db/onboard-drafts";
import {
  getCachedPayload,
  setCachedPayload,
} from "@/lib/db/youtube-cache";
import { getProfile, setActiveChannel } from "@/lib/db/profiles";
import type { Database, Json } from "@/lib/db/types";
import {
  ONBOARD_NICHE_SYSTEM,
  ONBOARD_NICHE_SYSTEM_EST_TOKENS,
  buildOnboardNicheUserPrompt,
} from "@/lib/prompts/onboard-niche";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  CompetitorSetSchema,
  type Competitor,
} from "@/lib/validation/channels";
import {
  ChannelDraftSchema,
  type ChannelDraft,
} from "@/lib/validation/onboard";
import {
  fetchChannelMetadata,
  fetchLast50Videos,
  resolveToChannelId,
} from "@/lib/youtube/onboard";
import { computeMedianViews } from "@/lib/youtube/median";
import { parseChannelUrl } from "@/lib/youtube/validate";

import { identifyCompetitors } from "./competitors";
import { mergeCompetitors } from "./onboard-merge";

export { mergeCompetitors } from "./onboard-merge";

type Client = SupabaseClient<Database>;

const NICHE_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
const CHANNEL_LIMIT = 3;

export class ChannelLimitReachedError extends Error {
  constructor() {
    super("Channel limit reached");
    this.name = "ChannelLimitReachedError";
  }
}

export class DraftExpiredError extends Error {
  constructor() {
    super("Onboard draft expired or missing");
    this.name = "DraftExpiredError";
  }
}

export class ChannelAlreadyConnectedError extends Error {
  constructor(readonly channelId: string) {
    super(`Channel already connected: ${channelId}`);
    this.name = "ChannelAlreadyConnectedError";
  }
}

export type OnboardProgress =
  | { step: "validating"; status: "ok" }
  | {
      step: "fetching_channel";
      status: "ok";
      channel: { title: string; handle: string | null; subscriberCount: number | null };
    }
  | { step: "fetching_videos"; status: "ok"; videoCount: number }
  | { step: "computing_median"; status: "ok"; medianViews: number | null }
  | { step: "extracting_niche"; status: "ok"; niche: string; failed: boolean }
  | { step: "identifying_competitors"; status: "ok"; competitorCount: number };

function nicheCacheKey(
  youtubeChannelId: string,
  description: string,
  titles: string[],
): string {
  const descHash = createHash("sha256").update(description).digest("hex");
  const titlesHash = createHash("sha256")
    .update(titles.join("\n"))
    .digest("hex");
  return `niche:v1:${youtubeChannelId}:${descHash}:${titlesHash}`;
}

async function extractNicheCached(input: {
  youtubeChannelId: string;
  channelTitle: string;
  channelDescription: string;
  recentVideoTitles: string[];
}): Promise<{ niche: string; failed: boolean }> {
  const supabase = createSupabaseServiceClient();
  const key = nicheCacheKey(
    input.youtubeChannelId,
    input.channelDescription,
    input.recentVideoTitles,
  );

  const cached = await getCachedPayload(supabase, key);
  if (
    cached !== null &&
    typeof cached === "object" &&
    !Array.isArray(cached) &&
    typeof (cached as { niche?: unknown }).niche === "string"
  ) {
    const c = cached as { niche: string; failed?: boolean };
    return { niche: c.niche, failed: Boolean(c.failed) };
  }

  try {
    const message = await callSonnet({
      system: ONBOARD_NICHE_SYSTEM,
      estSystemTokens: ONBOARD_NICHE_SYSTEM_EST_TOKENS,
      messages: [
        {
          role: "user",
          content: buildOnboardNicheUserPrompt({
            channelTitle: input.channelTitle,
            channelDescription: input.channelDescription,
            recentVideoTitles: input.recentVideoTitles,
          }),
        },
      ],
      maxTokens: 200,
    });

    const raw = extractTextFromMessage(message);
    const niche = raw.length > 200 ? raw.slice(0, 200) : raw;
    const failed = niche.length < 10;
    const result = { niche: failed ? "" : niche, failed };
    await setCachedPayload(
      supabase,
      key,
      result,
      NICHE_CACHE_TTL_SECONDS,
    );
    return result;
  } catch {
    // EXT-3 already retried 3× inside callSonnet via withRetry.
    return { niche: "", failed: true };
  }
}

export async function runOnboard(
  userId: string,
  url: string,
  emitProgress: (event: OnboardProgress) => void,
): Promise<ChannelDraft> {
  emitProgress({ step: "validating", status: "ok" });
  const parsed = parseChannelUrl(url);

  const channelId = await resolveToChannelId(parsed);
  const metadata = await fetchChannelMetadata(channelId);
  emitProgress({
    step: "fetching_channel",
    status: "ok",
    channel: {
      title: metadata.title,
      handle: metadata.handle,
      subscriberCount: metadata.subscriberCount,
    },
  });

  const topVideos = metadata.uploadsPlaylistId
    ? await fetchLast50Videos(metadata.uploadsPlaylistId)
    : [];
  emitProgress({
    step: "fetching_videos",
    status: "ok",
    videoCount: topVideos.length,
  });

  const medianResult = computeMedianViews(topVideos.map((v) => v.viewCount));
  emitProgress({
    step: "computing_median",
    status: "ok",
    medianViews: medianResult.median,
  });

  const niche = await extractNicheCached({
    youtubeChannelId: metadata.youtubeChannelId,
    channelTitle: metadata.title,
    channelDescription: metadata.description,
    recentVideoTitles: topVideos.map((v) => v.title),
  });
  emitProgress({
    step: "extracting_niche",
    status: "ok",
    niche: niche.niche,
    failed: niche.failed,
  });

  const competitorResult = await identifyCompetitors({
    niche: niche.niche,
    country: metadata.country,
    ownChannelId: metadata.youtubeChannelId,
  });
  emitProgress({
    step: "identifying_competitors",
    status: "ok",
    competitorCount: competitorResult.competitors.length,
  });

  const serviceClient = createSupabaseServiceClient();
  const draftPayload = {
    url,
    youtubeChannelId: metadata.youtubeChannelId,
    handle: metadata.handle,
    title: metadata.title,
    description: metadata.description,
    subscriberCount: metadata.subscriberCount,
    medianViews: medianResult.median,
    totalViews: metadata.totalViews,
    country: metadata.country,
    topVideos,
    niche: niche.niche,
    competitors: competitorResult.competitors,
    flags: {
      isNewChannel: medianResult.isNewChannel,
      lowCadence: medianResult.lowCadence,
      nicheExtractionFailed: niche.failed,
      competitorsBelowThreshold: competitorResult.belowThreshold,
    },
  };

  const draft = await createOnboardDraft(
    serviceClient,
    userId,
    draftPayload as unknown as Json,
  );

  return ChannelDraftSchema.parse({
    draftId: draft.draft_id,
    ...draftPayload,
  });
}

export type ConfirmOnboardInput = {
  userId: string;
  draftId: string;
  niche: string;
  competitors: Competitor[];
};

export type ConfirmOnboardResult = {
  channelId: string;
  status: "created" | "updated";
};

export async function confirmOnboard(
  client: Client,
  input: ConfirmOnboardInput,
): Promise<ConfirmOnboardResult> {
  const serviceClient = createSupabaseServiceClient();

  const draftRow = await getOnboardDraft(serviceClient, input.draftId);
  if (!draftRow || draftRow.user_id !== input.userId) {
    throw new DraftExpiredError();
  }

  const draft = ChannelDraftSchema.parse({
    draftId: draftRow.draft_id,
    ...(draftRow.payload as Record<string, unknown>),
  });

  const existing = await findChannelByYoutubeId(
    client,
    input.userId,
    draft.youtubeChannelId,
  );

  const validatedCompetitors = CompetitorSetSchema.parse(input.competitors);
  const userEditedNiche = input.niche.trim() !== draft.niche.trim();

  if (existing) {
    const mergedCompetitors = mergeCompetitors(
      existing.competitorSet,
      validatedCompetitors,
    );

    const preserveUserEdit =
      existing.niche_source === "user_edited" && !userEditedNiche;

    const updated = await updateChannel(client, existing.id, {
      handle: draft.handle,
      title: draft.title,
      description: draft.description,
      subscriber_count: draft.subscriberCount,
      median_views: draft.medianViews,
      total_views: draft.totalViews,
      country: draft.country,
      top_videos_json: draft.topVideos as unknown as Json,
      competitor_set_json: mergedCompetitors as unknown as Json,
      niche: preserveUserEdit ? existing.niche : input.niche,
      niche_source: userEditedNiche
        ? "user_edited"
        : existing.niche_source,
      is_new_channel: draft.flags.isNewChannel,
      low_cadence: draft.flags.lowCadence,
      last_refreshed_at: new Date().toISOString(),
    });

    await deleteOnboardDraft(serviceClient, input.draftId);
    return { channelId: updated.id, status: "updated" };
  }

  const currentCount = await countActiveChannels(client, input.userId);
  if (currentCount >= CHANNEL_LIMIT) {
    throw new ChannelLimitReachedError();
  }

  const inserted = await insertChannel(client, {
    user_id: input.userId,
    youtube_channel_id: draft.youtubeChannelId,
    handle: draft.handle,
    title: draft.title,
    description: draft.description,
    subscriber_count: draft.subscriberCount,
    median_views: draft.medianViews,
    total_views: draft.totalViews,
    country: draft.country,
    top_videos_json: draft.topVideos as unknown as Json,
    competitor_set_json: validatedCompetitors as unknown as Json,
    niche: input.niche,
    niche_source: userEditedNiche ? "user_edited" : "auto",
    is_new_channel: draft.flags.isNewChannel,
    low_cadence: draft.flags.lowCadence,
  });

  // First channel becomes active automatically.
  const profile = await getProfile(client, input.userId);
  if (profile && profile.active_channel_id === null) {
    await setActiveChannel(client, input.userId, inserted.id);
  }

  await deleteOnboardDraft(serviceClient, input.draftId);
  return { channelId: inserted.id, status: "created" };
}
