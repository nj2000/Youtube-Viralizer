import { describe, expect, it } from "vitest";

import { buildSystem, MIN_CACHEABLE_TOKENS, stageModel } from "@/lib/anthropic";
import {
  THUMBNAILS_SYSTEM,
  THUMBNAILS_SYSTEM_EST_TOKENS,
} from "@/lib/prompts/thumbnails";
import { stageDependencies } from "@/lib/services/pipeline-stages";
import {
  anyBriefsCollide,
  briefsCollide,
  contrastRatio,
  enforceOverlayContrast,
  wordCountOf,
} from "@/lib/services/thumbnails-palette";
import {
  HexColorSchema,
  THUMBNAILS_MODEL,
  ThumbnailBriefSchema,
  type PaletteSwatch,
  type ThumbnailBrief,
} from "@/lib/validation/thumbnails";

function palette(): PaletteSwatch[] {
  return [
    { hex: "#1a1a2e", role: "background" },
    { hex: "#ffffff", role: "contrast" },
    { hex: "#a855f7", role: "primary" },
    { hex: "#ffd700", role: "accent" },
  ];
}

function brief(overrides: Partial<ThumbnailBrief> = {}): ThumbnailBrief {
  return {
    trigger: "curiosity",
    pairsWithTitle: "Inside the AI App That Hit $1B",
    composition: "50/50 split, face on the left third looking toward the headline.",
    focalPoint: "middle-right",
    characterPlacement: "left-third",
    facialExpression: "wide-eyed disbelief, mouth open, glancing right",
    palette: palette(),
    backgroundConcept: "Dark indigo gradient with a gold radial glow behind the face.",
    overlayText: { text: "ONE BILLION IN A DAY", wordCount: 5, color: "#ffffff" },
    styleChips: ["high-contrast-bold", "type-driven"],
    whyItWorks: "Closes the curiosity loop visually so viewers click to resolve it.",
    feasibilityFlags: {
      requiresCreatorFace: true,
      requiresStockAsset: false,
      typeDrivenOnly: false,
    },
    truncationOccurred: false,
    generatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("HexColorSchema", () => {
  it("accepts lowercase 6-char hex, rejects malformed", () => {
    expect(HexColorSchema.safeParse("#1a2b3c").success).toBe(true);
    expect(HexColorSchema.safeParse("#abcdef0").success).toBe(false); // 7 chars
    expect(HexColorSchema.safeParse("abc").success).toBe(false); // no #
    expect(HexColorSchema.safeParse("#ABCDEF").success).toBe(false); // uppercase
  });
});

describe("ThumbnailBriefSchema", () => {
  it("accepts a well-formed brief", () => {
    expect(ThumbnailBriefSchema.safeParse(brief()).success).toBe(true);
  });

  it("rejects a palette without exactly 4 swatches", () => {
    expect(
      ThumbnailBriefSchema.safeParse(brief({ palette: palette().slice(0, 3) }))
        .success,
    ).toBe(false);
  });

  it("rejects duplicate palette roles", () => {
    const dup = palette();
    dup[1] = { hex: "#222222", role: "primary" }; // two 'primary'
    expect(ThumbnailBriefSchema.safeParse(brief({ palette: dup })).success).toBe(
      false,
    );
  });

  it("requires overlay color to be one of the palette swatches", () => {
    expect(
      ThumbnailBriefSchema.safeParse(
        brief({ overlayText: { text: "OFF PALETTE TEXT", wordCount: 3, color: "#123456" } }),
      ).success,
    ).toBe(false);
  });

  it("enforces facialExpression XOR characterPlacement=none", () => {
    expect(
      ThumbnailBriefSchema.safeParse(
        brief({ characterPlacement: "none", facialExpression: "smiling" }),
      ).success,
    ).toBe(false);
    expect(
      ThumbnailBriefSchema.safeParse(
        brief({ characterPlacement: "none", facialExpression: "" }),
      ).success,
    ).toBe(true);
  });

  it("bounds overlay word count to 3-5", () => {
    expect(
      ThumbnailBriefSchema.safeParse(
        brief({ overlayText: { text: "TWO WORDS", wordCount: 2, color: "#ffffff" } }),
      ).success,
    ).toBe(false);
    expect(
      ThumbnailBriefSchema.safeParse(
        brief({ overlayText: { text: "SIX WORDS HERE RIGHT NOW OK", wordCount: 6, color: "#ffffff" } }),
      ).success,
    ).toBe(false);
  });
});

describe("WCAG-AA contrast", () => {
  it("computes the standard ratio", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeGreaterThan(20);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("auto-fixes a low-contrast overlay by swapping to the best swatch", () => {
    const bad = brief({
      palette: [
        { hex: "#ffffff", role: "background" },
        { hex: "#000000", role: "contrast" },
        { hex: "#a855f7", role: "primary" },
        { hex: "#ffd700", role: "accent" },
      ],
      overlayText: { text: "LOW CONTRAST TEXT", wordCount: 3, color: "#ffffff" },
    });
    const res = enforceOverlayContrast(bad);
    expect(res.fixed).toBe(true);
    expect(res.passed).toBe(true);
    expect(res.brief.overlayText.color).toBe("#000000");
  });

  it("leaves a passing overlay untouched", () => {
    const res = enforceOverlayContrast(brief());
    expect(res.fixed).toBe(false);
    expect(res.passed).toBe(true);
  });
});

describe("diversity", () => {
  it("collides on same placement + ≥3 shared palette colors", () => {
    expect(briefsCollide(brief(), brief())).toBe(true);
    expect(
      briefsCollide(brief(), brief({ characterPlacement: "right-third" })),
    ).toBe(false);
    expect(anyBriefsCollide([brief(), brief({ characterPlacement: "center" })])).toBe(
      false,
    );
  });
});

describe("wordCountOf", () => {
  it("counts whitespace-separated words", () => {
    expect(wordCountOf("one two three")).toBe(3);
    expect(wordCountOf("  spaced   out  ")).toBe(2);
  });
});

describe("Stage 9 wiring", () => {
  it("depends only on score + titles (not hook/script)", () => {
    expect(stageDependencies.thumbnails).toEqual(["score", "titles"]);
  });

  it("routes to Haiku 4.5 (CRIT-2)", () => {
    expect(stageModel.thumbnails).toBe("claude-haiku-4-5-20251001");
    expect(stageModel.thumbnails).toBe(THUMBNAILS_MODEL);
  });

  it("system prompt is cacheable (CRIT-3)", () => {
    expect(THUMBNAILS_SYSTEM_EST_TOKENS).toBeGreaterThanOrEqual(MIN_CACHEABLE_TOKENS);
    const block = buildSystem(THUMBNAILS_SYSTEM, THUMBNAILS_SYSTEM_EST_TOKENS)[0]!;
    expect(block.cache_control).toEqual({ type: "ephemeral" });
  });
});
