import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/db/types";

type Client = SupabaseClient<Database>;
type DraftRow = Database["public"]["Tables"]["onboard_drafts"]["Row"];

const TEN_MINUTES_MS = 10 * 60 * 1000;

export async function createOnboardDraft(
  serviceClient: Client,
  userId: string,
  payload: Json,
): Promise<DraftRow> {
  const expiresAt = new Date(Date.now() + TEN_MINUTES_MS).toISOString();
  const draftId = crypto.randomUUID();
  const { data, error } = await serviceClient
    .from("onboard_drafts")
    .insert({
      draft_id: draftId,
      user_id: userId,
      payload,
      expires_at: expiresAt,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function getOnboardDraft(
  serviceClient: Client,
  draftId: string,
): Promise<DraftRow | null> {
  const { data, error } = await serviceClient
    .from("onboard_drafts")
    .select("*")
    .eq("draft_id", draftId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function deleteOnboardDraft(
  serviceClient: Client,
  draftId: string,
): Promise<void> {
  const { error } = await serviceClient
    .from("onboard_drafts")
    .delete()
    .eq("draft_id", draftId);

  if (error) throw error;
}
