import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { getRunRow } from "@/lib/db/runs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { runFromStage } from "@/lib/services/pipeline";
import { publish } from "@/lib/services/pipeline-bus";
import { ScoreDataSchema } from "@/lib/validation/score";

export const runtime = "nodejs";

const RunIdSchema = z.string().uuid();
const BodySchema = z.object({
  reframeIndex: z.number().int().min(0).max(2),
});

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).origin !== new URL(env.SITE_URL).origin) {
    return errorJson(403, "INVALID_ORIGIN", "Origin not allowed.");
  }

  const { runId: rawId } = await params;
  const idParsed = RunIdSchema.safeParse(rawId);
  if (!idParsed.success) return errorJson(404, "RUN_NOT_FOUND", "Run not found.");

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorJson(400, "VALIDATION_FAILED", "Body must be JSON.");
  }
  const bodyParsed = BodySchema.safeParse(rawBody);
  if (!bodyParsed.success) {
    return errorJson(400, "VALIDATION_FAILED", "reframeIndex must be 0, 1, or 2.");
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorJson(401, "UNAUTHENTICATED", "Sign in to continue.");

  const row = await getRunRow(supabase, idParsed.data);
  if (!row || row.user_id !== user.id) {
    return errorJson(404, "RUN_NOT_FOUND", "Run not found.");
  }
  if (row.status === "running") {
    return errorJson(409, "STREAM_IN_PROGRESS", "Run is currently executing.");
  }

  const score = ScoreDataSchema.safeParse(row.score_data);
  if (!score.success || score.data.passed === true) {
    return errorJson(
      409,
      "REFRAME_NOT_APPLICABLE",
      "Reframes only apply to ideas that failed the gate.",
    );
  }
  const reframes = score.data.reframes ?? [];
  const reframe = reframes[bodyParsed.data.reframeIndex];
  if (!reframe) {
    return errorJson(
      400,
      "VALIDATION_FAILED",
      "Reframe index out of range for this run.",
    );
  }

  const serviceClient = createSupabaseServiceClient();
  const originalIdeaText = row.idea_text;

  // Single-statement wipe: idea_text rewrite + every stage_data column nulled
  // + every stale flag cleared + status reset to queued. Postgres updates are
  // atomic per-row, so all writes apply together or none do.
  const { error: updateError } = await serviceClient
    .from("pipeline_runs")
    .update({
      idea_text: reframe.revisedIdeaText,
      competitor_data: null,
      score_data: null,
      titles_data: null,
      hook_data: null,
      script_data: null,
      lint_data: null,
      thumbnails_data: null,
      seo_data: null,
      ab_plan_data: null,
      engagement_drafts_data: null,
      stale_competitor: false,
      stale_score: false,
      stale_titles: false,
      stale_hook: false,
      stale_script: false,
      stale_lint: false,
      stale_thumbnails: false,
      stale_seo: false,
      stale_ab_plan: false,
      stale_engagement_drafts: false,
      gate_overridden_at: null,
      gate_override_reason: null,
      status: "queued",
      current_stage: null,
      failure_reason: null,
      completed_at: null,
    })
    .eq("id", idParsed.data);
  if (updateError) throw updateError;

  // Audit row for Feature #17 calibration (Phase 3).
  const { error: auditError } = await serviceClient
    .from("reframe_applications")
    .insert({
      run_id: idParsed.data,
      user_id: user.id,
      reframe_index: bodyParsed.data.reframeIndex,
      original_idea_text: originalIdeaText,
      revised_idea_text: reframe.revisedIdeaText,
      expected_score_lift: reframe.expectedScoreLift,
    });
  if (auditError) throw auditError;

  void (async () => {
    try {
      await runFromStage(idParsed.data, user.id, "competitor");
    } catch (err) {
      await publish(idParsed.data, {
        event: "run_error",
        payload: {
          runId: idParsed.data,
          stage: 3,
          code: err instanceof Error ? err.name : "INTERNAL_ERROR",
        },
      });
    }
  })();

  return NextResponse.json(
    { runId: idParsed.data, status: "queued", nextStage: 3 },
    { status: 202 },
  );
}
