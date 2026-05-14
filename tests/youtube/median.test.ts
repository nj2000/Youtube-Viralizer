import { describe, expect, it } from "vitest";

import { computeMedianViews } from "@/lib/youtube/median";

describe("computeMedianViews", () => {
  it("returns null + isNewChannel for empty arrays", () => {
    expect(computeMedianViews([])).toEqual({
      median: null,
      isNewChannel: true,
      lowCadence: false,
    });
  });

  it("returns mean + lowCadence for fewer than 10 entries", () => {
    expect(computeMedianViews([100, 200, 300])).toEqual({
      median: 200,
      isNewChannel: false,
      lowCadence: true,
    });
  });

  it("returns standard median for 11+ entries", () => {
    expect(computeMedianViews([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toEqual({
      median: 6,
      isNewChannel: false,
      lowCadence: false,
    });
  });

  it("averages the two middle values for even-length arrays at the threshold", () => {
    expect(
      computeMedianViews([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]),
    ).toEqual({
      median: 55,
      isNewChannel: false,
      lowCadence: false,
    });
  });

  it("handles unsorted input", () => {
    expect(
      computeMedianViews([99, 1, 50, 100, 25, 75, 10, 60, 5, 30, 80]),
    ).toEqual({
      median: 50,
      isNewChannel: false,
      lowCadence: false,
    });
  });
});
