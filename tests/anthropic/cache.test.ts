import { describe, expect, it } from "vitest";

import { MIN_CACHEABLE_TOKENS, buildSystem } from "@/lib/anthropic/cache";

describe("buildSystem (CRIT-3 cache_control threshold)", () => {
  it("adds cache_control at the 1024-token threshold", () => {
    const result = buildSystem("system prompt", MIN_CACHEABLE_TOKENS);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "text",
      text: "system prompt",
      cache_control: { type: "ephemeral" },
    });
  });

  it("omits cache_control one token below the threshold", () => {
    const result = buildSystem("system prompt", MIN_CACHEABLE_TOKENS - 1);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ type: "text", text: "system prompt" });
    expect(result[0]).not.toHaveProperty("cache_control");
  });

  it("adds cache_control well above the threshold", () => {
    const result = buildSystem("system prompt", 8192);
    expect(result[0]).toHaveProperty("cache_control", { type: "ephemeral" });
  });
});
