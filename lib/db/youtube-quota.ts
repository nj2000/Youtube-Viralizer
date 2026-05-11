import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/types";

type Client = SupabaseClient<Database>;
type Consumer = "hot_path" | "corpus_cron";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getTodayUsage(
  serviceClient: Client,
  consumer: Consumer = "hot_path",
): Promise<number> {
  const { data, error } = await serviceClient
    .from("youtube_quota_usage")
    .select("units_used")
    .eq("date", today())
    .eq("consumer", consumer)
    .maybeSingle();

  if (error) throw error;
  return data?.units_used ?? 0;
}

export async function incrementTodayUsage(
  serviceClient: Client,
  units: number,
  consumer: Consumer = "hot_path",
): Promise<number> {
  const date = today();
  const current = await getTodayUsage(serviceClient, consumer);
  const next = current + units;

  const { error } = await serviceClient
    .from("youtube_quota_usage")
    .upsert(
      { date, consumer, units_used: next },
      { onConflict: "date,consumer" },
    );

  if (error) throw error;
  return next;
}
