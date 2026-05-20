import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { getRunRow } from "@/lib/db/runs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runFromStage } from "@/lib/services/pipeline";
import { hasLockedTitle } from "@/lib/services/pipeline-stages";
import { publish } from "@/lib/services/pipeline-bus";

export const runtime = "nodejs";

const RunIdSchema = z.string().uuid();

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status });
}

// Resumes the pipeline past the Stage 5 (titles) checkpoint. Requires at least
// one locked title — the downstream fan-out (hook/script/thumbnails/seo/ab/
// engagement) depends on a locked title per spec §3.5.
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

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorJson(401, "UNAUTHENTICATED", "Sign in to continue.");

  const row = await getRunRow(supabase, idParsed.data);
  if (!row || row.user_id !== user.id) {
    return errorJson(404, "RUN_NOT_FOUND", "Run not found.");
  }
  if (row.titles_data === null) {
    return errorJson(409, "MISSING_PREREQUISITES", "Generate titles first.");
  }
  if (!hasLockedTitle(row)) {
    return errorJson(
      409,
      "NO_TITLE_LOCKED",
      "Lock at least one title before continuing.",
    );
  }

  void (async () => {
    try {
      await runFromStage(idParsed.data, user.id, "hook");
    } catch (err) {
      await publish(idParsed.data, {
        event: "run_error",
        payload: {
          runId: idParsed.data,
          stage: 6,
          code: err instanceof Error ? err.name : "INTERNAL_ERROR",
        },
      });
    }
  })();

  return NextResponse.json({ ok: true, nextStage: 6 }, { status: 202 });
}
