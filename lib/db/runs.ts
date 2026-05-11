import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/types";

type Client = SupabaseClient<Database>;
type RunRow = Database["public"]["Tables"]["pipeline_runs"]["Row"];
type RunInsert = Database["public"]["Tables"]["pipeline_runs"]["Insert"];
type RunUpdate = Database["public"]["Tables"]["pipeline_runs"]["Update"];

export async function listRunsForChannel(
  client: Client,
  userId: string,
  channelId: string,
): Promise<RunRow[]> {
  const { data, error } = await client
    .from("pipeline_runs")
    .select("*")
    .eq("user_id", userId)
    .eq("channel_id", channelId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getRun(
  client: Client,
  runId: string,
): Promise<RunRow | null> {
  const { data, error } = await client
    .from("pipeline_runs")
    .select("*")
    .eq("id", runId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function insertRun(
  client: Client,
  run: RunInsert,
): Promise<RunRow> {
  const { data, error } = await client
    .from("pipeline_runs")
    .insert(run)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function updateRun(
  client: Client,
  runId: string,
  patch: RunUpdate,
): Promise<RunRow> {
  const { data, error } = await client
    .from("pipeline_runs")
    .update(patch)
    .eq("id", runId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function softDeleteRun(
  client: Client,
  runId: string,
): Promise<void> {
  const { error } = await client
    .from("pipeline_runs")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", runId);

  if (error) throw error;
}
