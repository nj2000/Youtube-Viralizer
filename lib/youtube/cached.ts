import "server-only";

import { createHash } from "node:crypto";
import type { youtube_v3 } from "googleapis";

import {
  getCachedPayload,
  setCachedPayload,
} from "@/lib/db/youtube-cache";
import type { Json } from "@/lib/db/types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { youtubeClient } from "./client";
import { assertHeadroom, incrementUsage } from "./quota";
import { UpstreamError } from "./errors";

// CRIT-1: cache TTLs and per-call unit costs.
const TTL_SECONDS = {
  channels_list: 24 * 60 * 60,
  videos_list: 6 * 60 * 60,
  search_list: 60 * 60,
  playlist_items_list: 6 * 60 * 60,
} as const;

const UNITS = {
  channels_list: 1,
  videos_list: 1,
  search_list: 100,
  playlist_items_list: 1,
} as const;

type Endpoint = keyof typeof UNITS;

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
    .join(",")}}`;
}

function cacheKey(endpoint: Endpoint, params: unknown): string {
  const hash = createHash("sha256").update(stableJson(params)).digest("hex");
  return `youtube:v3:${endpoint}:${hash}`;
}

async function readThrough<T>(
  endpoint: Endpoint,
  params: object,
  fetch: () => Promise<T>,
): Promise<T> {
  const supabase = createSupabaseServiceClient();
  const key = cacheKey(endpoint, params);

  const cached = await getCachedPayload(supabase, key);
  if (cached !== null) return cached as T;

  await assertHeadroom(UNITS[endpoint]);

  let payload: T;
  try {
    payload = await fetch();
  } catch (err) {
    const status =
      (err as { status?: number; code?: number }).status ??
      (err as { code?: number }).code;
    throw new UpstreamError(
      `YouTube ${endpoint} request failed`,
      typeof status === "number" ? status : undefined,
    );
  }

  await setCachedPayload(
    supabase,
    key,
    payload as unknown as Json,
    TTL_SECONDS[endpoint],
  );
  await incrementUsage(UNITS[endpoint]);
  return payload;
}

export type SearchVideosParams = {
  q: string;
  maxResults?: number;
  publishedAfter?: string;
  publishedBefore?: string;
  regionCode?: string;
  order?: "date" | "rating" | "relevance" | "title" | "videoCount" | "viewCount";
};

export function searchVideos(
  params: SearchVideosParams,
): Promise<youtube_v3.Schema$SearchListResponse> {
  return readThrough("search_list", params, async () => {
    const res = await youtubeClient.search.list({
      part: ["snippet"],
      type: ["video"],
      q: params.q,
      maxResults: params.maxResults ?? 25,
      publishedAfter: params.publishedAfter,
      publishedBefore: params.publishedBefore,
      regionCode: params.regionCode,
      order: params.order,
    });
    return res.data;
  });
}

// Stage 3 (Phase 2.1) — channel-scoped variant of search.list. Spec §5.3 step 1.
// Same 100-unit cost and 1h TTL as searchVideos; cache key isolated by params.
export type SearchCompetitorOutliersParams = {
  channelId: string;
  publishedAfter: string;
  maxResults?: number;
};

export function searchCompetitorOutliers(
  params: SearchCompetitorOutliersParams,
): Promise<youtube_v3.Schema$SearchListResponse> {
  return readThrough("search_list", params, async () => {
    const res = await youtubeClient.search.list({
      part: ["snippet"],
      type: ["video"],
      channelId: params.channelId,
      publishedAfter: params.publishedAfter,
      order: "date",
      maxResults: params.maxResults ?? 25,
    });
    return res.data;
  });
}

// Stage 3 task §Step 2 alias. The existing getVideos wrapper already handles
// the videos.list call with snippet/statistics/contentDetails parts.
export const getVideoDetails = getVideos;

export type GetChannelsParams = {
  ids?: string[];
  handle?: string;
  forUsername?: string;
};

export function getChannels(
  params: GetChannelsParams,
): Promise<youtube_v3.Schema$ChannelListResponse> {
  return readThrough("channels_list", params, async () => {
    const res = await youtubeClient.channels.list({
      part: ["snippet", "statistics", "contentDetails", "brandingSettings"],
      id: params.ids,
      forHandle: params.handle,
      forUsername: params.forUsername,
    });
    return res.data;
  });
}

export type GetVideosParams = {
  ids: string[];
};

export function getVideos(
  params: GetVideosParams,
): Promise<youtube_v3.Schema$VideoListResponse> {
  return readThrough("videos_list", params, async () => {
    const res = await youtubeClient.videos.list({
      part: ["snippet", "statistics", "contentDetails"],
      id: params.ids,
    });
    return res.data;
  });
}

export type GetPlaylistItemsParams = {
  playlistId: string;
  maxResults?: number;
};

export function getPlaylistItems(
  params: GetPlaylistItemsParams,
): Promise<youtube_v3.Schema$PlaylistItemListResponse> {
  return readThrough("playlist_items_list", params, async () => {
    const res = await youtubeClient.playlistItems.list({
      part: ["contentDetails"],
      playlistId: params.playlistId,
      maxResults: params.maxResults ?? 50,
    });
    return res.data;
  });
}

// ---------------------------------------------------------------------------
// Phase 2.1 — Stage 3 per-competitor median helper (spec §5.3 step 2).
//
// 24h TTL cached payload of {median, sampleSize, fallback90Day, shortsExcluded}.
// Composes searchCompetitorOutliers + getVideoDetails — those readThrough
// calls already enforce quota soft-cap + per-endpoint TTLs, so this helper
// just memoizes the derived median to avoid recomputing on re-runs.
// ---------------------------------------------------------------------------

export type ChannelMedianPayload = {
  median: number;
  sampleSize: number;
  fallback90Day: boolean;
  shortsExcluded: number;
};

const MEDIAN_TTL_SECONDS = 24 * 60 * 60;
const MEDIAN_SAMPLE_THRESHOLD = 10;
const SHORT_DURATION_SEC = 60;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function parseIsoDurationToSeconds(iso: string | null | undefined): number {
  if (!iso) return 0;
  const match = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;
  const [, h, m, s] = match;
  return Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0);
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

async function fetchLongFormViewsInWindow(
  channelId: string,
  publishedAfter: string,
): Promise<{ longFormViews: number[]; shortsExcluded: number }> {
  const search = await searchCompetitorOutliers({
    channelId,
    publishedAfter,
  });

  const videoIds: string[] = [];
  for (const item of search.items ?? []) {
    const id = item.id?.videoId;
    if (id && /^[\w-]{11}$/.test(id)) videoIds.push(id);
  }
  if (videoIds.length === 0) {
    return { longFormViews: [], shortsExcluded: 0 };
  }

  const hydrated = await getVideoDetails({ ids: videoIds });
  const longFormViews: number[] = [];
  let shortsExcluded = 0;
  for (const v of hydrated.items ?? []) {
    const durationSec = parseIsoDurationToSeconds(v.contentDetails?.duration);
    const viewCountRaw = v.statistics?.viewCount;
    const viewCount = viewCountRaw ? Number(viewCountRaw) : 0;
    if (durationSec > 0 && durationSec < SHORT_DURATION_SEC) {
      shortsExcluded++;
      continue;
    }
    if (Number.isFinite(viewCount)) longFormViews.push(viewCount);
  }
  return { longFormViews, shortsExcluded };
}

export async function computeChannelMedian(
  channelId: string,
): Promise<ChannelMedianPayload | null> {
  const supabase = createSupabaseServiceClient();
  const key = `competitor:median:${channelId}:30d`;

  const cached = await getCachedPayload(supabase, key);
  if (cached !== null) return cached as unknown as ChannelMedianPayload;

  // 30-day window first.
  const { longFormViews: thirty, shortsExcluded: shortsThirty } =
    await fetchLongFormViewsInWindow(channelId, isoDaysAgo(30));

  let views = thirty;
  let fallback90Day = false;
  let shortsExcluded = shortsThirty;

  if (views.length < MEDIAN_SAMPLE_THRESHOLD) {
    const { longFormViews: ninety, shortsExcluded: shortsNinety } =
      await fetchLongFormViewsInWindow(channelId, isoDaysAgo(90));
    if (ninety.length > views.length) {
      views = ninety;
      shortsExcluded = shortsNinety;
      fallback90Day = true;
    }
  }

  if (views.length === 0) {
    // No long-form videos in either window — leave cache empty so a fresh
    // upload triggers re-evaluation on the next call.
    return null;
  }

  const payload: ChannelMedianPayload = {
    median: medianOf(views),
    sampleSize: views.length,
    fallback90Day,
    shortsExcluded,
  };
  await setCachedPayload(
    supabase,
    key,
    payload as unknown as Json,
    MEDIAN_TTL_SECONDS,
  );
  return payload;
}
