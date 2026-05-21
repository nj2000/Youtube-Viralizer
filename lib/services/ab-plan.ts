import "server-only";

import {
  callClaude,
  extractTextFromMessage,
  buildSystem,
} from "@/lib/anthropic";
import type { Database, Json } from "@/lib/db/types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { readAbPlanData, writeAbPlanData } from "@/lib/db/ab-plan";
import {
  AB_PLAN_SYSTEM,
  AB_PLAN_SYSTEM_EST_TOKENS,
  buildAbPlanUserPrompt,
  buildAbVariantUserPrompt,
  type AbArm,
} from "@/lib/prompts/ab-plan";
import {
  AB_MODEL,
  ABPlanSchema,
  triggerToSignal,
  type ABPlan,
  type ABVariant,
} from "@/lib/validation/ab-plan";
import { ThumbnailsDataSchema } from "@/lib/validation/thumbnails";
import {
  TRIGGER_ORDER,
  TitlesDataSchema,
  type TitleTrigger,
} from "@/lib/validation/titles";
import { publish } from "@/lib/services/pipeline-bus";
import {
  registerStageHandler,
  type StageContext,
} from "@/lib/services/pipeline-stages";
import { MissingDependencyError } from "./errors";
import { computeBaselineCtr } from "./ab-baseline";

export class MissingAbPrereqError extends Error {
  constructor(reason: string) {
    super(`a/b plan prerequisites not met: ${reason}`);
    this.name = "MissingAbPrereqError";
  }
}
export class InvalidAbPlanError extends Error {
  constructor() {
    super("a/b plan model output failed validation twice");
    this.name = "InvalidAbPlanError";
  }
}

export function abPlanErrorCode(err: unknown): string {
  if (err instanceof MissingAbPrereqError || err instanceof MissingDependencyError) {
    return "MISSING_PREREQUISITES";
  }
  return "UPSTREAM_ERROR";
}

// Structural scaffolding is deterministic (guarantees the schema refines pass);
// the model only writes per-arm reasoning.
const SCHEDULE: ABPlan["schedule"] = [
  { hour: 0, label: "Publish", action: "YouTube auto-rotates the 3 variants — no action needed.", decisionGate: false },
  { hour: 12, label: "First read", action: "Glance at impressions, but don't act — it's too early for a reliable signal.", decisionGate: false },
  { hour: 24, label: "Majority decision", action: "If one variant leads CTR by ≥10% with enough impressions, lock it in; otherwise wait.", decisionGate: true },
  { hour: 48, label: "Final", action: "Sample size is sufficient — promote the winner and log the learning.", decisionGate: true },
];

const DECISION_RULES: ABPlan["decisionRules"] = [
  { kind: "promote", conditionText: "One variant's CTR beats the others by ≥10% with at least 2,500 impressions per variant.", threshold: [{ metric: "ctr_lift_pct", operator: ">=", value: 10 }, { metric: "impressions_per_variant", operator: ">=", value: 2500 }], evaluateAtHour: 24, actionText: "Promote that variant; retire the others." },
  { kind: "hold", conditionText: "Variants are within 3% CTR of each other at the gate.", threshold: [{ metric: "ctr_lift_pct", operator: "<", value: 3 }], evaluateAtHour: 24, actionText: "Ship the result variant (default) and log the test inconclusive." },
  { kind: "regenerate", conditionText: "All three variants underperform the channel baseline by ≥15%.", threshold: [{ metric: "ctr_delta_vs_baseline_pct", operator: "<=", value: -15 }], evaluateAtHour: 48, actionText: "Regenerate titles and thumbnails — the idea's framing may be off." },
];

type Ctx = { arms: AbArm[]; niche: string; baselineCtrBp: number; baselineSource: ABPlan["baselineSource"]; titles: Record<TitleTrigger, string> };

function thumbSummary(brief: { composition: string; overlayText: { text: string } }): string {
  return `${brief.composition} | overlay: "${brief.overlayText.text}"`;
}

async function buildContext(ctx: StageContext): Promise<Ctx> {
  const titles = TitlesDataSchema.safeParse(ctx.run.titles_data);
  if (!titles.success) throw new MissingAbPrereqError("titles_data missing");
  const thumbs = ThumbnailsDataSchema.safeParse(ctx.run.thumbnails_data);
  if (!thumbs.success) throw new MissingAbPrereqError("thumbnails_data missing");

  const titleText = {} as Record<TitleTrigger, string>;
  const arms: AbArm[] = [];
  for (const trigger of TRIGGER_ORDER) {
    const t = titles.data[trigger];
    const b = thumbs.data[trigger];
    if (!t || !b) {
      throw new MissingAbPrereqError(`need a title + thumbnail for all 3 triggers (missing ${trigger})`);
    }
    titleText[trigger] = t.text;
    arms.push({ trigger, title: t.text, thumbnail: thumbSummary(b) });
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("channels")
    .select("niche, subscriber_count, median_views")
    .eq("id", ctx.run.channel_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  const baseline = computeBaselineCtr({
    subscriberCount: data?.subscriber_count ?? null,
    medianViews: data?.median_views ?? null,
  });
  return { arms, niche: data?.niche ?? "", titles: titleText, ...baseline };
}

function parse(text: string): Record<string, unknown> | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  try {
    const v = JSON.parse(cleaned);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function str(value: unknown, min: number, max: number, fallback: string): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (s.length < min) return fallback;
  return s.slice(0, max);
}

// Build a full, schema-valid ABVariant for one trigger from the model's raw
// reasoning (immutable fields come from the inputs, never the model).
function buildVariant(
  trigger: TitleTrigger,
  raw: Record<string, unknown> | undefined,
  titleText: string,
): ABVariant {
  const delta = (raw?.predictedCtrDelta ?? {}) as Record<string, unknown>;
  const minBp = clampInt(delta.minBp, -2000, 2000, -100);
  const maxBp = clampInt(delta.maxBp, minBp, 2000, Math.max(minBp, 600));
  return {
    trigger,
    signalUnderTest: triggerToSignal(trigger),
    titleText: titleText.slice(0, 120),
    titleVariantIndex: TRIGGER_ORDER.indexOf(trigger),
    thumbnailBriefRef: trigger,
    hypothesis: str(raw?.hypothesis, 20, 400, `Tests whether the ${trigger} framing matches what this audience actually clicks, versus the channel's usual angle.`),
    predictedCtrDelta: { minBp, maxBp },
    successMetric: str(raw?.successMetric, 20, 300, `Beats the channel baseline CTR with at least 2,500 impressions on this arm.`),
    ifThisWinsLearning: str(raw?.ifThisWinsLearning, 20, 400, `Lean into ${trigger}-framed packaging on the next several videos.`),
  };
}

function rawByTrigger(raw: Record<string, unknown> | null): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  const arr = Array.isArray(raw?.variants) ? raw!.variants : [];
  for (const v of arr) {
    if (v && typeof v === "object") {
      const t = (v as Record<string, unknown>).trigger;
      if (typeof t === "string") map.set(t, v as Record<string, unknown>);
    }
  }
  return map;
}

function assemble(c: Ctx, raw: Record<string, unknown> | null): ABPlan {
  const byTrigger = rawByTrigger(raw);
  const variants = TRIGGER_ORDER.map((t) => buildVariant(t, byTrigger.get(t), c.titles[t])) as [
    ABVariant,
    ABVariant,
    ABVariant,
  ];
  const expectedLearning = TRIGGER_ORDER.map((t) => {
    const found = Array.isArray(raw?.expectedLearning)
      ? (raw!.expectedLearning as unknown[]).find(
          (e) => e && typeof e === "object" && (e as Record<string, unknown>).trigger === t,
        )
      : undefined;
    return {
      trigger: t,
      text: str((found as Record<string, unknown>)?.text, 20, 400, `What a ${t} win would tell you about this audience's click behavior.`),
    };
  });
  const shipTrigger = typeof raw?.shipDefault === "string" && TRIGGER_ORDER.includes(raw.shipDefault as TitleTrigger)
    ? (raw.shipDefault as TitleTrigger)
    : "result";
  const shipDefault = TRIGGER_ORDER.indexOf(shipTrigger) as 0 | 1 | 2;

  return {
    variants,
    schedule: SCHEDULE,
    decisionRules: DECISION_RULES,
    expectedLearning,
    shipDefault,
    baselineCtrBp: c.baselineCtrBp,
    baselineSource: c.baselineSource,
    sampleSizeNote: str(raw?.sampleSizeNote, 20, 400, "At your channel's velocity, expect a few thousand impressions per variant by hour 48 — enough to read a 10%+ delta, but not a sub-5% one."),
    crossTestLearning: str(raw?.crossTestLearning, 20, 600, "This test includes one on-voice arm and two stretch arms, so the result tells you whether your usual framing is a real audience preference or just a habit."),
    model: AB_MODEL,
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
  };
}

export async function abPlanStageHandler(ctx: StageContext): Promise<Json> {
  const c = await buildContext(ctx);
  const system = buildSystem(AB_PLAN_SYSTEM, AB_PLAN_SYSTEM_EST_TOKENS);
  await publish(ctx.runId, { event: "progress", payload: { stage: 11, message: "Framing 3 hypotheses + decision rules…" } });

  const userPrompt = buildAbPlanUserPrompt({ arms: c.arms, niche: c.niche, baselineCtrBp: c.baselineCtrBp });
  const first = await callClaude({ stage: "ab", system, messages: [{ role: "user", content: userPrompt }], maxTokens: 1600 });
  let plan = ABPlanSchema.safeParse(assemble(c, parse(extractTextFromMessage(first))));
  if (!plan.success) {
    const retry = await callClaude({ stage: "ab", system, messages: [{ role: "user", content: userPrompt }], maxTokens: 1600 });
    plan = ABPlanSchema.safeParse(assemble(c, parse(extractTextFromMessage(retry))));
    if (!plan.success) throw new InvalidAbPlanError();
  }
  return plan.data as unknown as Json;
}

// --- Per-variant regenerate (preserves the other two + immutable fields) ---

export async function regenerateAbVariant(args: {
  runId: string;
  userId: string;
  run: Database["public"]["Tables"]["pipeline_runs"]["Row"];
  variantIndex: 0 | 1 | 2;
}): Promise<ABPlan> {
  const existing = await readAbPlanData({ runId: args.runId, userId: args.userId });
  if (!existing) throw new MissingAbPrereqError("no a/b plan to regenerate");
  const c = await buildContext({ runId: args.runId, userId: args.userId, run: args.run });

  const trigger = TRIGGER_ORDER[args.variantIndex]!;
  const arm = c.arms.find((a) => a.trigger === trigger)!;
  const system = buildSystem(AB_PLAN_SYSTEM, AB_PLAN_SYSTEM_EST_TOKENS);
  const msg = await callClaude({
    stage: "ab",
    system,
    messages: [{ role: "user", content: buildAbVariantUserPrompt({ arm, niche: c.niche, baselineCtrBp: c.baselineCtrBp }) }],
    maxTokens: 700,
  });
  const fresh = buildVariant(trigger, rawByTrigger(parse(extractTextFromMessage(msg))).get(trigger), c.titles[trigger]);

  const variants = existing.variants.map((v, i) => (i === args.variantIndex ? fresh : v)) as [
    ABVariant,
    ABVariant,
    ABVariant,
  ];
  const next: ABPlan = { ...existing, variants, generatedAt: new Date().toISOString() };
  const validated = ABPlanSchema.parse(next);
  await writeAbPlanData({ runId: args.runId, userId: args.userId }, validated);
  return validated;
}

registerStageHandler("ab", abPlanStageHandler);
