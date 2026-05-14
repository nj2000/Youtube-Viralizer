import { describe, expect, it } from "vitest";

import { mergeCompetitors } from "@/lib/services/onboard-merge";
import type { Competitor } from "@/lib/validation/channels";

function makeCompetitor(
  youtubeChannelId: string,
  source: "auto" | "manual",
): Competitor {
  return {
    youtubeChannelId,
    handle: youtubeChannelId.toLowerCase(),
    title: youtubeChannelId,
    subscriberCount: null,
    medianViews: null,
    source,
  };
}

describe("mergeCompetitors", () => {
  it("returns incoming when existing is empty", () => {
    const incoming = [
      makeCompetitor("UCaaaaaaaaaaaaaaaaaaaaaa", "auto"),
      makeCompetitor("UCbbbbbbbbbbbbbbbbbbbbbb", "auto"),
    ];
    expect(mergeCompetitors([], incoming)).toEqual(incoming);
  });

  it("preserves manual entries from existing that are not in incoming", () => {
    const existing = [
      makeCompetitor("UCaaaaaaaaaaaaaaaaaaaaaa", "auto"),
      makeCompetitor("UCmanualxxxxxxxxxxxxxxx", "manual"),
    ];
    const incoming = [
      makeCompetitor("UCccccccccccccccccccccc1", "auto"),
      makeCompetitor("UCddddddddddddddddddddd1", "auto"),
    ];
    const merged = mergeCompetitors(existing, incoming);
    expect(merged.map((c) => c.youtubeChannelId)).toEqual([
      "UCccccccccccccccccccccc1",
      "UCddddddddddddddddddddd1",
      "UCmanualxxxxxxxxxxxxxxx",
    ]);
  });

  it("drops existing auto entries that are absent from incoming", () => {
    const existing = [makeCompetitor("UCaaaaaaaaaaaaaaaaaaaaaa", "auto")];
    const incoming = [makeCompetitor("UCbbbbbbbbbbbbbbbbbbbbbb", "auto")];
    const merged = mergeCompetitors(existing, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.youtubeChannelId).toBe("UCbbbbbbbbbbbbbbbbbbbbbb");
  });

  it("does not duplicate when manual entry also appears in incoming", () => {
    const sameId = "UCmanualxxxxxxxxxxxxxxx";
    const existing = [makeCompetitor(sameId, "manual")];
    const incoming = [makeCompetitor(sameId, "auto")];
    const merged = mergeCompetitors(existing, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.source).toBe("auto");
  });

  it("caps the merged set at 20 entries", () => {
    const existing: Competitor[] = Array.from({ length: 15 }, (_, i) =>
      makeCompetitor(`UCmanual${String(i).padStart(15, "x")}`, "manual"),
    );
    const incoming: Competitor[] = Array.from({ length: 15 }, (_, i) =>
      makeCompetitor(`UCauto${String(i).padStart(17, "x")}`, "auto"),
    );
    const merged = mergeCompetitors(existing, incoming);
    expect(merged).toHaveLength(20);
    // First 15 come from incoming; the remaining 5 from existing manual.
    expect(merged.slice(0, 15).every((c) => c.source === "auto")).toBe(true);
    expect(merged.slice(15).every((c) => c.source === "manual")).toBe(true);
  });
});
