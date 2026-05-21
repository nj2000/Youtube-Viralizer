import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { getRunRow } from "@/lib/db/runs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { publish } from "@/lib/services/pipeline-bus";
import {
  InvalidAbPlanError,
  MissingAbPrereqError,
  regenerateAbVariant,
} from "@/lib/services/ab-plan";

export const runtime = "nodejs";

const BodySchema = z.object({
  runId: z.string().uuid(),
  variantIndex: z.union([z.literal(0), z.literal(1), z.literal(2)]),
});

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status });
}

// POST /api/pipeline/ab-plan/regenerate — re-draft one arm's reasoning,
// preserving its title/thumbnail/trigger and the other two arms (spec §4.2).
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
    return errorJson(400, "VALIDATION_FAILED", "runId + variantIndex (0-2) required.");
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

  try {
    const abPlan = await regenerateAbVariant({
      runId: parsed.data.runId,
      userId: user.id,
      run: row,
      variantIndex: parsed.data.variantIndex,
    });
    await publish(parsed.data.runId, { event: "stage_complete", payload: { stage: 11 } });
    return NextResponse.json({ abPlan }, { status: 200 });
  } catch (err) {
    if (err instanceof MissingAbPrereqError) {
      return errorJson(409, "MISSING_PREREQUISITES", "Generate the A/B plan first.");
    }
    if (err instanceof InvalidAbPlanError) {
      return errorJson(502, "UPSTREAM_ERROR", "Couldn't re-draft that arm — retry.");
    }
    throw err;
  }
}
