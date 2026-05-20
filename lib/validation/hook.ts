import { z } from "zod";

// Closed archetype enum (spec §3 — supersedes task.md's generic list; matches
// the reference hook.md five psychological mechanisms). Shared with Stage 7.
export const HookArchetypeSchema = z.enum([
  "shock",
  "curiosity-gap",
  "story",
  "problem-agitation",
  "social-proof",
]);
export type HookArchetype = z.infer<typeof HookArchetypeSchema>;

export const DropoffRiskSchema = z.enum(["low", "medium", "high"]);
export type DropoffRisk = z.infer<typeof DropoffRiskSchema>;

export const HookWarningSchema = z.enum([
  "OVER_WORD_LIMIT",
  "OVER_TIME_BUDGET",
  "NO_CONCRETE_PROMISE",
  "ANTI_PATTERN_DETECTED",
  "ARCHETYPE_DUPLICATE",
  "KILLER_COMBO",
]);
export type HookWarning = z.infer<typeof HookWarningSchema>;

// Each beat is EITHER a spoken line OR a b-roll cue, never both.
export const HookBeatSchema = z
  .object({
    timeSec: z.number().int().min(0).max(35),
    line: z.string().min(1).max(400).nullable(),
    brollCue: z.string().min(1).max(300).nullable(),
  })
  .refine(
    (b) => (b.line === null) !== (b.brollCue === null),
    "Each beat must have exactly one of line or brollCue",
  );
export type HookBeat = z.infer<typeof HookBeatSchema>;

export const SPEAK_WPM = 150;
export const HOOK_WORD_TARGET = 75;
export const HOOK_WORD_HARD_CEILING = 120;
export const RETENTION_LOW_RISK_MIN = 70;
export const RETENTION_MEDIUM_RISK_MIN = 55;
export const HOOK_MODEL = "claude-haiku-4-5-20251001";

export const HookVariantSchema = z.object({
  linkedTitleIndex: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  archetype: HookArchetypeSchema,
  promise: z.string().min(10).max(200),
  beats: z.array(HookBeatSchema).min(2).max(8),
  reasoning: z.string().min(1).max(400),
  // Model self-grade (0-100) feeding the retention heuristic.
  openerStrengthRaw: z.number().int().min(0).max(100),
  // TS-computed — never read from the model.
  wordCount: z.number().int().min(0).max(HOOK_WORD_HARD_CEILING),
  speakTimeSec: z.number().int().min(0).max(60),
  retention30sPredict: z.number().int().min(0).max(100),
  dropoffRiskRating: DropoffRiskSchema,
  warnings: z.array(HookWarningSchema),
});
export type HookVariant = z.infer<typeof HookVariantSchema>;

export const HookDataSchema = z.object({
  variants: z.array(HookVariantSchema).length(3),
  lockedVariantIndex: z
    .union([z.literal(0), z.literal(1), z.literal(2)])
    .nullable(),
  allHighRisk: z.boolean(),
  lockedAt: z.string().nullable(),
  generatedAt: z.string(),
  model: z.literal(HOOK_MODEL),
  schemaVersion: z.literal(1),
});
export type HookData = z.infer<typeof HookDataSchema>;

export function hasLockedHook(data: HookData): boolean {
  return data.lockedVariantIndex !== null;
}
