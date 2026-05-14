import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CompetitorSetSchema,
  TopVideosSchema,
  type Competitor,
  type TopVideo,
} from "@/lib/validation/channels";
import type { Database } from "@/lib/db/types";

type Client = SupabaseClient<Database>;
type ChannelRow = Database["public"]["Tables"]["channels"]["Row"];
type ChannelInsert = Database["public"]["Tables"]["channels"]["Insert"];
type ChannelUpdate = Database["public"]["Tables"]["channels"]["Update"];

export type Channel = Omit<
  ChannelRow,
  "top_videos_json" | "competitor_set_json"
> & {
  topVideos: TopVideo[];
  competitorSet: Competitor[];
};

function parseChannel(row: ChannelRow): Channel {
  const { top_videos_json, competitor_set_json, ...rest } = row;
  return {
    ...rest,
    topVideos: TopVideosSchema.parse(top_videos_json),
    competitorSet: CompetitorSetSchema.parse(competitor_set_json),
  };
}

export async function listChannels(
  client: Client,
  userId: string,
): Promise<Channel[]> {
  const { data, error } = await client
    .from("channels")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map(parseChannel);
}

export async function getChannel(
  client: Client,
  channelId: string,
): Promise<Channel | null> {
  const { data, error } = await client
    .from("channels")
    .select("*")
    .eq("id", channelId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  return data ? parseChannel(data) : null;
}

export async function insertChannel(
  client: Client,
  channel: ChannelInsert,
): Promise<Channel> {
  const { data, error } = await client
    .from("channels")
    .insert(channel)
    .select("*")
    .single();

  if (error) throw error;
  return parseChannel(data);
}

export async function updateChannel(
  client: Client,
  channelId: string,
  patch: ChannelUpdate,
): Promise<Channel> {
  const { data, error } = await client
    .from("channels")
    .update(patch)
    .eq("id", channelId)
    .select("*")
    .single();

  if (error) throw error;
  return parseChannel(data);
}

export async function softDeleteChannel(
  client: Client,
  channelId: string,
): Promise<void> {
  const { error } = await client
    .from("channels")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", channelId);

  if (error) throw error;
}

export async function countActiveChannels(
  client: Client,
  userId: string,
): Promise<number> {
  const { count, error } = await client
    .from("channels")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (error) throw error;
  return count ?? 0;
}

export async function findChannelByYoutubeId(
  client: Client,
  userId: string,
  youtubeChannelId: string,
): Promise<Channel | null> {
  const { data, error } = await client
    .from("channels")
    .select("*")
    .eq("user_id", userId)
    .eq("youtube_channel_id", youtubeChannelId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  return data ? parseChannel(data) : null;
}

export async function countActiveRunsForChannel(
  client: Client,
  channelId: string,
): Promise<number> {
  const { count, error } = await client
    .from("pipeline_runs")
    .select("id", { count: "exact", head: true })
    .eq("channel_id", channelId)
    .is("deleted_at", null);

  if (error) throw error;
  return count ?? 0;
}

export async function softDeletePipelineRunsForChannel(
  serviceClient: Client,
  channelId: string,
): Promise<number> {
  const nowIso = new Date().toISOString();
  const { data, error } = await serviceClient
    .from("pipeline_runs")
    .update({ deleted_at: nowIso })
    .eq("channel_id", channelId)
    .is("deleted_at", null)
    .select("id");

  if (error) throw error;
  return data?.length ?? 0;
}
