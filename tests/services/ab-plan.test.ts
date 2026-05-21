import { describe, expect, it } from "vitest";

import { buildSystem, MIN_CACHEABLE_TOKENS, stageModel } from "@/lib/anthropic";
import { AB_PLAN_SYSTEM, AB_PLAN_SYSTEM_EST_TOKENS } from "@/lib/prompts/ab-plan";
import {
  computeBaselineCtr,
  NICHE_AVERAGE_FALLBACK_BP,
} from "@/lib/services/ab-baseline";
import {
  AB_MODEL,
  ABPlanSchema,
  ABVariantSchema,
  DecisionRulesSchema,
  PredictedCtrDeltaSchema,
  ScheduleSchema,
  triggerToSignal,
  type ABVariant,
  type DecisionRuleKind,
} from "@/lib/validation/ab-plan";

const SIGNAL = {
  curiosity: "information_seeking",
  fear: "loss_aversion",
  result: "practicality",
} as const;

function variant(trigger: "curiosity" | "fear" | "result", i: number): ABVariant {
  return {
    trigger,
    signalUnderTest: SIGNAL[trigger],
    titleText: `A ${trigger} title`,
    titleVariantIndex: i,
    thumbnailBriefRef: trigger,
    hypothesis: "Tests whether this audience clicks this framing reliably.",
    predictedCtrDelta: { minBp: -100, maxBp: 600 },
    successMetric: "Beats the channel baseline CTR with 2,500+ impressions.",
    ifThisWinsLearning: "Lean into this framing on the next several videos.",
  };
}

function step(hour: 0 | 12 | 24 | 48, gate: boolean) {
  return { hour, label: `H${hour}`, action: "Do the thing at this checkpoint, carefully.", decisionGate: gate };
}

function rule(kind: DecisionRuleKind) {
  return {
    kind,
    conditionText: "Some clearly-worded condition that is long enough to pass.",
    threshold: [{ metric: "ctr_lift_pct" as const, operator: ">=" as const, value: 10 }],
    evaluateAtHour: 24 as const,
    actionText: "Take this clearly-worded action when the condition holds.",
  };
}

function plan() {
  return {
    variants: [variant("curiosity", 0), variant("fear", 1), variant("result", 2)],
    schedule: [step(0, false), step(12, false), step(24, true), step(48, true)],
    decisionRules: [rule("promote"), rule("hold"), rule("regenerate")],
    expectedLearning: (["curiosity", "fear", "result"] as const).map((t) => ({
      trigger: t,
      text: "What a win for this arm would teach about the audience.",
    })),
    shipDefault: 2 as const,
    baselineCtrBp: 620,
    baselineSource: "niche_average_fallback" as const,
    sampleSizeNote: "Expect a few thousand impressions per variant by hour 48.",
    crossTestLearning: "The test reveals whether the usual framing is a real preference or a habit.",
    model: AB_MODEL,
    generatedAt: new Date().toISOString(),
    schemaVersion: 1 as const,
  };
}

describe("triggerToSignal", () => {
  it("maps each trigger to its fixed signal", () => {
    expect(triggerToSignal("curiosity")).toBe("information_seeking");
    expect(triggerToSignal("fear")).toBe("loss_aversion");
    expect(triggerToSignal("result")).toBe("practicality");
  });
});

describe("PredictedCtrDeltaSchema", () => {
  it("rejects float basis points", () => {
    expect(PredictedCtrDeltaSchema.safeParse({ minBp: 8.5, maxBp: 14 }).success).toBe(false);
  });
  it("rejects minBp > maxBp", () => {
    expect(PredictedCtrDeltaSchema.safeParse({ minBp: 600, maxBp: 100 }).success).toBe(false);
  });
  it("accepts integer ranges", () => {
    expect(PredictedCtrDeltaSchema.safeParse({ minBp: -100, maxBp: 600 }).success).toBe(true);
  });
});

describe("ScheduleSchema", () => {
  it("requires hours 0,12,24,48 in order", () => {
    expect(ScheduleSchema.safeParse([step(0, false), step(12, false), step(24, true), step(48, true)]).success).toBe(true);
    // wrong final hour
    const bad = [step(0, false), step(12, false), step(24, true), { ...step(48, true), hour: 36 }];
    expect(ScheduleSchema.safeParse(bad).success).toBe(false);
  });
});

describe("DecisionRulesSchema", () => {
  it("requires all three kinds", () => {
    expect(DecisionRulesSchema.safeParse([rule("promote"), rule("hold"), rule("regenerate")]).success).toBe(true);
    expect(DecisionRulesSchema.safeParse([rule("promote"), rule("promote"), rule("hold")]).success).toBe(false);
  });
});

describe("ABVariantSchema", () => {
  it("rejects a signal that doesn't match the trigger", () => {
    expect(
      ABVariantSchema.safeParse({ ...variant("fear", 1), signalUnderTest: "information_seeking" }).success,
    ).toBe(false);
  });
});

describe("ABPlanSchema", () => {
  it("accepts a well-formed plan", () => {
    expect(ABPlanSchema.safeParse(plan()).success).toBe(true);
  });
  it("requires 3 distinct triggers", () => {
    const dup = plan();
    dup.variants[1] = variant("curiosity", 0);
    expect(ABPlanSchema.safeParse(dup).success).toBe(false);
  });
});

describe("computeBaselineCtr", () => {
  it("uses the niche fallback for new channels", () => {
    const r = computeBaselineCtr({ subscriberCount: null, medianViews: null });
    expect(r.baselineCtrBp).toBe(NICHE_AVERAGE_FALLBACK_BP);
    expect(r.baselineSource).toBe("niche_average_fallback");
  });
  it("derives a clamped channel_actual baseline when data exists", () => {
    const r = computeBaselineCtr({ subscriberCount: 10000, medianViews: 5000 });
    expect(r.baselineSource).toBe("channel_actual");
    expect(r.baselineCtrBp).toBeGreaterThanOrEqual(100);
    expect(r.baselineCtrBp).toBeLessThanOrEqual(3000);
  });
});

describe("model routing + cache", () => {
  it("routes A/B to Haiku 4.5 (CRIT-2)", () => {
    expect(stageModel.ab).toBe("claude-haiku-4-5-20251001");
    expect(stageModel.ab).toBe(AB_MODEL);
  });
  it("caches the system prompt (CRIT-3)", () => {
    expect(AB_PLAN_SYSTEM_EST_TOKENS).toBeGreaterThanOrEqual(MIN_CACHEABLE_TOKENS);
    const block = buildSystem(AB_PLAN_SYSTEM, AB_PLAN_SYSTEM_EST_TOKENS)[0]!;
    expect(block.cache_control).toEqual({ type: "ephemeral" });
  });
});
