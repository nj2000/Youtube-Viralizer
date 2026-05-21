import { describe, expect, it } from "vitest";

import { buildSystem, MIN_CACHEABLE_TOKENS, stageModel } from "@/lib/anthropic";
import {
  SEO_DESCRIPTION_EST_TOKENS,
  SEO_DESCRIPTION_SYSTEM,
  SEO_TAGS_EST_TOKENS,
} from "@/lib/prompts/seo";
import { chaptersAreFallback, deriveChapters } from "@/lib/services/seo-chapters";
import {
  applyDisclosures,
  complianceDisclaimerFor,
  FTC_DISCLOSURE,
} from "@/lib/services/seo-compliance";
import {
  ChaptersSchema,
  HashtagsSchema,
  SEO_MODEL,
  TagsSchema,
} from "@/lib/validation/seo";
import type { ScriptData } from "@/lib/validation/script";

function script(starts: number[], totalSec: number): ScriptData {
  return {
    sections: starts.map((s, i) => ({
      index: i,
      role: i === 0 ? "cold_open" : "demonstration",
      title: `Chapter ${i}`,
      startSec: s,
      endSec: s + 10,
      paragraphs: [],
      brollCues: [],
      retentionRehook: null,
      predictedRetention: 70,
    })),
    estimatedRuntimeSec: totalSec,
  } as unknown as ScriptData;
}

describe("deriveChapters — deterministic", () => {
  it("returns synchronously (no LLM) with first chapter at 0:00", () => {
    const chs = deriveChapters(script([0, 60, 120, 240], 600));
    expect(Array.isArray(chs)).toBe(true);
    expect(chs[0]!.timeSec).toBe(0);
    expect(ChaptersSchema.safeParse(chs).success).toBe(true);
  });

  it("enforces a ≥10s gap (merges too-close boundaries)", () => {
    const chs = deriveChapters(script([0, 5, 20, 40, 60], 600));
    // the 5s boundary collapses into 0
    expect(chs.map((c) => c.timeSec)).toEqual([0, 20, 40, 60]);
  });

  it("caps short-form (<5min) videos at 3 chapters", () => {
    const chs = deriveChapters(script([0, 40, 90, 150, 200], 240));
    expect(chs).toHaveLength(3);
    expect(chs[0]!.timeSec).toBe(0);
  });

  it("falls back to a 4-chapter structure when <3 sections", () => {
    const chs = deriveChapters(script([0, 30], 600));
    expect(chs.length).toBeGreaterThanOrEqual(3);
    expect(chaptersAreFallback(chs)).toBe(true);
    expect(chs[0]!.timeSec).toBe(0);
  });
});

describe("ChaptersSchema", () => {
  it("requires the first chapter at 0:00", () => {
    const bad = [
      { timeSec: 10, label: "Intro here", fallback: false },
      { timeSec: 40, label: "Middle bit", fallback: false },
      { timeSec: 80, label: "The ending", fallback: false },
    ];
    expect(ChaptersSchema.safeParse(bad).success).toBe(false);
  });
});

describe("TagsSchema", () => {
  const eight = (n: number) => Array.from({ length: n }, (_, i) => `tag number ${i}`);
  it("keeps a max-size valid set within the 500-char join limit", () => {
    const max = Array.from({ length: 15 }, (_, i) => `${"x".repeat(26)} ${i}`);
    const parsed = TagsSchema.safeParse(max);
    expect(parsed.success).toBe(true);
    expect(max.join(",").length).toBeLessThanOrEqual(500);
  });
  it("rejects case-insensitive duplicates", () => {
    expect(TagsSchema.safeParse([...eight(8).slice(0, 7), "Tag Number 0"]).success).toBe(false);
  });
  it("accepts a valid 8-tag set", () => {
    expect(TagsSchema.safeParse(eight(8)).success).toBe(true);
  });
});

describe("HashtagsSchema", () => {
  it("requires exactly 3 primary + 5 optional", () => {
    const ok = {
      primary: ["#a", "#b", "#c"],
      optional: ["#d", "#e", "#f", "#g", "#h"],
    };
    expect(HashtagsSchema.safeParse(ok).success).toBe(true);
    expect(HashtagsSchema.safeParse({ ...ok, primary: ["#a", "#b"] }).success).toBe(false);
    expect(HashtagsSchema.safeParse({ ...ok, optional: ["#d"] }).success).toBe(false);
  });
});

describe("disclosures (FTC + compliance)", () => {
  const body = "Here is a normal description body that is comfortably over the minimum length for the schema.";

  it("prepends the FTC disclosure when sponsored (body starts with it)", () => {
    const r = applyDisclosures(body, { isSponsored: true, niche: "tech" });
    expect(r.body.startsWith(FTC_DISCLOSURE)).toBe(true);
    expect(r.sponsoredDisclosure).toBe(true);
    expect(r.complianceDisclaimer).toBe(false);
  });

  it("appends a niche disclaimer for finance/medical", () => {
    expect(complianceDisclaimerFor("personal finance & investing")).not.toBeNull();
    expect(complianceDisclaimerFor("health and fitness")).not.toBeNull();
    expect(complianceDisclaimerFor("cooking")).toBeNull();
    const r = applyDisclosures(body, { isSponsored: false, niche: "investing" });
    expect(r.complianceDisclaimer).toBe(true);
    expect(r.body.startsWith(FTC_DISCLOSURE)).toBe(false);
  });
});

describe("model routing + cache", () => {
  it("routes SEO to Haiku 4.5 (CRIT-2)", () => {
    expect(stageModel.seo).toBe("claude-haiku-4-5-20251001");
    expect(stageModel.seo).toBe(SEO_MODEL);
  });

  it("caches the large section prompts (CRIT-3)", () => {
    expect(SEO_DESCRIPTION_EST_TOKENS).toBeGreaterThanOrEqual(MIN_CACHEABLE_TOKENS);
    expect(SEO_TAGS_EST_TOKENS).toBeGreaterThanOrEqual(MIN_CACHEABLE_TOKENS);
    const block = buildSystem(SEO_DESCRIPTION_SYSTEM, SEO_DESCRIPTION_EST_TOKENS)[0]!;
    expect(block.cache_control).toEqual({ type: "ephemeral" });
  });
});
