import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/types";
import type {
  RunListItem,
  RunRowView,
  RunStatus,
} from "@/lib/validation/runs";

type Client = SupabaseClient<Database>;
type RunRow = Database["public"]["Tables"]["pipeline_runs"]["Row"];
type RunInsert = Database["public"]["Tables"]["pipeline_runs"]["Insert"];
type RunUpdate = Database["public"]["Tables"]["pipeline_runs"]["Update"];

export const PAGE_SIZE = 20;
const STATUSES: RunStatus[] = [
  "queued",
  "running",
  "complete",
  "gated_failed",
  "error",
];

export function rowToView(row: RunRow): RunRowView {
  return {
    id: row.id,
    userId: row.user_id,
    channelId: row.channel_id,
    ideaText: row.idea_text,
    status: row.status,
    currentStage: row.current_stage,
    failureReason: row.failure_reason,
    gateOverriddenAt: row.gate_overridden_at,
    gateOverrideReason: row.gate_override_reason,
    competitorData: row.competitor_data,
    scoreData: row.score_data,
    titlesData: row.titles_data,
    hookData: row.hook_data,
    scriptData: row.script_data,
    lintData: row.lint_data,
    thumbnailsData: row.thumbnails_data,
    seoData: row.seo_data,
    abPlanData: row.ab_plan_data,
    engagementDraftsData: row.engagement_drafts_data,
    stale: {
      competitor: row.stale_competitor,
      score: row.stale_score,
      titles: row.stale_titles,
      hook: row.stale_hook,
      script: row.stale_script,
      lint: row.stale_lint,
      thumbnails: row.stale_thumbnails,
      seo: row.stale_seo,
      abPlan: row.stale_ab_plan,
      engagementDrafts: row.stale_engagement_drafts,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export function rowToListItem(row: RunRow): RunListItem {
  const scoreData = row.score_data as { score?: unknown } | null;
  const scoreValue =
    scoreData && typeof scoreData.score === "number"
      ? Math.max(0, Math.min(100, Math.round(scoreData.score)))
      : null;

  const titlesData = row.titles_data as {
    candidates?: Array<{ text?: unknown }>;
  } | null;
  const previewTitle =
    titlesData &&
    Array.isArray(titlesData.candidates) &&
    typeof titlesData.candidates[0]?.text === "string"
      ? (titlesData.candidates[0]!.text as string)
      : null;

  const thumbnailsData = row.thumbnails_data as {
    briefs?: Array<{ accentHex?: unknown }>;
  } | null;
  const previewAccentHex =
    thumbnailsData &&
    Array.isArray(thumbnailsData.briefs) &&
    typeof thumbnailsData.briefs[0]?.accentHex === "string" &&
    /^#[0-9a-fA-F]{6}$/.test(thumbnailsData.briefs[0]!.accentHex as string)
      ? (thumbnailsData.briefs[0]!.accentHex as string)
      : null;

  return {
    id: row.id,
    ideaText: row.idea_text,
    status: row.status,
    currentStage: row.current_stage,
    scoreValue,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    previewTitle,
    previewAccentHex,
  };
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

export async function getRunRow(
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

export async function getRun(
  client: Client,
  runId: string,
): Promise<RunRowView | null> {
  const row = await getRunRow(client, runId);
  return row ? rowToView(row) : null;
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

// Retained from the Phase 1.2 surface; some Phase 2 work may still call it
// directly. Returns raw RunRow shape for callers that need DB-typed columns.
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

export type ListRunsArgs = {
  userId: string;
  channelId: string;
  q?: string;
  status?: RunStatus;
  page: number;
};

export type ListRunsResult = {
  runs: RunListItem[];
  page: number;
  pageSize: number;
  total: number;
  counts: Record<"all" | RunStatus, number>;
};

function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, (ch) => `\\${ch}`);
}

export async function listRuns(
  client: Client,
  args: ListRunsArgs,
): Promise<ListRunsResult> {
  const offset = (args.page - 1) * PAGE_SIZE;

  let query = client
    .from("pipeline_runs")
    .select("*", { count: "exact" })
    .eq("user_id", args.userId)
    .eq("channel_id", args.channelId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (args.q) {
    query = query.ilike("idea_text", `%${escapeLike(args.q)}%`);
  }
  if (args.status) {
    query = query.eq("status", args.status);
  }

  const { data, error, count } = await query;
  if (error) throw error;

  const counts: Record<"all" | RunStatus, number> = {
    all: 0,
    queued: 0,
    running: 0,
    complete: 0,
    gated_failed: 0,
    scored_overridden: 0,
    error: 0,
  };

  // Counts are scope-correct (per-channel, deleted_at null) and ignore the
  // current filters so the chips render the FULL distribution regardless of
  // which one is selected.
  await Promise.all(
    STATUSES.map(async (status) => {
      const { count: c, error: countError } = await client
        .from("pipeline_runs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", args.userId)
        .eq("channel_id", args.channelId)
        .eq("status", status)
        .is("deleted_at", null);
      if (countError) throw countError;
      counts[status] = c ?? 0;
    }),
  );
  counts.all = STATUSES.reduce((acc, s) => acc + counts[s], 0);

  return {
    runs: (data ?? []).map(rowToListItem),
    page: args.page,
    pageSize: PAGE_SIZE,
    total: count ?? 0,
    counts,
  };
}

export async function countRunsLastHourForUser(
  client: Client,
  userId: string,
): Promise<number> {
  const since = new Date(Date.now() - 60 * 60_000).toISOString();
  const { count, error } = await client
    .from("pipeline_runs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);
  if (error) throw error;
  return count ?? 0;
}
