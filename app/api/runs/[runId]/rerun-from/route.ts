import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RerunFromStageQuerySchema } from "@/lib/validation/runs";
import {
  RunAlreadyRunningError,
  RunNotFoundForUserError,
  rerunFromStageForUser,
} from "@/lib/services/runs";

export const runtime = "nodejs";

const RunIdSchema = z.string().uuid();

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

  const url = new URL(request.url);
  const queryParsed = RerunFromStageQuerySchema.safeParse({
    stage: url.searchParams.get("stage") ?? undefined,
  });
  if (!queryParsed.success) {
    return errorJson(400, "VALIDATION_FAILED", "Invalid stage parameter.");
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorJson(401, "UNAUTHENTICATED", "Sign in to continue.");

  try {
    const result = await rerunFromStageForUser(supabase, {
      runId: idParsed.data,
      userId: user.id,
      stage: queryParsed.data.stage,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof RunNotFoundForUserError) {
      return errorJson(404, "RUN_NOT_FOUND", "Run not found.");
    }
    if (err instanceof RunAlreadyRunningError) {
      return errorJson(
        409,
        "RUN_ALREADY_RUNNING",
        "This run is already in progress. Try again when it finishes.",
      );
    }
    throw err;
  }
}
