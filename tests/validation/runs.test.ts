import { describe, expect, it } from "vitest";

import { IdeaTextSchema, RunsListQuerySchema } from "@/lib/validation/runs";

describe("IdeaTextSchema (preprocess trim + min/max)", () => {
  it("trims whitespace before length check, rejecting whitespace-padded short strings", () => {
    expect(IdeaTextSchema.safeParse("   hi   ").success).toBe(false);
  });

  it("accepts exactly 10 characters after trim", () => {
    const parsed = IdeaTextSchema.safeParse("1234567890");
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBe("1234567890");
  });

  it("rejects strings under 10 characters after trim", () => {
    expect(IdeaTextSchema.safeParse("nine char").success).toBe(false);
  });

  it("accepts exactly 500 characters", () => {
    const s = "a".repeat(500);
    expect(IdeaTextSchema.safeParse(s).success).toBe(true);
  });

  it("rejects 501 characters", () => {
    const s = "a".repeat(501);
    expect(IdeaTextSchema.safeParse(s).success).toBe(false);
  });

  it("rejects non-string inputs", () => {
    expect(IdeaTextSchema.safeParse(42).success).toBe(false);
    expect(IdeaTextSchema.safeParse(null).success).toBe(false);
  });
});

describe("RunsListQuerySchema", () => {
  it("defaults page to 1 when omitted", () => {
    const parsed = RunsListQuerySchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.page).toBe(1);
  });

  it("coerces string page values", () => {
    const parsed = RunsListQuerySchema.safeParse({ page: "3" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.page).toBe(3);
  });

  it("rejects unknown status values", () => {
    const parsed = RunsListQuerySchema.safeParse({ status: "bogus" });
    expect(parsed.success).toBe(false);
  });

  it("rejects q longer than 200 chars", () => {
    expect(
      RunsListQuerySchema.safeParse({ q: "a".repeat(201) }).success,
    ).toBe(false);
  });
});
