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
