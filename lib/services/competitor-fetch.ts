import "server-only";

import type { Competitor } from "@/lib/validation/channels";
import type { CompetitorSkipped, Outlier } from "@/lib/validation/competitor";
import {
  computeChannelMedian,
  getVideoDetails,
  searchCompetitorOutliers,
} from "@/lib/youtube/cached";
import { UpstreamError } from "@/lib/youtube/errors";

// Per-competitor fetch + 5× filter. Returns outliers joined to the channel's
// baseline title sample (top 5 by recency, excluding the outlier itself) — the
// LLM uses that sample for delta-vs-baseline framing.

const FIVE_X = 5;
const RECENCY_BOOST_HOURS = 72;
const SHORT_DURATION_SEC = 60;

// Extends Outlier with the baseline-title sample the LLM consumes. The
// orchestrator strips this field before persisting.
export type RawOutlier = Outlier & { _baselineTitles: string[] };

export type FetchCompetitorResult =
  | {
      outliers: RawOutlier[];
      videosEvaluated: number;
      fallback90Day: boolean;
      median: number;
      skipped: null;
    }
  | { outliers: []; videosEvaluated: 0; fallback90Day: false; median: 0; skipped: CompetitorSkipped };

function parseIsoDurationToSeconds(iso: string | null | undefined): number {
  if (!iso) return 0;
  const match = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return 0;
  const [, h, m, s] = match;
  return Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0);
}

function hoursSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - t) / (1000 * 60 * 60));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function skippedResult(
  competitor: Competitor,
  reason: CompetitorSkipped["reason"],
): FetchCompetitorResult {
  return {
    outliers: [],
    videosEvaluated: 0,
    fallback90Day: false,
    median: 0,
    skipped: {
      channelId: competitor.youtubeChannelId,
      channelTitle: competitor.title,
      reason,
    },
  };
}

export async function fetchOutliersForCompetitor(args: {
  competitor: Competitor;
  publishedAfter: string;
}): Promise<FetchCompetitorResult> {
  const { competitor, publishedAfter } = args;

  let searchRes;
  try {
    searchRes = await searchCompetitorOutliers({
      channelId: competitor.youtubeChannelId,
      publishedAfter,
    });
  } catch (err) {
    if (err instanceof UpstreamError) {
      return skippedResult(
        competitor,
        err.httpStatus === 404 ? "deleted" : "fetch_failed",
      );
    }
    throw err;
  }

  const videoIds: string[] = [];
  const baselineTitlePool: string[] = [];
  for (const item of searchRes.items ?? []) {
    const id = item.id?.videoId;
    if (id && /^[\w-]{11}$/.test(id)) videoIds.push(id);
    const t = item.snippet?.title;
    if (typeof t === "string" && t) baselineTitlePool.push(t);
  }
  if (videoIds.length === 0) return skippedResult(competitor, "no_videos");

  const hydrated = await getVideoDetails({ ids: videoIds });
  const medianPayload = await computeChannelMedian(competitor.youtubeChannelId);
  if (!medianPayload) return skippedResult(competitor, "no_videos");
  const { median, fallback90Day } = medianPayload;

  const outliers: RawOutlier[] = [];
  for (const v of hydrated.items ?? []) {
    if (!v.id || !/^[\w-]{11}$/.test(v.id)) continue;
    const viewCountRaw = v.statistics?.viewCount;
    const viewCount = viewCountRaw ? Number(viewCountRaw) : 0;
    if (!Number.isFinite(viewCount)) continue;
    const durationSec = parseIsoDurationToSeconds(v.contentDetails?.duration);
    const publishedAtIso = v.snippet?.publishedAt ?? "";
    const ageHrs = hoursSince(publishedAtIso);
    const isShort = durationSec > 0 && durationSec < SHORT_DURATION_SEC;
    const isLivestreamVod = Boolean(
      v.snippet?.liveBroadcastContent &&
        v.snippet.liveBroadcastContent !== "none",
    );

    // Recency projection per spec §5.4: <72h videos get projected forward so
    // freshly-uploaded mid-tier hits don't crowd out genuine outliers. We
    // display the actual viewCount in the UI and flag recencyBoosted.
    const recencyBoosted = ageHrs < RECENCY_BOOST_HOURS;
    const projectedCount = recencyBoosted
      ? viewCount * (RECENCY_BOOST_HOURS / Math.max(ageHrs, 6))
      : viewCount;

    if (projectedCount < FIVE_X * median) continue;

    const videoTitle = (v.snippet?.title ?? "").slice(0, 500);
    if (!videoTitle) continue;

    outliers.push({
      videoId: v.id,
      title: videoTitle,
      channelId: competitor.youtubeChannelId,
      channelTitle: competitor.title,
      channelHandle: competitor.handle,
      viewCount,
      channelMedianViews: median,
      viewMultiple: round1(viewCount / median),
      publishedAt: publishedAtIso,
      durationSec,
      thumbnailUrl:
        v.snippet?.thumbnails?.medium?.url ??
        v.snippet?.thumbnails?.default?.url ??
        `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
      isShort,
      isLivestreamVod,
      recencyBoosted,
      deltaLabel: "",
      deltaReason: "",
      transferableLesson: "",
      triggerLabels: [],
      deltaStatus: "missing",
      _baselineTitles: baselineTitlePool
        .filter((t) => t !== videoTitle)
        .slice(0, 5),
    });
  }

  return {
    outliers,
    videosEvaluated: hydrated.items?.length ?? 0,
    fallback90Day,
    median,
    skipped: null,
  };
}
