import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { getRunRow } from "@/lib/db/runs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { publish } from "@/lib/services/pipeline-bus";
import { runLintManual, lintErrorCode } from "@/lib/services/lint";

export const runtime = "nodejs";

const BodySchema = z.object({ runId: z.string().uuid() });

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status });
}

// POST /api/pipeline/lint — run Stage 8 lint (fire-and-forget, bus-streamed).
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
    return errorJson(409, "STREAM_IN_PROGRESS", "Run is currently executing.");
  }
  if (row.script_data === null) {
    return errorJson(409, "MISSING_PREREQUISITES", "Generate a script first.");
  }

  void (async () => {
    try {
      await runLintManual(row, user.id);
    } catch (err) {
      await publish(parsed.data.runId, {
        event: "run_error",
        payload: { runId: parsed.data.runId, stage: 8, code: lintErrorCode(err) },
      });
    }
  })();

  return NextResponse.json({ ok: true }, { status: 202 });
}
