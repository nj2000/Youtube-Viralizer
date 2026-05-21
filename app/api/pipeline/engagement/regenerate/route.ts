import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { getRunRow } from "@/lib/db/runs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { publish } from "@/lib/services/pipeline-bus";
import {
  EngagementLintError,
  MissingEngagementPrereqError,
  regenerateEngagementDraft,
} from "@/lib/services/engagement";
import { EngagementDraftTypeSchema } from "@/lib/validation/engagement";

export const runtime = "nodejs";

const BodySchema = z.object({
  runId: z.string().uuid(),
  draftType: EngagementDraftTypeSchema,
});

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status });
}

// POST /api/pipeline/engagement/regenerate — re-draft one artifact, persisting
// directly (the spec's preview/commit two-step is deferred — see summary §dev).
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
    return errorJson(400, "VALIDATION_FAILED", "runId + draftType required.");
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
    const engagementDrafts = await regenerateEngagementDraft({
      runId: parsed.data.runId,
      userId: user.id,
      run: row,
      draftType: parsed.data.draftType,
    });
    await publish(parsed.data.runId, { event: "stage_complete", payload: { stage: 12 } });
    return NextResponse.json({ engagementDrafts }, { status: 200 });
  } catch (err) {
    if (err instanceof MissingEngagementPrereqError) {
      return errorJson(409, "MISSING_PREREQUISITES", "Generate the drafts first.");
    }
    if (err instanceof EngagementLintError) {
      return errorJson(502, "LINT_RETRIES_EXHAUSTED", "Couldn't pass the lint after 3 tries — edit manually.");
    }
    throw err;
  }
}
