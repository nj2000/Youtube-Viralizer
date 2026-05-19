import { z } from "zod";

// Closed enum per spec §3.2 — downstream stages (5 titles, 6 hooks) filter and
// rank against these stable categories. Open strings would make them brittle.
// New triggers go through a code change and a CLAUDE.md note, not a prompt
// edit.
export const TriggerLabelSchema = z.enum([
  "curiosity_gap",
  "fear",
  "specific_result",
  "first_person",
  "payoff_promise",
  "negation",
  "specific_dollar_amount",
  "personal_experiment",
]);
export type TriggerLabel = z.infer<typeof TriggerLabelSchema>;

export const OutlierSchema = z.object({
  videoId: z.string().regex(/^[\w-]{11}$/),
  title: z.string().min(1).max(500),
  channelId: z.string().regex(/^UC[\w-]+$/),
  channelTitle: z.string().min(1),
  channelHandle: z.string().nullable(),
  viewCount: z.number().int().nonnegative(),
  channelMedianViews: z.number().int().nonnegative(),
  viewMultiple: z.number().nonnegative(),
  publishedAt: z.string(),
  durationSec: z.number().int().nonnegative(),
  thumbnailUrl: z.string().url(),

  // Format flags surfaced in the UI per spec §3.2 / §5.4.
  isShort: z.boolean(),
  isLivestreamVod: z.boolean(),
  recencyBoosted: z.boolean(),

  // Delta extraction (LLM output, merged server-side by videoId).
  deltaLabel: z.string().min(1).max(120),
  deltaReason: z.string().min(1).max(800),
  transferableLesson: z.string().max(400),
  triggerLabels: z.array(TriggerLabelSchema).max(4),
  deltaStatus: z.enum(["complete", "partial", "missing"]),
});
export type Outlier = z.infer<typeof OutlierSchema>;

export const ExtractedPatternSchema = z.object({
  pattern: z.string().min(1).max(120),
  evidence: z.array(z.string().regex(/^[\w-]{11}$/)).min(1),
  confidence: z.enum(["low", "medium", "high"]),
  category: z.enum([
    "framing",
    "title_structure",
    "length",
    "thumbnail",
    "trigger",
    "format",
  ]),
});
export type ExtractedPattern = z.infer<typeof ExtractedPatternSchema>;

// Diagnostics drive the State 3 / State 6 banner copy in the mockup. See
// `Documentation/Mockups/04-competitor-outlier-analysis.html`.
export const CompetitorSkippedSchema = z.object({
  channelId: z.string().regex(/^UC[\w-]+$/),
  channelTitle: z.string().nullable(),
  reason: z.enum(["deleted", "private", "no_videos", "fetch_failed"]),
});
export type CompetitorSkipped = z.infer<typeof CompetitorSkippedSchema>;

export const CompetitorDiagnosticsSchema = z.object({
  competitorsScanned: z.number().int().nonnegative(),
  competitorsSkipped: z.array(CompetitorSkippedSchema),
  videosEvaluated: z.number().int().nonnegative(),
  highestMultipleSeen: z.number().nonnegative().nullable(),
  weakSignal: z.boolean(),
  singleCreatorDominance: z.boolean(),
  fallback90DayUsedFor: z.array(z.string().regex(/^UC[\w-]+$/)),
  youtubeQuotaUnitsSpent: z.number().int().nonnegative(),
});
export type CompetitorDiagnostics = z.infer<typeof CompetitorDiagnosticsSchema>;

export const CompetitorDataSchema = z.object({
  outliers: z.array(OutlierSchema).max(15),
  extractedPatterns: z.array(ExtractedPatternSchema).max(10),
  diagnostics: CompetitorDiagnosticsSchema,
  noOutliers: z.boolean(),
  cachedAt: z.string(),
  generatedAt: z.string(),
  schemaVersion: z.literal(1),
});
export type CompetitorData = z.infer<typeof CompetitorDataSchema>;
