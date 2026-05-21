import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { getRunRow } from "@/lib/db/runs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  acceptOrDismissIssue,
  IssueAlreadyResolvedError,
  IssueNotFoundError,
  InvalidActionError,
} from "@/lib/services/lint-actions";

export const runtime = "nodejs";

const BodySchema = z.object({
  runId: z.string().uuid(),
  issueId: z.string().uuid(),
  action: z.enum(["accept", "dismiss"]),
});

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status });
}

// POST /api/pipeline/lint/issue — accept or dismiss one issue (spec §4.2).
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
    const result = await acceptOrDismissIssue({
      runId: parsed.data.runId,
      userId: user.id,
      issueId: parsed.data.issueId,
      action: parsed.data.action,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof InvalidActionError) {
      return errorJson(400, "INVALID_ACTION", "This issue can't be accepted.");
    }
    if (err instanceof IssueNotFoundError) {
      return errorJson(404, "ISSUE_NOT_FOUND", "Issue not found.");
    }
    if (err instanceof IssueAlreadyResolvedError) {
      return errorJson(409, "ISSUE_ALREADY_RESOLVED", "Issue already resolved.");
    }
    throw err;
  }
}
