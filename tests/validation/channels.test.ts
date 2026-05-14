import { describe, expect, it } from "vitest";

import {
  CompetitorSchema,
  TopVideoSchema,
  TopVideosSchema,
} from "@/lib/validation/channels";

describe("TopVideoSchema videoId regex", () => {
  it("accepts 11-character ids with word chars and dashes", () => {
    const parsed = TopVideoSchema.safeParse({
      videoId: "dQw4w9WgXcQ",
      title: "Test",
      viewCount: 100,
      publishedAt: "2026-01-01T00:00:00Z",
      durationSec: 120,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects ids shorter than 11 chars", () => {
    const parsed = TopVideoSchema.safeParse({
      videoId: "short",
      title: "Test",
      viewCount: 100,
      publishedAt: "2026-01-01T00:00:00Z",
      durationSec: 120,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects ids longer than 11 chars", () => {
    const parsed = TopVideoSchema.safeParse({
      videoId: "dQw4w9WgXcQ-extra",
      title: "Test",
      viewCount: 100,
      publishedAt: "2026-01-01T00:00:00Z",
      durationSec: 120,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects ids with disallowed characters", () => {
    const parsed = TopVideoSchema.safeParse({
      videoId: "dQw4w9WgXc!",
      title: "Test",
      viewCount: 100,
      publishedAt: "2026-01-01T00:00:00Z",
      durationSec: 120,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("TopVideosSchema array cap", () => {
  function makeTopVideo(seed: number) {
    const id = `vid${String(seed).padStart(8, "0")}`;
    return {
      videoId: id,
      title: `Video ${seed}`,
      viewCount: seed * 100,
      publishedAt: "2026-01-01T00:00:00Z",
      durationSec: 120,
    };
  }

  it("accepts exactly 50 entries", () => {
    const arr = Array.from({ length: 50 }, (_, i) => makeTopVideo(i));
    expect(TopVideosSchema.safeParse(arr).success).toBe(true);
  });

  it("rejects 51 entries", () => {
    const arr = Array.from({ length: 51 }, (_, i) => makeTopVideo(i));
    expect(TopVideosSchema.safeParse(arr).success).toBe(false);
  });
});

describe("CompetitorSchema youtubeChannelId regex", () => {
  function makeCompetitor(id: string) {
    return {
      youtubeChannelId: id,
      handle: null,
      title: "Test",
      subscriberCount: null,
      medianViews: null,
      source: "auto" as const,
    };
  }

  it("accepts a 24-character UC… id", () => {
    expect(
      CompetitorSchema.safeParse(
        makeCompetitor("UCBJycsmduvYEL83R_U4JriQ"),
      ).success,
    ).toBe(true);
  });

  it("rejects ids missing the UC prefix", () => {
    expect(
      CompetitorSchema.safeParse(makeCompetitor("XXBJycsmduvYEL83R_U4JriQ"))
        .success,
    ).toBe(false);
  });

  it("rejects ids shorter than 24 chars", () => {
    expect(
      CompetitorSchema.safeParse(makeCompetitor("UCshort")).success,
    ).toBe(false);
  });
});
