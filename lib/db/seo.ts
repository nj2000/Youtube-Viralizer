import "server-only";

import type { Json } from "@/lib/db/types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { SeoDataSchema, type SeoData } from "@/lib/validation/seo";

// Typed read/write for seo_data + the is_sponsored toggle. Per-section regenerate
// reads the whole document, replaces one section, writes it back (other sections
// stay byte-for-byte).

export type SeoOwnership = { runId: string; userId: string };

export async function readSeoData(args: SeoOwnership): Promise<SeoData | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("pipeline_runs")
    .select("seo_data, user_id")
    .eq("id", args.runId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.user_id !== args.userId) return null;
  const parsed = SeoDataSchema.safeParse(data.seo_data);
  return parsed.success ? parsed.data : null;
}

export async function writeSeoData(args: SeoOwnership, next: SeoData): Promise<void> {
  const validated = SeoDataSchema.parse(next);
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("pipeline_runs")
    .update({ seo_data: validated as unknown as Json })
    .eq("id", args.runId)
    .eq("user_id", args.userId)
    .is("deleted_at", null);
  if (error) throw error;
}

export async function setSponsored(args: SeoOwnership, isSponsored: boolean): Promise<void> {
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("pipeline_runs")
    .update({ is_sponsored: isSponsored })
    .eq("id", args.runId)
    .eq("user_id", args.userId)
    .is("deleted_at", null);
  if (error) throw error;
}
