import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({}),
}));

vi.mock("@/lib/db/youtube-quota", () => ({
  getTodayUsage: vi.fn(),
  incrementTodayUsage: vi.fn(),
}));

import * as db from "@/lib/db/youtube-quota";
import { QuotaExceededError } from "@/lib/youtube/errors";
import { assertHeadroom, DAILY_SOFT_CAP } from "@/lib/youtube/quota";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assertHeadroom (EXT-2 quota soft cap)", () => {
  it("uses the documented 8000-unit soft cap", () => {
    expect(DAILY_SOFT_CAP).toBe(8000);
  });

  it("throws QuotaExceededError when used=7950 and requested=100", async () => {
    vi.mocked(db.getTodayUsage).mockResolvedValue(7950);
    await expect(assertHeadroom(100)).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it("does not throw when used+requested equals the cap exactly", async () => {
    vi.mocked(db.getTodayUsage).mockResolvedValue(7900);
    await expect(assertHeadroom(100)).resolves.toBeUndefined();
  });

  it("throws when used+requested would exceed the cap by one unit", async () => {
    vi.mocked(db.getTodayUsage).mockResolvedValue(7901);
    await expect(assertHeadroom(100)).rejects.toBeInstanceOf(QuotaExceededError);
  });
});
