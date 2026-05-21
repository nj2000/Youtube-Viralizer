import "server-only";

import type { Json } from "@/lib/db/types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  ThumbnailsDataSchema,
  type ThumbnailsData,
} from "@/lib/validation/thumbnails";

// Typed read/write for the thumbnails_data JSONB column. Per-trigger regenerate
// reads the whole document, replaces one trigger, and writes it back so the
// other two briefs stay byte-for-byte identical (task.md verification).

export type ThumbnailsOwnership = { runId: string; userId: string };

export async function readThumbnailsData(
  args: ThumbnailsOwnership,
): Promise<ThumbnailsData | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("pipeline_runs")
    .select("thumbnails_data, user_id")
    .eq("id", args.runId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.user_id !== args.userId) return null;
  const parsed = ThumbnailsDataSchema.safeParse(data.thumbnails_data);
  return parsed.success ? parsed.data : null;
}

export async function writeThumbnailsData(
  args: ThumbnailsOwnership,
  next: ThumbnailsData,
): Promise<void> {
  const validated = ThumbnailsDataSchema.parse(next);
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("pipeline_runs")
    .update({ thumbnails_data: validated as unknown as Json })
    .eq("id", args.runId)
    .eq("user_id", args.userId)
    .is("deleted_at", null);
  if (error) throw error;
}
