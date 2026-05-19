import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { getRunRow } from "@/lib/db/runs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runStage } from "@/lib/services/pipeline";
import { publish } from "@/lib/services/pipeline-bus";
import {
  GateFailedError,
  MissingDependencyError,
  StageNotImplementedError,
} from "@/lib/services/errors";

export const runtime = "nodejs";

const BodySchema = z.object({ runId: z.string().uuid() });

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).origin !== new URL(env.SITE_URL).origin) {
    return errorJson(403, "INVALID_ORIGIN", "Origin not allowed.");
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorJson(400, "VALIDATION_FAILED", "Body must be JSON.");
  }
  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return errorJson(400, "VALIDATION_FAILED", "Invalid request body.");
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorJson(401, "UNAUTHENTICATED", "Sign in to continue.");

  const row = await getRunRow(supabase, parsed.data.runId);
  if (!row || row.user_id !== user.id) {
    return errorJson(404, "RUN_NOT_FOUND", "Run not found.");
  }
  if (row.status === "running") {
    return errorJson(
      409,
      "STREAM_IN_PROGRESS",
      "This run is already executing a stage.",
    );
  }
  if (row.competitor_data === null) {
    return errorJson(
      409,
      "MISSING_PREREQUISITES",
      "Competitor outliers must run before scoring.",
    );
  }

  // Fire-and-forget. Progress events + gate transitions flow through
  // pipeline-bus → GET /api/runs/[runId]/stream. runStage handles the gate
  // path internally (calls markGateFailed when passed=false).
  void (async () => {
    try {
      await runStage(parsed.data.runId, "score", user.id);
    } catch (err) {
      if (err instanceof GateFailedError) return; // expected; bus already emitted run_gated
      const code =
        err instanceof MissingDependencyError
          ? "MISSING_PREREQUISITES"
          : err instanceof StageNotImplementedError
            ? "INTERNAL_ERROR"
            : "UPSTREAM_ERROR";
      await publish(parsed.data.runId, {
        event: "run_error",
        payload: { runId: parsed.data.runId, stage: 4, code },
      });
    }
  })();

  return NextResponse.json({ ok: true }, { status: 202 });
}
