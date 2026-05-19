import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import type { Json } from "@/lib/db/types";
import { getRunRow } from "@/lib/db/runs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  NoCompetitorsError,
  StaleCacheForReExtractError,
  runCompetitorStage,
} from "@/lib/services/competitor";
import { publish } from "@/lib/services/pipeline-bus";
import {
  markStageComplete,
  markStageFailed,
  markStageStarted,
} from "@/lib/services/pipeline-state";
import { QuotaExceededError } from "@/lib/youtube/errors";

export const runtime = "nodejs";

const BodySchema = z
  .object({
    runId: z.string().uuid(),
    forceFresh: z.boolean().optional(),
    reExtractOnly: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.forceFresh && val.reExtractOnly) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose one regenerate mode, not both.",
      });
    }
  });

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status });
}

export async function POST(request: NextRequest) {
  // SEC §9 — same-origin enforcement.
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
  // Concurrent invocation guard — spec §4.1 / verification §STREAM_IN_PROGRESS.
  if (row.status === "running") {
    return errorJson(
      409,
      "STREAM_IN_PROGRESS",
      "This run is already executing a stage.",
    );
  }

  // Fire-and-forget: progress flows through pipeline-bus → GET /api/runs/[runId]/stream.
  void (async () => {
    try {
      await markStageStarted(parsed.data.runId, "competitor");
      const output = await runCompetitorStage({
        ctx: { runId: parsed.data.runId, userId: user.id, run: row },
        forceFresh: parsed.data.forceFresh,
        reExtractOnly: parsed.data.reExtractOnly,
      });
      await markStageComplete(
        parsed.data.runId,
        "competitor",
        output as unknown as Json,
      );
    } catch (err) {
      await markStageFailed(parsed.data.runId, "competitor", err);

      // Spec §4.1 — surface typed codes via the bus so the UI can render
      // the right empty/error state without parsing free-text reasons.
      let code = "UPSTREAM_ERROR";
      if (err instanceof NoCompetitorsError) code = "NO_COMPETITORS";
      else if (err instanceof StaleCacheForReExtractError) {
        code = "VALIDATION_FAILED";
      } else if (err instanceof QuotaExceededError) code = "QUOTA_EXCEEDED";
      await publish(parsed.data.runId, {
        event: "run_error",
        payload: { runId: parsed.data.runId, stage: 3, code },
      });
    }
  })();

  return NextResponse.json({ ok: true }, { status: 202 });
}
