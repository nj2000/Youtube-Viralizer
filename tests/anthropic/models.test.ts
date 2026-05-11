import { describe, expect, it } from "vitest";

import { MODELS, modelFamily, stageModel } from "@/lib/anthropic/models";

describe("stage→model registry (CRIT-2 + Phase 1.3 task)", () => {
  it("routes reasoning-heavy stages to Opus 4.7", () => {
    expect(stageModel.competitor).toBe(MODELS.opus);
    expect(stageModel.score).toBe(MODELS.opus);
    expect(stageModel.script).toBe(MODELS.opus);
  });

  it("routes short/templated stages to Haiku 4.5", () => {
    expect(stageModel.titles).toBe(MODELS.haiku);
    expect(stageModel.hook).toBe(MODELS.haiku);
    expect(stageModel.lint).toBe(MODELS.haiku);
    expect(stageModel.thumbnails).toBe(MODELS.haiku);
    expect(stageModel.seo).toBe(MODELS.haiku);
    expect(stageModel.ab).toBe(MODELS.haiku);
    expect(stageModel.engagement).toBe(MODELS.haiku);
  });

  it("uses the documented model ID strings (no date suffixes on aliases)", () => {
    expect(MODELS.opus).toBe("claude-opus-4-7");
    expect(MODELS.sonnet).toBe("claude-sonnet-4-6");
    expect(MODELS.haiku).toBe("claude-haiku-4-5-20251001");
  });

  it("classifies model families correctly", () => {
    expect(modelFamily(MODELS.opus)).toBe("opus");
    expect(modelFamily(MODELS.sonnet)).toBe("sonnet");
    expect(modelFamily(MODELS.haiku)).toBe("haiku");
  });
});
