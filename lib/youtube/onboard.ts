import "server-only";

import type { youtube_v3 } from "googleapis";

import type { TopVideo } from "@/lib/validation/channels";

import {
  getChannels,
  getPlaylistItems,
  getVideos,
  searchVideos,
} from "./cached";
import { InvalidChannelError, UpstreamError } from "./errors";
import { type ParsedChannelInput } from "./validate";

export type ChannelMetadata = {
  youtubeChannelId: string;
  handle: string | null;
  title: string;
  description: string;
  subscriberCount: number | null;
  totalViews: number | null;
  country: string | null;
  uploadsPlaylistId: string | null;
};

function pickFirstChannel(
  res: youtube_v3.Schema$ChannelListResponse,
): youtube_v3.Schema$Channel | null {
  return res.items?.[0] ?? null;
}

export async function resolveToChannelId(
  parsed: ParsedChannelInput,
): Promise<string> {
  switch (parsed.kind) {
    case "id":
      return parsed.value;

    case "handle": {
      const res = await getChannels({ handle: parsed.value });
      const channel = pickFirstChannel(res);
      if (!channel?.id) throw new InvalidChannelError(`@${parsed.value}`);
      return channel.id;
    }

    case "custom": {
      const res = await getChannels({ forUsername: parsed.value });
      const fromUsername = pickFirstChannel(res);
      if (fromUsername?.id) return fromUsername.id;
      // forUsername is deprecated for many channels; fall back to a search.
      const search = await searchVideos({ q: parsed.value, maxResults: 1 });
      const fromSearch = search.items?.[0]?.snippet?.channelId;
      if (!fromSearch) throw new InvalidChannelError(`/c/${parsed.value}`);
      return fromSearch;
    }

    case "video":
    case "short_video": {
      const res = await getVideos({ ids: [parsed.value] });
      const channelId = res.items?.[0]?.snippet?.channelId;
      if (!channelId) throw new InvalidChannelError(parsed.value);
      return channelId;
    }
  }
}

export async function fetchChannelMetadata(
  channelId: string,
): Promise<ChannelMetadata> {
  const res = await getChannels({ ids: [channelId] });
  const channel = pickFirstChannel(res);
  if (!channel?.id) throw new InvalidChannelError(channelId);

  const handleRaw = channel.snippet?.customUrl ?? null;
  const handle = handleRaw?.startsWith("@") ? handleRaw.slice(1) : handleRaw;

  const subs = channel.statistics?.subscriberCount;
  const views = channel.statistics?.viewCount;

  return {
    youtubeChannelId: channel.id,
    handle: handle ?? null,
    title: channel.snippet?.title ?? "",
    description: channel.snippet?.description ?? "",
    subscriberCount: subs ? Number(subs) : null,
    totalViews: views ? Number(views) : null,
    country: channel.snippet?.country ?? null,
    uploadsPlaylistId:
      channel.contentDetails?.relatedPlaylists?.uploads ?? null,
  };
}

function parseIsoDurationToSeconds(iso: string | null | undefined): number {
  if (!iso) return 0;
  const match = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;
  const [, h, m, s] = match;
  return Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0);
}

export async function fetchLast50Videos(
  uploadsPlaylistId: string,
): Promise<TopVideo[]> {
  const playlist = await getPlaylistItems({
    playlistId: uploadsPlaylistId,
    maxResults: 50,
  });

  const videoIds: string[] = [];
  for (const item of playlist.items ?? []) {
    const id = item.contentDetails?.videoId;
    if (id && /^[\w-]{11}$/.test(id)) videoIds.push(id);
  }

  if (videoIds.length === 0) return [];

  const videos = await getVideos({ ids: videoIds });

  const topVideos: TopVideo[] = [];
  for (const v of videos.items ?? []) {
    if (!v.id || !/^[\w-]{11}$/.test(v.id)) continue;
    const viewCountRaw = v.statistics?.viewCount;
    topVideos.push({
      videoId: v.id,
      title: (v.snippet?.title ?? "").slice(0, 500) || "Untitled",
      viewCount: viewCountRaw ? Number(viewCountRaw) : 0,
      publishedAt: v.snippet?.publishedAt ?? "",
      durationSec: parseIsoDurationToSeconds(v.contentDetails?.duration),
    });
  }

  return topVideos;
}

export type CompetitorCandidate = {
  youtubeChannelId: string;
  handle: string | null;
  title: string;
  description: string;
  subscriberCount: number | null;
  uploadsPlaylistId: string | null;
};

export async function hydrateCompetitorMetadata(
  channelIds: string[],
): Promise<CompetitorCandidate[]> {
  if (channelIds.length === 0) return [];

  // googleapis caps `channels.list` at 50 IDs per call.
  const batches: string[][] = [];
  for (let i = 0; i < channelIds.length; i += 50) {
    batches.push(channelIds.slice(i, i + 50));
  }

  const out: CompetitorCandidate[] = [];
  for (const batch of batches) {
    let res: youtube_v3.Schema$ChannelListResponse;
    try {
      res = await getChannels({ ids: batch });
    } catch (err) {
      if (err instanceof UpstreamError) continue;
      throw err;
    }
    for (const c of res.items ?? []) {
      if (!c.id) continue;
      const subsRaw = c.statistics?.subscriberCount;
      const handleRaw = c.snippet?.customUrl ?? null;
      const handle = handleRaw?.startsWith("@")
        ? handleRaw.slice(1)
        : handleRaw;
      out.push({
        youtubeChannelId: c.id,
        handle: handle ?? null,
        title: c.snippet?.title ?? "",
        description: c.snippet?.description ?? "",
        subscriberCount: subsRaw ? Number(subsRaw) : null,
        uploadsPlaylistId:
          c.contentDetails?.relatedPlaylists?.uploads ?? null,
      });
    }
  }

  return out;
}
