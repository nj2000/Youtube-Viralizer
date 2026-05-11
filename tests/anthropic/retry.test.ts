import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withRetry } from "@/lib/anthropic/retry";

function makeRateLimit() {
  return Anthropic.APIError.generate(
    429,
    undefined,
    "rate limited",
    new Headers(),
  );
}

function makeBadRequest() {
  return Anthropic.APIError.generate(
    400,
    undefined,
    "bad request",
    new Headers(),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("withRetry (EXT-3 retry policy)", () => {
  it("retries on 429 twice, then succeeds on the third attempt", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(makeRateLimit())
      .mockRejectedValueOnce(makeRateLimit())
      .mockResolvedValueOnce("ok");

    const promise = withRetry(fn);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry on 400 — re-throws immediately", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(makeBadRequest());

    await expect(withRetry(fn)).rejects.toBeInstanceOf(Anthropic.BadRequestError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after 4 attempts of persistent 429s", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(makeRateLimit());

    const promise = withRetry(fn);
    // Surface the rejection so the unhandled-rejection guard does not fire.
    const settled = promise.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(30_000);
    const result = await settled;
    expect(result).toBeInstanceOf(Anthropic.RateLimitError);
    expect(fn).toHaveBeenCalledTimes(4);
  });
});
