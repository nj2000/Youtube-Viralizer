import { z } from "zod";

import { TitleTriggerSchema } from "@/lib/validation/titles";

// CRIT-2: Stage 9 is short structured output → Haiku 4.5.
export const THUMBNAILS_MODEL = "claude-haiku-4-5-20251001";

// WCAG-AA contrast floor between overlay text and the background swatch.
export const WCAG_AA_CONTRAST = 4.5;
export const OVERLAY_MIN_WORDS = 3;
export const OVERLAY_MAX_WORDS = 5;

// Lowercase 6-char hex with leading hash (spec §3). Rejects #abcdef0 (7) and
// abc (no hash) and uppercase.
export const HexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/);

export const PaletteRoleSchema = z.enum([
  "primary",
  "accent",
  "background",
  "contrast",
]);
export type PaletteRole = z.infer<typeof PaletteRoleSchema>;

export const PaletteSwatchSchema = z.object({
  hex: HexColorSchema,
  role: PaletteRoleSchema,
});
export type PaletteSwatch = z.infer<typeof PaletteSwatchSchema>;

export const FocalPointSchema = z.enum([
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
]);
export type FocalPoint = z.infer<typeof FocalPointSchema>;

export const CharacterPlacementSchema = z.enum([
  "none",
  "left-third",
  "right-third",
  "center",
  "inset-bottom-right",
  "inset-bottom-left",
]);
export type CharacterPlacement = z.infer<typeof CharacterPlacementSchema>;

export const StyleRegisterSchema = z.enum([
  "high-contrast-bold",
  "clean-infographic",
  "documentary-candid",
  "neon-on-dark",
  "type-driven",
  "split-before-after",
]);
export type StyleRegister = z.infer<typeof StyleRegisterSchema>;

export const OverlayTextSchema = z.object({
  text: z.string().min(1).max(40),
  wordCount: z.number().int().min(OVERLAY_MIN_WORDS).max(OVERLAY_MAX_WORDS),
  color: HexColorSchema, // must equal one of the palette swatches (refined below)
});
export type OverlayText = z.infer<typeof OverlayTextSchema>;

export const FeasibilityFlagsSchema = z.object({
  requiresCreatorFace: z.boolean(),
  requiresStockAsset: z.boolean(),
  typeDrivenOnly: z.boolean(),
});

export const ThumbnailBriefSchema = z
  .object({
    trigger: TitleTriggerSchema,
    pairsWithTitle: z.string().min(1).max(100), // verbatim locked title (stale detection)
    composition: z.string().min(20).max(280),
    focalPoint: FocalPointSchema,
    characterPlacement: CharacterPlacementSchema,
    // "" allowed ONLY when characterPlacement === "none" (refined below).
    facialExpression: z.string().max(200),
    palette: z.array(PaletteSwatchSchema).length(4),
    backgroundConcept: z.string().min(20).max(300),
    overlayText: OverlayTextSchema,
    styleChips: z.array(StyleRegisterSchema).min(2).max(4),
    whyItWorks: z.string().min(40).max(400),
    feasibilityFlags: FeasibilityFlagsSchema,
    truncationOccurred: z.boolean(),
    generatedAt: z.string().datetime(),
  })
  .superRefine((b, ctx) => {
    // All four roles present exactly once (Zod's .length(4) can't enforce role
    // uniqueness on its own).
    if (new Set(b.palette.map((p) => p.role)).size !== 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "palette must contain all 4 roles exactly once",
        path: ["palette"],
      });
    }
    // Overlay color must be drawn from the palette (image-gen invariant).
    if (!b.palette.some((p) => p.hex === b.overlayText.color)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "overlayText.color must be one of the palette swatches",
        path: ["overlayText", "color"],
      });
    }
    // facialExpression XOR characterPlacement === "none".
    if (b.characterPlacement === "none" && b.facialExpression.length !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "facialExpression must be empty when characterPlacement is none",
        path: ["facialExpression"],
      });
    }
    if (b.characterPlacement !== "none" && b.facialExpression.trim().length < 8) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "facialExpression required (≥8 chars) when a character is placed",
        path: ["facialExpression"],
      });
    }
  });
export type ThumbnailBrief = z.infer<typeof ThumbnailBriefSchema>;

export const ThumbnailsFlagsSchema = z.object({
  diversityWarning: z.boolean(),
  typeDrivenFallback: z.boolean(),
  paletteContrastFail: z.boolean(),
  partialReturn: z.boolean(),
  truncationOccurred: z.boolean(),
  regenerationCount: z.number().int().nonnegative(),
});
export type ThumbnailsFlags = z.infer<typeof ThumbnailsFlagsSchema>;

export const ThumbnailsMetaSchema = z.object({
  model: z.literal(THUMBNAILS_MODEL),
  cacheHit: z.boolean(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  elapsedMs: z.number().int().nonnegative(),
  titleSnapshot: z.object({
    curiosity: z.string().min(1).max(100).nullable(),
    fear: z.string().min(1).max(100).nullable(),
    result: z.string().min(1).max(100).nullable(),
  }),
});
export type ThumbnailsMeta = z.infer<typeof ThumbnailsMetaSchema>;

export const ThumbnailsDataSchema = z.object({
  curiosity: ThumbnailBriefSchema.nullable(),
  fear: ThumbnailBriefSchema.nullable(),
  result: ThumbnailBriefSchema.nullable(),
  flags: ThumbnailsFlagsSchema,
  meta: ThumbnailsMetaSchema,
  generatedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  schemaVersion: z.literal(1),
});
export type ThumbnailsData = z.infer<typeof ThumbnailsDataSchema>;

// Briefs are keyed by trigger (curiosity/fear/result), nullable when that title
// wasn't locked. Mirrors titles_data so the trigger color tokens line up.
export function briefsOf(data: ThumbnailsData): ThumbnailBrief[] {
  return [data.curiosity, data.fear, data.result].filter(
    (b): b is ThumbnailBrief => b !== null,
  );
}
