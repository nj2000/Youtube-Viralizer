import { describe, expect, it } from "vitest";

import { DOWNSTREAM, STAGE_NUMBER } from "@/lib/services/pipeline-stages";

describe("DOWNSTREAM cascade map", () => {
  it("re-running stage 5 (titles) marks stages 6, 7, 8, 10, 12 stale (verification matrix)", () => {
    const downstreamNumbers = DOWNSTREAM.titles.map(
      (s) => STAGE_NUMBER[s],
    );
    expect(downstreamNumbers.sort((a, b) => a - b)).toEqual([6, 7, 8, 10, 12]);
  });

  it("re-running stage 6 (hook) marks stages 7, 8, 12 stale (spec §5.6)", () => {
    const downstreamNumbers = DOWNSTREAM.hook.map((s) => STAGE_NUMBER[s]);
    expect(downstreamNumbers.sort((a, b) => a - b)).toEqual([7, 8, 12]);
  });

  it("re-running stage 7 (script) marks stages 8, 10, 12 stale (spec §5.6)", () => {
    const downstreamNumbers = DOWNSTREAM.script.map((s) => STAGE_NUMBER[s]);
    expect(downstreamNumbers.sort((a, b) => a - b)).toEqual([8, 10, 12]);
  });

  it("terminal stages (lint/seo/ab/engagement) have no downstream", () => {
    expect(DOWNSTREAM.lint).toEqual([]);
    expect(DOWNSTREAM.seo).toEqual([]);
    expect(DOWNSTREAM.ab).toEqual([]);
    expect(DOWNSTREAM.engagement).toEqual([]);
  });

  it("re-running stage 9 (thumbnails) marks only stage 11 (ab) stale", () => {
    expect(DOWNSTREAM.thumbnails).toEqual(["ab"]);
  });

  it("re-running stage 3 (competitor) marks everything below stale", () => {
    const downstreamNumbers = DOWNSTREAM.competitor
      .map((s) => STAGE_NUMBER[s])
      .sort((a, b) => a - b);
    expect(downstreamNumbers).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });
});
