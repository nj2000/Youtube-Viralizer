import { z } from "zod";

// Spec §3.2: 10–500 chars; the preprocessor trims first so "   hi   " fails.
export const IdeaTextSchema = z.preprocess(
  (val) => (typeof val === "string" ? val.trim() : val),
  z
    .string()
    .min(10, "Add at least 10 characters so we have something to work with.")
    .max(500, "Trim to 500 characters or fewer."),
);
export type IdeaText = z.infer<typeof IdeaTextSchema>;

export const CreateRunInputSchema = z.object({
  ideaText: IdeaTextSchema,
});
export type CreateRunInput = z.infer<typeof CreateRunInputSchema>;

export const RunStatusSchema = z.enum([
  "queued",
  "running",
  "gated_failed",
  "complete",
  "error",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

// 1..10 — the 10 production pipeline stages. Stage 1 (channel context) and
// stage 2 (idea normalize) are pre-pipeline; verification expects stages 1-12
// numbering in copy but the orchestrator only addresses 3..12 internally.
export const StageNumberSchema = z.number().int().min(1).max(12);
export type StageNumber = z.infer<typeof StageNumberSchema>;

export const StaleFlagsSchema = z.object({
  competitor: z.boolean(),
  score: z.boolean(),
  titles: z.boolean(),
  hook: z.boolean(),
  script: z.boolean(),
  lint: z.boolean(),
  thumbnails: z.boolean(),
  seo: z.boolean(),
  abPlan: z.boolean(),
  engagementDrafts: z.boolean(),
});
export type StaleFlags = z.infer<typeof StaleFlagsSchema>;

export const RunRowSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  channelId: z.string().uuid(),
  ideaText: z.string(),
  status: RunStatusSchema,
  currentStage: StageNumberSchema.nullable(),
  failureReason: z.string().nullable(),
  competitorData: z.unknown().nullable(),
  scoreData: z.unknown().nullable(),
  titlesData: z.unknown().nullable(),
  hookData: z.unknown().nullable(),
  scriptData: z.unknown().nullable(),
  lintData: z.unknown().nullable(),
  thumbnailsData: z.unknown().nullable(),
  seoData: z.unknown().nullable(),
  abPlanData: z.unknown().nullable(),
  engagementDraftsData: z.unknown().nullable(),
  stale: StaleFlagsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
});
export type RunRowView = z.infer<typeof RunRowSchema>;

export const RunListItemSchema = z.object({
  id: z.string().uuid(),
  ideaText: z.string(),
  status: RunStatusSchema,
  currentStage: StageNumberSchema.nullable(),
  scoreValue: z.number().int().min(0).max(100).nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  previewTitle: z.string().nullable(),
  previewAccentHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable(),
});
export type RunListItem = z.infer<typeof RunListItemSchema>;

export const RunsListQuerySchema = z.object({
  q: z.string().max(200).optional(),
  status: RunStatusSchema.optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
export type RunsListQuery = z.infer<typeof RunsListQuerySchema>;

export const RerunFromStageQuerySchema = z.object({
  stage: z.coerce.number().int().min(3).max(12),
});
export type RerunFromStageQuery = z.infer<typeof RerunFromStageQuerySchema>;
