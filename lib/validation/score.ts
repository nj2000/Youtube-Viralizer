import { z } from "zod";

// Spec §3.3 — five 0-100 integer dimensions, closed set. The TS layer
// recomputes finalScore via the documented weights; the model is never
// trusted for arithmetic.
export const ScoreDimensionsSchema = z.object({
  hook_strength: z.number().int().min(0).max(100),
  curiosity_gap: z.number().int().min(0).max(100),
  outlier_alignment: z.number().int().min(0).max(100),
  niche_fit: z.number().int().min(0).max(100),
  title_ability: z.number().int().min(0).max(100),
});
export type ScoreDimensions = z.infer<typeof ScoreDimensionsSchema>;

// Authoritative weighting formula (spec §5.8). Exported as a tuple so the
// service and the verification test reference the same numbers.
export const DIMENSION_WEIGHTS = {
  hook_strength: 0.25,
  curiosity_gap: 0.25,
  outlier_alignment: 0.2,
  niche_fit: 0.2,
  title_ability: 0.1,
} as const;

export const GATE_THRESHOLD = 92;

export const ReframeSchema = z.object({
  revisedIdeaText: z.string().min(10).max(500),
  hypothesis: z.string().min(1).max(400),
  expectedScoreLift: z.number().int().min(0).max(100),
});
export type Reframe = z.infer<typeof ReframeSchema>;

export const ScoreDataSchema = z.object({
  finalScore: z.number().min(0).max(100),
  dimensions: ScoreDimensionsSchema,
  reasoning: z.string().min(1).max(1800),
  passed: z.boolean(),
  reframes: z.array(ReframeSchema).max(3).nullable(),
  reframeShortfall: z.boolean(),
  gateOverriddenAt: z.string().nullable(),
  outlierPatternCount: z.number().int().nonnegative(),
  lowConfidence: z.boolean(),
  scoredAt: z.string(),
  model: z.string(),
  schemaVersion: z.literal(1),
});
export type ScoreData = z.infer<typeof ScoreDataSchema>;

// Recompute finalScore from dimensions. The service uses this; the
// verification test calls it directly to confirm the TS arithmetic matches
// the documented weights to within 0.01.
export function computeFinalScore(dimensions: ScoreDimensions): number {
  const raw =
    dimensions.hook_strength * DIMENSION_WEIGHTS.hook_strength +
    dimensions.curiosity_gap * DIMENSION_WEIGHTS.curiosity_gap +
    dimensions.outlier_alignment * DIMENSION_WEIGHTS.outlier_alignment +
    dimensions.niche_fit * DIMENSION_WEIGHTS.niche_fit +
    dimensions.title_ability * DIMENSION_WEIGHTS.title_ability;
  // Round to 2 decimals so the persisted score is deterministic across
  // re-runs of the same dimension set.
  return Math.round(raw * 100) / 100;
}
