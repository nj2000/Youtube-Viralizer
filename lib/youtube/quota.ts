import "server-only";

import {
  getTodayUsage as getTodayUsageDb,
  incrementTodayUsage,
} from "@/lib/db/youtube-quota";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

import { QuotaExceededError } from "./errors";

// EXT-2: soft-cap at 80% of YouTube's 10,000-unit daily quota.
export const DAILY_SOFT_CAP = 8000;

export async function getUsageToday(): Promise<number> {
  return getTodayUsageDb(createSupabaseServiceClient());
}

export async function assertHeadroom(units: number): Promise<void> {
  const used = await getUsageToday();
  if (used + units > DAILY_SOFT_CAP) {
    throw new QuotaExceededError(used, units);
  }
}

export async function incrementUsage(units: number): Promise<number> {
  return incrementTodayUsage(createSupabaseServiceClient(), units);
}
