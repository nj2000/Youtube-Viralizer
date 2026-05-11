export const MODELS = {
  opus: "claude-opus-4-7",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
} as const;

export type Model = (typeof MODELS)[keyof typeof MODELS];

export type Stage =
  | "competitor"
  | "score"
  | "titles"
  | "hook"
  | "script"
  | "lint"
  | "thumbnails"
  | "seo"
  | "ab"
  | "engagement";

// CRIT-2: Opus for competitor/score/script (reasoning-heavy);
// Haiku for short/templated stages. Phase 1.3 task explicitly adds
// competitor → Opus, which CLAUDE.md CRIT-2 had omitted.
export const stageModel: Record<Stage, Model> = {
  competitor: MODELS.opus,
  score: MODELS.opus,
  titles: MODELS.haiku,
  hook: MODELS.haiku,
  script: MODELS.opus,
  lint: MODELS.haiku,
  thumbnails: MODELS.haiku,
  seo: MODELS.haiku,
  ab: MODELS.haiku,
  engagement: MODELS.haiku,
};

export type ModelFamily = "opus" | "sonnet" | "haiku";

export function modelFamily(model: Model): ModelFamily {
  if (model === MODELS.opus) return "opus";
  if (model === MODELS.sonnet) return "sonnet";
  return "haiku";
}
