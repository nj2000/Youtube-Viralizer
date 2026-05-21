import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { getRunRow } from "@/lib/db/runs";
import { setSponsored } from "@/lib/db/seo";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { publish } from "@/lib/services/pipeline-bus";

export const runtime = "nodejs";

const BodySchema = z.object({ is_sponsored: z.boolean() });

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status });
}

// PATCH /api/runs/[runId]/sponsored — toggle the FTC paid-promotion flag. The
// next SEO (re)generation injects/removes the disclosure accordingly.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).origin !== new URL(env.SITE_URL).origin) {
    return errorJson(403, "INVALID_ORIGIN", "Origin not allowed.");
  }
  const { runId } = await params;
  if (!z.string().uuid().safeParse(runId).success) {
    return errorJson(400, "VALIDATION_FAILED", "Invalid run id.");
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorJson(400, "VALIDATION_FAILED", "Body must be JSON.");
  }
  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return errorJson(400, "VALIDATION_FAILED", "is_sponsored (boolean) required.");
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorJson(401, "UNAUTHENTICATED", "Sign in to continue.");

  const row = await getRunRow(supabase, runId);
  if (!row || row.user_id !== user.id) {
    return errorJson(404, "RUN_NOT_FOUND", "Run not found.");
  }

  await setSponsored({ runId, userId: user.id }, parsed.data.is_sponsored);
  await publish(runId, { event: "stage_complete", payload: { stage: 10 } });
  return NextResponse.json({ ok: true, isSponsored: parsed.data.is_sponsored });
}
