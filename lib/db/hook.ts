import "server-only";

import type { Json } from "@/lib/db/types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { HookDataSchema, type HookData } from "@/lib/validation/hook";

// Typed read/write for the hook_data JSONB column. Lock/unlock mutate only
// lockedVariantIndex + lockedAt; the three variants stay byte-for-byte.

export type HookOwnership = { runId: string; userId: string };

export async function readHookData(
  args: HookOwnership,
): Promise<HookData | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("pipeline_runs")
    .select("hook_data, user_id")
    .eq("id", args.runId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.user_id !== args.userId) return null;
  const parsed = HookDataSchema.safeParse(data.hook_data);
  return parsed.success ? parsed.data : null;
}

export async function writeHookData(
  args: HookOwnership,
  next: HookData,
): Promise<void> {
  const validated = HookDataSchema.parse(next);
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("pipeline_runs")
    .update({ hook_data: validated as unknown as Json })
    .eq("id", args.runId)
    .eq("user_id", args.userId)
    .is("deleted_at", null);
  if (error) throw error;
}
