import { describe, expect, it } from "vitest";

import {
  computeDropoffRisk,
  computeRetention30s,
  computeSpeakTimeSec,
  computeWarnings,
  computeWordCount,
} from "@/lib/services/hook-metrics";
import {
  HookDataSchema,
  type HookBeat,
  type HookVariant,
} from "@/lib/validation/hook";

function beat(timeSec: number, line: string | null, brollCue: string | null = null): HookBeat {
  return { timeSec, line, brollCue };
}

describe("hook metrics — word count + speak time", () => {
  it("counts words only in spoken lines, not b-roll cues", () => {
    const beats = [
      beat(0, "I asked ChatGPT to do my taxes"), // 7 words
      beat(3, null, "screen recording of the spreadsheet"),
      beat(5, "It actually worked"), // 3 words
    ];
    expect(computeWordCount(beats)).toBe(10);
  });

  it("computes speak time at 150 WPM (ceil)", () => {
    expect(computeSpeakTimeSec(75)).toBe(30); // 75/150*60 = 30
    expect(computeSpeakTimeSec(10)).toBe(4); // 4 seconds
  });
});

describe("hook metrics — retention + risk", () => {
  it("rewards a concrete promise and a strong opener", () => {
    const beats = [beat(0, "Here is what happened")];
    const withConcrete = computeRetention30s({
      archetype: "shock",
      openerStrengthRaw: 90,
      wordCount: 40,
      promise: "I made $10,000 in 30 days",
      beats,
    });
    const withoutConcrete = computeRetention30s({
      archetype: "shock",
      openerStrengthRaw: 90,
      wordCount: 40,
      promise: "I made some money over time",
      beats,
    });
    expect(withConcrete).toBeGreaterThan(withoutConcrete);
  });

  it("killer combination (over word limit + no concrete promise) forces high risk", () => {
    const warnings = computeWarnings({
      wordCount: 110,
      beats: [beat(0, "x".repeat(2))],
      promise: "a vague outcome with no anchor",
    });
    expect(warnings).toContain("OVER_WORD_LIMIT");
    expect(warnings).toContain("NO_CONCRETE_PROMISE");
    const { risk, killerCombo } = computeDropoffRisk(85, warnings);
    // Even with a high retention score, the killer combo forces high.
    expect(killerCombo).toBe(true);
    expect(risk).toBe("high");
  });

  it("maps retention to risk bands when no killer combo", () => {
    const goodWarnings = computeWarnings({
      wordCount: 40,
      beats: [beat(0, "Here is exactly how")],
      promise: "save $500 in 7 days",
    });
    expect(computeDropoffRisk(72, goodWarnings).risk).toBe("low");
    expect(computeDropoffRisk(60, goodWarnings).risk).toBe("medium");
    expect(computeDropoffRisk(40, goodWarnings).risk).toBe("high");
  });

  it("penalizes cliché openers via anti-pattern detection", () => {
    const clean = computeRetention30s({
      archetype: "shock",
      openerStrengthRaw: 70,
      wordCount: 40,
      promise: "build a SaaS in 48 hours",
      beats: [beat(0, "Most people get this completely wrong")],
    });
    const cliche = computeRetention30s({
      archetype: "shock",
      openerStrengthRaw: 70,
      wordCount: 40,
      promise: "build a SaaS in 48 hours",
      beats: [beat(0, "Hey guys welcome back to the channel")],
    });
    expect(cliche).toBeLessThan(clean);
  });
});

describe("HookDataSchema", () => {
  function variant(overrides: Partial<HookVariant> = {}): HookVariant {
    return {
      linkedTitleIndex: 0,
      archetype: "shock",
      promise: "I made $10,000 in 30 days flat",
      beats: [beat(0, "Most people get this wrong"), beat(4, "Here is why")],
      reasoning: "Opens with a counterintuitive claim that demands the payoff.",
      openerStrengthRaw: 75,
      wordCount: 9,
      speakTimeSec: 4,
      retention30sPredict: 78,
      dropoffRiskRating: "low",
      warnings: [],
      ...overrides,
    };
  }

  it("requires exactly 3 variants", () => {
    const base = {
      lockedVariantIndex: null,
      allHighRisk: false,
      lockedAt: null,
      generatedAt: new Date().toISOString(),
      model: "claude-haiku-4-5-20251001" as const,
      schemaVersion: 1 as const,
    };
    expect(
      HookDataSchema.safeParse({ ...base, variants: [variant(), variant()] })
        .success,
    ).toBe(false);
    expect(
      HookDataSchema.safeParse({
        ...base,
        variants: [
          variant({ linkedTitleIndex: 0 }),
          variant({ linkedTitleIndex: 1 }),
          variant({ linkedTitleIndex: 2 }),
        ],
      }).success,
    ).toBe(true);
  });

  it("pins the model literal", () => {
    const data = {
      variants: [variant(), variant(), variant()],
      lockedVariantIndex: null,
      allHighRisk: false,
      lockedAt: null,
      generatedAt: new Date().toISOString(),
      model: "claude-opus-4-7",
      schemaVersion: 1,
    };
    expect(HookDataSchema.safeParse(data).success).toBe(false);
  });

  it("rejects a beat with both line and brollCue", () => {
    const bad = variant({ beats: [beat(0, "a line"), { timeSec: 4, line: "x", brollCue: "y" }] });
    expect(
      HookDataSchema.safeParse({
        variants: [bad, variant(), variant()],
        lockedVariantIndex: null,
        allHighRisk: false,
        lockedAt: null,
        generatedAt: new Date().toISOString(),
        model: "claude-haiku-4-5-20251001",
        schemaVersion: 1,
      }).success,
    ).toBe(false);
  });
});
