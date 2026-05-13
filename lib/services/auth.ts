import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/types";
import { getProfile } from "@/lib/db/profiles";
import { recentSendsForEmail } from "@/lib/db/login-attempts";
import type { CallbackReason } from "@/lib/validation/auth";

type Client = SupabaseClient<Database>;

const RATE_LIMIT_MAX_SENDS_PER_HOUR = 5;
const RATE_LIMIT_WINDOW_MINUTES = 60;

export const SAFE_NEXT_PATTERN = /^\/[a-zA-Z0-9/_-]*$/;

export function isSafeNext(value: string | null | undefined): value is string {
  return typeof value === "string" && SAFE_NEXT_PATTERN.test(value);
}

export async function resolvePostAuthDestination(
  client: Client,
  userId: string,
  hint?: string | null,
): Promise<string> {
  if (isSafeNext(hint)) return hint;

  const profile = await getProfile(client, userId);
  if (!profile || profile.channel_count_cache === 0) return "/onboard";
  return "/runs";
}

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSec: number };

export async function checkSendRateLimit(
  serviceClient: Client,
  email: string,
): Promise<RateLimitResult> {
  const recent = await recentSendsForEmail(
    serviceClient,
    email,
    RATE_LIMIT_WINDOW_MINUTES,
  );

  if (recent.length < RATE_LIMIT_MAX_SENDS_PER_HOUR) return { allowed: true };

  // Oldest send within the window ages out first; that's when capacity returns.
  const oldest = recent[recent.length - 1];
  if (!oldest) return { allowed: true };

  const ageOutAt =
    new Date(oldest.attempted_at).getTime() +
    RATE_LIMIT_WINDOW_MINUTES * 60_000;
  const retryAfterSec = Math.max(
    1,
    Math.ceil((ageOutAt - Date.now()) / 1000),
  );

  return { allowed: false, retryAfterSec };
}

export function mapCallbackError(message: string | undefined): CallbackReason {
  const lower = (message ?? "").toLowerCase();
  if (lower.includes("expired")) return "expired";
  if (lower.includes("already") || lower.includes("used")) return "used";
  return "invalid";
}

export function callbackReasonToOutcome(
  reason: CallbackReason,
): "callback_expired" | "callback_already_used" | "callback_invalid" {
  switch (reason) {
    case "expired":
      return "callback_expired";
    case "used":
      return "callback_already_used";
    case "invalid":
      return "callback_invalid";
  }
}
