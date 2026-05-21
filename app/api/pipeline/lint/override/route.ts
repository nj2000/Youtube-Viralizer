import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { getRunRow } from "@/lib/db/runs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { overrideLint, IssueNotFoundError } from "@/lib/services/lint-actions";

export const runtime = "nodejs";

const BodySchema = z.object({
  runId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status });
}

// POST /api/pipeline/lint/override — acknowledge a blocking lint and continue
// (spec §7.5). Flips summary.blocking false; the warning banner persists.
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

  try {
    const result = await overrideLint({
      runId: parsed.data.runId,
      userId: user.id,
      reason: parsed.data.reason,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof IssueNotFoundError) {
      return errorJson(404, "RUN_NOT_FOUND", "No lint to override.");
    }
    throw err;
  }
}
