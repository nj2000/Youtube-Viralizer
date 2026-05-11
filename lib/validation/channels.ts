import { z } from "zod";

export const TopVideoSchema = z.object({
  videoId: z.string().min(1),
  title: z.string(),
  viewCount: z.number().int().nonnegative(),
  publishedAt: z.string(),
  durationSec: z.number().int().nonnegative(),
});
export type TopVideo = z.infer<typeof TopVideoSchema>;

export const TopVideosSchema = z.array(TopVideoSchema);

export const CompetitorSchema = z.object({
  youtubeChannelId: z.string().min(1),
  handle: z.string().nullable(),
  title: z.string(),
  subscriberCount: z.number().int().nonnegative().nullable(),
  medianViews: z.number().int().nonnegative().nullable(),
  source: z.enum(["auto", "manual"]),
});
export type Competitor = z.infer<typeof CompetitorSchema>;

export const CompetitorSetSchema = z.array(CompetitorSchema).max(20);
