import { describe, expect, it } from "vitest";

import { isTooSimilar, maxPairwiseJaccard } from "@/lib/services/titles-llm";
import { canRunStage, hasLockedTitle } from "@/lib/services/pipeline-stages";
import {
  TITLES_MODEL,
  TitlesDataSchema,
  type TitleVariant,
  type TitlesData,
} from "@/lib/validation/titles";
import type { Database } from "@/lib/db/types";

type RunRow = Database["public"]["Tables"]["pipeline_runs"]["Row"];

function variant(overrides: Partial<TitleVariant> = {}): TitleVariant {
  return {
    trigger: "curiosity",
    text: "A perfectly fine title",
    charCount: 22,
    predictedCtrLift: 10,
    audienceCluster: "indie hackers",
    voiceMatch: { score: 7, label: "moderate" },
    reasoning: "Opens a knowledge gap the viewer wants closed.",
    vocabRefs: [],
    truncated: false,
    originalLength: null,
    lockedIn: false,
    userEdited: false,
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function titlesData(overrides: Partial<TitlesData> = {}): TitlesData {
  const now = new Date().toISOString();
  return {
    curiosity: variant({ trigger: "curiosity" }),
    fear: variant({ trigger: "fear", text: "Stop losing money on X" }),
    result: variant({ trigger: "result", text: "I made $10k doing X" }),
    intentRewrites: ["how to do X", "X tutorial"],
    chosenIndex: null,
    flags: {
      diversityWarning: false,
      voiceFallback: false,
      partialReturn: false,
      truncationOccurred: false,
      regenerationCount: 0,
    },
    meta: { model: TITLES_MODEL, competitorPatternsUsed: [] },
    generatedAt: now,
    updatedAt: now,
    schemaVersion: 1,
    ...overrides,
  };
}

function runRow(titles: TitlesData | null): RunRow {
  return {
    competitor_data: { x: 1 },
    score_data: { x: 1 },
    titles_data: titles as unknown as RunRow["titles_data"],
    hook_data: null,
    thumbnails_data: null,
  } as unknown as RunRow;
}

describe("maxPairwiseJaccard / isTooSimilar (diversity check)", () => {
  it("flags near-identical titles as too similar (>= 0.6)", () => {
    const titles = [
      "how to grow your channel fast",
      "how to grow your channel quickly",
      "the best way to relax at home",
    ];
    expect(maxPairwiseJaccard(titles)).toBeGreaterThanOrEqual(0.6);
    expect(isTooSimilar(titles)).toBe(true);
  });

  it("passes distinct titles", () => {
    const titles = [
      "I asked ChatGPT to do my taxes",
      "Stop wasting money on these subscriptions",
      "I built a SaaS in 48 hours — full breakdown",
    ];
    expect(maxPairwiseJaccard(titles)).toBeLessThan(0.6);
    expect(isTooSimilar(titles)).toBe(false);
  });
});

describe("hasLockedTitle / canRunStage (titles-gated fan-out)", () => {
  it("hasLockedTitle is false until a title is locked", () => {
    expect(hasLockedTitle(runRow(titlesData()))).toBe(false);
    expect(
      hasLockedTitle(
        runRow(titlesData({ curiosity: variant({ lockedIn: true }) })),
      ),
    ).toBe(true);
  });

  it("gates downstream stages on a locked title", () => {
    const noLock = runRow(titlesData());
    const locked = runRow(
      titlesData({ fear: variant({ trigger: "fear", lockedIn: true }) }),
    );
    // hook (deps: score) and thumbnails (deps: score+titles) have all their
    // data-deps satisfied by this fixture, so the only thing flipping
    // canRunStage is the locked-title gate.
    for (const stage of ["hook", "thumbnails"] as const) {
      expect(canRunStage(stage, noLock)).toBe(false);
      expect(canRunStage(stage, locked)).toBe(true);
    }
  });

  it("does not gate the score stage on titles", () => {
    expect(canRunStage("score", runRow(null))).toBe(true);
  });
});

describe("TitlesDataSchema", () => {
  it("rejects a title longer than 100 chars", () => {
    const bad = titlesData({
      curiosity: variant({ text: "x".repeat(101), charCount: 101 }),
    });
    expect(TitlesDataSchema.safeParse(bad).success).toBe(false);
  });

  it("pins the model literal", () => {
    const bad = titlesData({
      meta: { model: "claude-opus-4-7" as never, competitorPatternsUsed: [] },
    });
    expect(TitlesDataSchema.safeParse(bad).success).toBe(false);
    expect(TitlesDataSchema.safeParse(titlesData()).success).toBe(true);
  });
});
