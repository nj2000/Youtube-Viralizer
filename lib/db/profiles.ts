import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/types";

type Client = SupabaseClient<Database>;
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

export async function getProfile(
  client: Client,
  userId: string,
): Promise<ProfileRow | null> {
  const { data, error } = await client
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function updateProfile(
  client: Client,
  userId: string,
  patch: ProfileUpdate,
): Promise<ProfileRow> {
  const { data, error } = await client
    .from("profiles")
    .update(patch)
    .eq("id", userId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function setActiveChannel(
  client: Client,
  userId: string,
  channelId: string | null,
): Promise<ProfileRow> {
  return updateProfile(client, userId, { active_channel_id: channelId });
}
