import { z } from "zod";

import {
  CompetitorSchema,
  CompetitorSetSchema,
  NicheSchema,
  TopVideosSchema,
} from "./channels";

export const OnboardRequestSchema = z.object({
  url: z.string().trim().min(1).max(2048),
});
export type OnboardRequest = z.infer<typeof OnboardRequestSchema>;

export const ChannelDraftFlagsSchema = z.object({
  isNewChannel: z.boolean(),
  lowCadence: z.boolean(),
  nicheExtractionFailed: z.boolean(),
  competitorsBelowThreshold: z.boolean(),
});
export type ChannelDraftFlags = z.infer<typeof ChannelDraftFlagsSchema>;

export const ChannelDraftSchema = z.object({
  draftId: z.string().uuid(),
  url: z.string().min(1),
  youtubeChannelId: z.string().regex(/^UC[\w-]{22}$/),
  handle: z.string().nullable(),
  title: z.string().min(1),
  description: z.string(),
  subscriberCount: z.number().int().nonnegative().nullable(),
  medianViews: z.number().int().nonnegative().nullable(),
  totalViews: z.number().int().nonnegative().nullable(),
  country: z.string().nullable(),
  topVideos: TopVideosSchema,
  niche: NicheSchema,
  competitors: CompetitorSetSchema,
  flags: ChannelDraftFlagsSchema,
});
export type ChannelDraft = z.infer<typeof ChannelDraftSchema>;

export const ConfirmRequestSchema = z.object({
  draftId: z.string().uuid(),
  niche: NicheSchema,
  competitors: z.array(CompetitorSchema).max(20),
});
export type ConfirmRequest = z.infer<typeof ConfirmRequestSchema>;

export const RedetectRequestSchema = z
  .object({
    niche: NicheSchema,
    currentChannelHandle: z.string().nullable().optional(),
    channelId: z.string().uuid().optional(),
    draftId: z.string().uuid().optional(),
  })
  .refine((req) => Boolean(req.channelId) || Boolean(req.draftId), {
    message: "Either channelId or draftId is required.",
  });
export type RedetectRequest = z.infer<typeof RedetectRequestSchema>;

export const SetActiveChannelSchema = z.object({
  channelId: z.string().uuid(),
});
export type SetActiveChannel = z.infer<typeof SetActiveChannelSchema>;
