import "server-only";

import type { Json } from "@/lib/db/types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { ScriptDataSchema, type ScriptData } from "@/lib/validation/script";

export type ScriptOwnership = { runId: string; userId: string };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function readScriptData(
  args: ScriptOwnership,
): Promise<ScriptData | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("pipeline_runs")
    .select("script_data, user_id")
    .eq("id", args.runId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.user_id !== args.userId) return null;
  const parsed = ScriptDataSchema.safeParse(data.script_data);
  return parsed.success ? parsed.data : null;
}

export async function writeScriptData(
  args: ScriptOwnership & { targetMinutes: number; lockedTitleIndex: number; lockedHookIndex: number },
  next: ScriptData,
): Promise<void> {
  const validated = ScriptDataSchema.parse(next);
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("pipeline_runs")
    .update({
      script_data: validated as unknown as Json,
      script_target_minutes: args.targetMinutes,
      script_locked_title_index: args.lockedTitleIndex,
      script_locked_hook_index: args.lockedHookIndex,
      stale_script: false,
    })
    .eq("id", args.runId)
    .eq("user_id", args.userId)
    .is("deleted_at", null);
  if (error) throw error;
}

export async function clearScriptData(args: ScriptOwnership): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("pipeline_runs")
    .update({ script_data: null })
    .eq("id", args.runId)
    .eq("user_id", args.userId)
    .is("deleted_at", null);
  if (error) throw error;
}

// --- Daily Anthropic spend (service-role only) ---

export async function getTodaySpendMicroUsd(): Promise<number> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("anthropic_spend_daily")
    .select("total_micro_usd")
    .eq("day", today())
    .maybeSingle();
  if (error) throw error;
  return data?.total_micro_usd ?? 0;
}

export async function incrementSpendMicroUsd(microUsd: number): Promise<void> {
  if (microUsd <= 0) return;
  const supabase = createSupabaseServiceClient();
  const day = today();
  const current = await getTodaySpendMicroUsd();
  const { error } = await supabase
    .from("anthropic_spend_daily")
    .upsert(
      { day, total_micro_usd: current + microUsd, updated_at: new Date().toISOString() },
      { onConflict: "day" },
    );
  if (error) throw error;
}

// --- Per-channel generation throttle ---

export type ThrottleCounts = { fullCount: number; sectionCount: number };

export async function getThrottle(channelId: string): Promise<ThrottleCounts> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("script_gen_throttle")
    .select("full_count, section_count")
    .eq("channel_id", channelId)
    .eq("day", today())
    .maybeSingle();
  if (error) throw error;
  return {
    fullCount: data?.full_count ?? 0,
    sectionCount: data?.section_count ?? 0,
  };
}

export async function incrementThrottle(
  channelId: string,
  kind: "full" | "section",
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const day = today();
  const current = await getThrottle(channelId);
  const next = {
    channel_id: channelId,
    day,
    full_count: current.fullCount + (kind === "full" ? 1 : 0),
    section_count: current.sectionCount + (kind === "section" ? 1 : 0),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("script_gen_throttle")
    .upsert(next, { onConflict: "channel_id,day" });
  if (error) throw error;
}
