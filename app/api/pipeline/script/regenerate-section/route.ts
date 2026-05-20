import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { getRunRow } from "@/lib/db/runs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { publish } from "@/lib/services/pipeline-bus";
import { MissingScriptPrereqError } from "@/lib/services/script";
import { regenerateScriptSection } from "@/lib/services/script-mutations";
import {
  BudgetExceededError,
  ScriptRateLimitedError,
} from "@/lib/services/script-budget";

export const runtime = "nodejs";

const BodySchema = z.object({
  runId: z.string().uuid(),
  sectionIndex: z.number().int().min(0).max(9),
});

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
    return errorJson(400, "VALIDATION_FAILED", "runId + sectionIndex required.");
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
    // Single-section regen never auto-queues Stage 8 (spec §4.2).
    const next = await regenerateScriptSection({
      runId: parsed.data.runId,
      userId: user.id,
      run: row,
      sectionIndex: parsed.data.sectionIndex,
    });
    await publish(parsed.data.runId, {
      event: "stage_complete",
      payload: { stage: 7 },
    });
    return NextResponse.json({ scriptData: next }, { status: 200 });
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return errorJson(503, "BUDGET_EXCEEDED", "Daily budget exhausted.");
    }
    if (err instanceof ScriptRateLimitedError) {
      return errorJson(429, "RATE_LIMITED", "Too many section regenerations.");
    }
    if (err instanceof MissingScriptPrereqError) {
      return errorJson(409, "MISSING_PREREQUISITES", "Generate the script first.");
    }
    return errorJson(502, "UPSTREAM_ERROR", "Section regeneration failed.");
  }
}
