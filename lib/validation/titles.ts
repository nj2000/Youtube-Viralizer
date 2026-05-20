import { z } from "zod";

// Closed trigger enum — shared design tokens (curiosity purple / fear red /
// result green) reused by Stage 9 thumbnails + Stage 11 A/B plan. Never
// extended dynamically.
export const TitleTriggerSchema = z.enum(["curiosity", "fear", "result"]);
export type TitleTrigger = z.infer<typeof TitleTriggerSchema>;

export const TITLE_CHAR_HARD_LIMIT = 100;
export const TITLE_CHAR_SOFT_TARGET = 70;
export const JACCARD_DIVERSITY_THRESHOLD = 0.6;
export const VOICE_SAMPLE_COUNT = 20;
export const VOICE_FALLBACK_MIN_SAMPLES = 3;
export const TITLES_MODEL = "claude-haiku-4-5-20251001";

export const VoiceMatchSchema = z.object({
  score: z.number().int().min(0).max(10),
  label: z.enum(["strong", "moderate", "weak", "fallback"]),
});
export type VoiceMatch = z.infer<typeof VoiceMatchSchema>;

export const TitleVariantSchema = z.object({
  trigger: TitleTriggerSchema,
  text: z.string().min(1).max(TITLE_CHAR_HARD_LIMIT),
  charCount: z.number().int().nonnegative(),
  predictedCtrLift: z.number().min(-50).max(200),
  audienceCluster: z.string().min(1).max(80),
  voiceMatch: VoiceMatchSchema,
  reasoning: z.string().min(1).max(800),
  // Placeholder for Feature #18 (niche vocabulary). Always [] in Phase 1.
  vocabRefs: z.array(z.string()).max(20),
  truncated: z.boolean(),
  originalLength: z.number().int().nonnegative().nullable(),
  lockedIn: z.boolean(),
  userEdited: z.boolean(),
  generatedAt: z.string(),
});
export type TitleVariant = z.infer<typeof TitleVariantSchema>;

export const TitlesFlagsSchema = z.object({
  diversityWarning: z.boolean(),
  voiceFallback: z.boolean(),
  partialReturn: z.boolean(),
  truncationOccurred: z.boolean(),
  regenerationCount: z.number().int().nonnegative(),
});
export type TitlesFlags = z.infer<typeof TitlesFlagsSchema>;

export const TitlesMetaSchema = z.object({
  model: z.literal(TITLES_MODEL),
  competitorPatternsUsed: z.array(z.string()).max(20),
});
export type TitlesMeta = z.infer<typeof TitlesMetaSchema>;

export const TitlesDataSchema = z.object({
  curiosity: TitleVariantSchema.nullable(),
  fear: TitleVariantSchema.nullable(),
  result: TitleVariantSchema.nullable(),
  intentRewrites: z.array(z.string().min(1).max(200)).min(0).max(5),
  chosenIndex: z.union([z.literal(0), z.literal(1), z.literal(2)]).nullable(),
  flags: TitlesFlagsSchema,
  meta: TitlesMetaSchema,
  generatedAt: z.string(),
  updatedAt: z.string(),
  schemaVersion: z.literal(1),
});
export type TitlesData = z.infer<typeof TitlesDataSchema>;

export const TRIGGER_ORDER: TitleTrigger[] = ["curiosity", "fear", "result"];

// Returns the trigger variants in fixed order, skipping nulls. Used by the
// orchestrator's locked-title check and the UI preview.
export function variantsOf(data: TitlesData): TitleVariant[] {
  return TRIGGER_ORDER.map((t) => data[t]).filter(
    (v): v is TitleVariant => v !== null,
  );
}

export function hasAnyLockedTitle(data: TitlesData): boolean {
  return variantsOf(data).some((v) => v.lockedIn);
}
