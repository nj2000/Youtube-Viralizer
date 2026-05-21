import { z } from "zod";

// CRIT-2: short engagement copy → Haiku 4.5.
export const ENGAGEMENT_MODEL = "claude-haiku-4-5-20251001";

export const PinnedCommentSchema = z.object({
  text: z.string().min(20).max(800),
  charCount: z.number().int().nonnegative(),
  sentenceCount: z.number().int().min(1).max(4),
  referencedTimestampSec: z.number().int().nonnegative().nullable(),
  endsWithQuestion: z.boolean(),
  lintBadges: z.array(
    z.enum([
      "no_hostage_engagement",
      "references_specific_timestamp",
      "ends_with_specific_question",
      "distinct_from_script_cta",
    ]),
  ),
});
export type PinnedComment = z.infer<typeof PinnedCommentSchema>;

export const CommunityPostSchema = z.object({
  text: z.string().min(40).max(500),
  charCount: z.number().int().nonnegative(),
  sentenceCount: z.number().int().min(1).max(8),
  hasOpenLoop: z.boolean(),
  poll: z
    .object({
      question: z.string().min(5).max(120),
      options: z.array(z.string().min(1).max(60)).min(2).max(4),
    })
    .nullable(),
  variant: z.enum(["pre_publish", "post_publish"]),
  badges: z.array(
    z.enum([
      "open_loop_no_spoiler",
      "voice_match_high",
      "callbacks_pre_publish",
      "distinct_from_pinned",
      "no_smash_that_like",
    ]),
  ),
});
export type CommunityPost = z.infer<typeof CommunityPostSchema>;

export const SuggestedReplyTemplateSchema = z.object({
  keyword: z.string().min(2).max(60),
  replyTemplate: z.string().min(20).max(400),
  trigger: z.enum(["skeptic", "use_case", "tooling", "follow_up", "appreciation"]),
});
export type SuggestedReplyTemplate = z.infer<typeof SuggestedReplyTemplateSchema>;

export const EngagementDraftsSchema = z.object({
  pinnedComment: PinnedCommentSchema,
  communityPostPrePublish: CommunityPostSchema.refine((p) => p.variant === "pre_publish", {
    message: "communityPostPrePublish must have variant pre_publish",
  }),
  communityPostPostPublish: CommunityPostSchema.refine((p) => p.variant === "post_publish", {
    message: "communityPostPostPublish must have variant post_publish",
  }),
  suggestedReplyTemplates: z.array(SuggestedReplyTemplateSchema).min(3).max(5),
  metadata: z.object({
    modelId: z.literal(ENGAGEMENT_MODEL),
    generatedAt: z.string().datetime(),
    cacheHitRate: z.number().min(0).max(1).nullable(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    lintRetryCount: z.number().int().min(0).max(3),
    pollAppropriateForNiche: z.boolean(),
  }),
  schemaVersion: z.literal(1),
});
export type EngagementDrafts = z.infer<typeof EngagementDraftsSchema>;

export const EngagementDraftTypeSchema = z.enum(["pinned", "pre", "post", "replies"]);
export type EngagementDraftType = z.infer<typeof EngagementDraftTypeSchema>;
