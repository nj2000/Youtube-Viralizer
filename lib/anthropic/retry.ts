import Anthropic from "@anthropic-ai/sdk";

// EXT-3: max 3 retries (4 attempts total) on 429/529 only.
const BACKOFF_MS = [1000, 2000, 4000];

function isRetryable(err: unknown): boolean {
  return (
    err instanceof Anthropic.RateLimitError ||
    err instanceof Anthropic.InternalServerError ||
    (err instanceof Anthropic.APIError && err.status === 529)
  );
}

function retryAfterMs(err: unknown, fallbackMs: number): number {
  if (err instanceof Anthropic.APIError) {
    const header =
      err.headers instanceof Headers
        ? err.headers.get("retry-after")
        : (err.headers as Record<string, string> | undefined)?.["retry-after"];
    if (header) {
      const seconds = Number(header);
      if (Number.isFinite(seconds) && seconds > 0) {
        return Math.min(seconds * 1000, 30_000);
      }
    }
  }
  return fallbackMs;
}

export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < BACKOFF_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryable(err)) throw err;
      const wait = retryAfterMs(err, BACKOFF_MS[attempt]!);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  return await fn();
}
