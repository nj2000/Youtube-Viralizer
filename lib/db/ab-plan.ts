import "server-only";

import type { Json } from "@/lib/db/types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { ABPlanSchema, type ABPlan } from "@/lib/validation/ab-plan";

// Typed read/write for the ab_plan_data JSONB column. Per-variant regenerate
// reads the whole plan, replaces one variant, writes it back.

export type AbPlanOwnership = { runId: string; userId: string };

export async function readAbPlanData(args: AbPlanOwnership): Promise<ABPlan | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("pipeline_runs")
    .select("ab_plan_data, user_id")
    .eq("id", args.runId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.user_id !== args.userId) return null;
  const parsed = ABPlanSchema.safeParse(data.ab_plan_data);
  return parsed.success ? parsed.data : null;
}

export async function writeAbPlanData(args: AbPlanOwnership, next: ABPlan): Promise<void> {
  const validated = ABPlanSchema.parse(next);
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("pipeline_runs")
    .update({ ab_plan_data: validated as unknown as Json })
    .eq("id", args.runId)
    .eq("user_id", args.userId)
    .is("deleted_at", null);
  if (error) throw error;
}
