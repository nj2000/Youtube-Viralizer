import "server-only";

import type { Json } from "@/lib/db/types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { TitlesDataSchema, type TitlesData } from "@/lib/validation/titles";

// Typed read/write for the titles_data JSONB column. Lock/unlock/regenerate
// are partial mutations of a single trigger — they read the whole document,
// mutate one key, and write it back so the other two triggers stay
// byte-for-byte identical (task.md verification).

export type TitlesOwnership = { runId: string; userId: string };

// Returns the parsed titles_data for an owned run, or null if the run isn't
// owned / has no titles yet / the payload fails schema validation.
export async function readTitlesData(
  args: TitlesOwnership,
): Promise<TitlesData | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("pipeline_runs")
    .select("titles_data, user_id")
    .eq("id", args.runId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.user_id !== args.userId) return null;
  const parsed = TitlesDataSchema.safeParse(data.titles_data);
  return parsed.success ? parsed.data : null;
}

export async function writeTitlesData(
  args: TitlesOwnership,
  next: TitlesData,
): Promise<void> {
  const validated = TitlesDataSchema.parse(next);
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("pipeline_runs")
    .update({ titles_data: validated as unknown as Json })
    .eq("id", args.runId)
    .eq("user_id", args.userId)
    .is("deleted_at", null);
  if (error) throw error;
}
