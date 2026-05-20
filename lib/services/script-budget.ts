import "server-only";

import { env } from "@/lib/env";
import {
  getThrottle,
  getTodaySpendMicroUsd,
} from "@/lib/db/script";

// Three-tier guard for the Opus 4.7 script stage (spec §9): a daily USD spend
// cap, a per-channel full-script cap, and a per-channel section-regen cap.

export const FULL_SCRIPTS_PER_DAY = 30;
export const SECTION_REGENS_PER_DAY = 60;

export class BudgetExceededError extends Error {
  constructor(readonly retryAfterSec: number) {
    super("Daily Anthropic budget exceeded");
    this.name = "BudgetExceededError";
  }
}

export class ScriptRateLimitedError extends Error {
  constructor(readonly kind: "full" | "section") {
    super(`Script ${kind} generation rate limit reached`);
    this.name = "ScriptRateLimitedError";
  }
}

function secondsUntilUtcMidnight(): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return Math.max(1, Math.round((next.getTime() - now.getTime()) / 1000));
}

export async function assertBudget(): Promise<void> {
  const capMicroUsd = Math.round(env.ANTHROPIC_DAILY_BUDGET_USD * 1_000_000);
  const spent = await getTodaySpendMicroUsd();
  if (spent >= capMicroUsd) {
    throw new BudgetExceededError(secondsUntilUtcMidnight());
  }
}

export async function assertThrottle(
  channelId: string,
  kind: "full" | "section",
): Promise<void> {
  const counts = await getThrottle(channelId);
  if (kind === "full" && counts.fullCount >= FULL_SCRIPTS_PER_DAY) {
    throw new ScriptRateLimitedError("full");
  }
  if (kind === "section" && counts.sectionCount >= SECTION_REGENS_PER_DAY) {
    throw new ScriptRateLimitedError("section");
  }
}
