import { z } from "zod";

export const TopVideoSchema = z.object({
  videoId: z.string().regex(/^[\w-]{11}$/),
  title: z.string().min(1).max(500),
  viewCount: z.number().int().nonnegative(),
  publishedAt: z.string(),
  durationSec: z.number().int().nonnegative(),
});
export type TopVideo = z.infer<typeof TopVideoSchema>;

export const TopVideosSchema = z.array(TopVideoSchema).max(50);

export const CompetitorSchema = z.object({
  youtubeChannelId: z.string().regex(/^UC[\w-]{22}$/),
  handle: z.string().nullable(),
  title: z.string().min(1),
  subscriberCount: z.number().int().nonnegative().nullable(),
  medianViews: z.number().int().nonnegative().nullable(),
  source: z.enum(["auto", "manual"]),
});
export type Competitor = z.infer<typeof CompetitorSchema>;

export const CompetitorSetSchema = z.array(CompetitorSchema).max(20);

export const NicheSchema = z.string().trim().max(200);
