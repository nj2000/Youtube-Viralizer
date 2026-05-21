import "server-only";

import type { Json } from "@/lib/db/types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  EngagementDraftsSchema,
  type EngagementDrafts,
} from "@/lib/validation/engagement";

// Typed read/write for the engagement_drafts_data JSONB column. Per-draft
// regenerate reads the whole document, replaces one artifact, writes it back.

export type EngagementOwnership = { runId: string; userId: string };

export async function readEngagementData(
  args: EngagementOwnership,
): Promise<EngagementDrafts | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("pipeline_runs")
    .select("engagement_drafts_data, user_id")
    .eq("id", args.runId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.user_id !== args.userId) return null;
  const parsed = EngagementDraftsSchema.safeParse(data.engagement_drafts_data);
  return parsed.success ? parsed.data : null;
}

export async function writeEngagementData(
  args: EngagementOwnership,
  next: EngagementDrafts,
): Promise<void> {
  const validated = EngagementDraftsSchema.parse(next);
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("pipeline_runs")
    .update({ engagement_drafts_data: validated as unknown as Json })
    .eq("id", args.runId)
    .eq("user_id", args.userId)
    .is("deleted_at", null);
  if (error) throw error;
}
