import "server-only";

import type { Json } from "@/lib/db/types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { LintDataSchema, type LintData } from "@/lib/validation/lint";

// Typed read/write for the lint_data JSONB column. The orchestrator persists
// the initial lint via markStageComplete; these helpers serve the issue
// accept/dismiss/apply-all/override mutations (read-modify-write of one run).

export type LintOwnership = { runId: string; userId: string };

export async function readLintData(
  args: LintOwnership,
): Promise<LintData | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("pipeline_runs")
    .select("lint_data, user_id")
    .eq("id", args.runId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.user_id !== args.userId) return null;
  const parsed = LintDataSchema.safeParse(data.lint_data);
  return parsed.success ? parsed.data : null;
}

export async function writeLintData(
  args: LintOwnership,
  next: LintData,
): Promise<void> {
  const validated = LintDataSchema.parse(next);
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("pipeline_runs")
    .update({ lint_data: validated as unknown as Json })
    .eq("id", args.runId)
    .eq("user_id", args.userId)
    .is("deleted_at", null);
  if (error) throw error;
}

// Force re-runs clear lint_data so the handler's inputsHash dedup can't
// short-circuit (spec §4.4).
export async function clearLintData(args: LintOwnership): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("pipeline_runs")
    .update({ lint_data: null })
    .eq("id", args.runId)
    .eq("user_id", args.userId)
    .is("deleted_at", null);
  if (error) throw error;
}
