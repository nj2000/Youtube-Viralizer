import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/db/types";

type Client = SupabaseClient<Database>;

export async function getCachedPayload(
  serviceClient: Client,
  cacheKey: string,
): Promise<Json | null> {
  const { data, error } = await serviceClient
    .from("youtube_api_cache")
    .select("payload, expires_at")
    .eq("cache_key", cacheKey)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;
  return data.payload;
}

export async function setCachedPayload(
  serviceClient: Client,
  cacheKey: string,
  payload: Json,
  ttlSeconds: number,
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const { error } = await serviceClient
    .from("youtube_api_cache")
    .upsert(
      { cache_key: cacheKey, payload, expires_at: expiresAt },
      { onConflict: "cache_key" },
    );

  if (error) throw error;
}
