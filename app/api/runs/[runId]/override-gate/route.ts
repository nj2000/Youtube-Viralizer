import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { getRunRow } from "@/lib/db/runs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { runFromStage } from "@/lib/services/pipeline";
import { publish } from "@/lib/services/pipeline-bus";

export const runtime = "nodejs";

const RunIdSchema = z.string().uuid();
const BodySchema = z
  .object({ reason: z.string().max(500).optional() })
  .or(z.undefined());

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status });
}

function rebuildGateFailureReason(scoreData: unknown): string {
  if (
    scoreData &&
    typeof scoreData === "object" &&
    !Array.isArray(scoreData) &&
    typeof (scoreData as Record<string, unknown>).finalScore === "number"
  ) {
    const finalScore = (scoreData as Record<string, number>).finalScore;
    return `Score ${finalScore} / 100 — below 92 threshold`;
  }
  return "Score below 92 threshold";
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }
  const bodyParsed = BodySchema.safeParse(body);
  if (!bodyParsed.success) {
    return errorJson(400, "VALIDATION_FAILED", "Reason must be ≤500 chars.");
  }
  const reason = bodyParsed.data?.reason ?? null;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorJson(401, "UNAUTHENTICATED", "Sign in to continue.");

  const row = await getRunRow(supabase, idParsed.data);
  if (!row || row.user_id !== user.id) {
    return errorJson(404, "RUN_NOT_FOUND", "Run not found.");
  }
  if (row.status !== "gated_failed") {
    return errorJson(
      409,
      "OVERRIDE_NOT_APPLICABLE",
      "Override only applies to gated-failed runs.",
    );
  }
  if (row.gate_overridden_at) {
    return errorJson(
      409,
      "ALREADY_OVERRIDDEN",
      "This gate has already been overridden.",
    );
  }

  const nowIso = new Date().toISOString();
  const serviceClient = createSupabaseServiceClient();
  const { error: updateError } = await serviceClient
    .from("pipeline_runs")
    .update({
      gate_overridden_at: nowIso,
      gate_override_reason: reason,
      status: "scored_overridden",
      completed_at: null,
      failure_reason: null,
    })
    .eq("id", idParsed.data);
  if (updateError) throw updateError;

  // Fire-and-forget orchestration from titles onward.
  void (async () => {
    try {
      await runFromStage(idParsed.data, user.id, "titles");
    } catch (err) {
      await publish(idParsed.data, {
        event: "run_error",
        payload: {
          runId: idParsed.data,
          stage: 5,
          code: err instanceof Error ? err.name : "INTERNAL_ERROR",
        },
      });
    }
  })();

  return NextResponse.json(
    { status: "scored_overridden", nextStage: 5 },
    { status: 200 },
  );
}

export async function DELETE(
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

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorJson(401, "UNAUTHENTICATED", "Sign in to continue.");

  const row = await getRunRow(supabase, idParsed.data);
  if (!row || row.user_id !== user.id) {
    return errorJson(404, "RUN_NOT_FOUND", "Run not found.");
  }
  if (row.gate_overridden_at === null) {
    return errorJson(
      409,
      "NO_OVERRIDE_TO_REVERSE",
      "This gate has not been overridden.",
    );
  }

  const failureReason = rebuildGateFailureReason(row.score_data);
  const serviceClient = createSupabaseServiceClient();
  const { error: updateError } = await serviceClient
    .from("pipeline_runs")
    .update({
      gate_overridden_at: null,
      gate_override_reason: null,
      status: "gated_failed",
      failure_reason: failureReason,
      completed_at: new Date().toISOString(),
    })
    .eq("id", idParsed.data);
  if (updateError) throw updateError;

  return NextResponse.json({ status: "gated_failed" }, { status: 200 });
}
