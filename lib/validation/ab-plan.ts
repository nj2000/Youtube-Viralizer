import { z } from "zod";

import { TitleTriggerSchema, type TitleTrigger } from "@/lib/validation/titles";

// CRIT-2: templated synthesis → Haiku 4.5.
export const AB_MODEL = "claude-haiku-4-5-20251001";

export const SignalUnderTestSchema = z.enum([
  "information_seeking",
  "loss_aversion",
  "practicality",
]);
export type SignalUnderTest = z.infer<typeof SignalUnderTestSchema>;

// Compile-time exhaustive mapping (a new trigger breaks the build via the
// `never` assignment). Signal is DERIVED, never user-set (spec §5.3).
export function triggerToSignal(t: TitleTrigger): SignalUnderTest {
  switch (t) {
    case "curiosity":
      return "information_seeking";
    case "fear":
      return "loss_aversion";
    case "result":
      return "practicality";
    default: {
      const _exhaustive: never = t;
      return _exhaustive;
    }
  }
}

// Basis points, not floats — avoids drift between predicted and actual.
export const PredictedCtrDeltaSchema = z
  .object({
    minBp: z.number().int().min(-2000).max(2000),
    maxBp: z.number().int().min(-2000).max(2000),
  })
  .refine((d) => d.minBp <= d.maxBp, { message: "minBp must be ≤ maxBp" });
export type PredictedCtrDelta = z.infer<typeof PredictedCtrDeltaSchema>;

export const ScheduleHourSchema = z.union([
  z.literal(0),
  z.literal(12),
  z.literal(24),
  z.literal(48),
]);

export const ScheduleStepSchema = z.object({
  hour: ScheduleHourSchema,
  label: z.string().min(1).max(40),
  action: z.string().min(20).max(300),
  decisionGate: z.boolean(),
});

export const ScheduleSchema = z
  .tuple([ScheduleStepSchema, ScheduleStepSchema, ScheduleStepSchema, ScheduleStepSchema])
  .refine((s) => s.map((x) => x.hour).join(",") === "0,12,24,48", {
    message: "schedule must be hours 0,12,24,48 in order",
  });

export const DecisionRuleKindSchema = z.enum(["promote", "hold", "regenerate"]);
export type DecisionRuleKind = z.infer<typeof DecisionRuleKindSchema>;

export const ThresholdSchema = z.object({
  metric: z.enum([
    "ctr_lift_pct",
    "ctr_delta_vs_baseline_pct",
    "impressions_per_variant",
  ]),
  operator: z.enum([">=", "<=", ">", "<"]),
  value: z.number(),
});

export const DecisionRuleSchema = z.object({
  kind: DecisionRuleKindSchema,
  conditionText: z.string().min(20).max(400),
  threshold: z.array(ThresholdSchema).min(1).max(3),
  evaluateAtHour: z.union([z.literal(24), z.literal(48)]),
  actionText: z.string().min(20).max(300),
});

export const DecisionRulesSchema = z
  .array(DecisionRuleSchema)
  .min(3)
  .max(5)
  .refine(
    (rules) => {
      const kinds = new Set(rules.map((r) => r.kind));
      return kinds.has("promote") && kinds.has("hold") && kinds.has("regenerate");
    },
    { message: "decision rules must cover promote, hold, and regenerate" },
  );

export const ABVariantSchema = z
  .object({
    trigger: TitleTriggerSchema,
    signalUnderTest: SignalUnderTestSchema,
    titleText: z.string().min(1).max(120),
    titleVariantIndex: z.number().int().min(0).max(2),
    thumbnailBriefRef: TitleTriggerSchema,
    hypothesis: z.string().min(20).max(400), // a claim about audience, not a number
    predictedCtrDelta: PredictedCtrDeltaSchema,
    successMetric: z.string().min(20).max(300),
    ifThisWinsLearning: z.string().min(20).max(400),
  })
  .refine((v) => v.signalUnderTest === triggerToSignal(v.trigger), {
    message: "signalUnderTest must be derived from trigger",
  });
export type ABVariant = z.infer<typeof ABVariantSchema>;

export const ExpectedLearningSchema = z.object({
  trigger: TitleTriggerSchema,
  text: z.string().min(20).max(400),
});

export const ABPlanSchema = z.object({
  variants: z
    .tuple([ABVariantSchema, ABVariantSchema, ABVariantSchema])
    .refine((v) => new Set(v.map((x) => x.trigger)).size === 3, {
      message: "all three triggers required",
    })
    .refine((v) => new Set(v.map((x) => x.signalUnderTest)).size === 3, {
      message: "three distinct signals required",
    }),
  schedule: ScheduleSchema,
  decisionRules: DecisionRulesSchema,
  expectedLearning: z.array(ExpectedLearningSchema).length(3),
  shipDefault: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  baselineCtrBp: z.number().int().min(0).max(5000),
  baselineSource: z.enum(["channel_actual", "niche_average_fallback"]),
  sampleSizeNote: z.string().min(20).max(400),
  crossTestLearning: z.string().min(20).max(600),
  model: z.literal(AB_MODEL),
  generatedAt: z.string().datetime(),
  schemaVersion: z.literal(1),
});
export type ABPlan = z.infer<typeof ABPlanSchema>;
