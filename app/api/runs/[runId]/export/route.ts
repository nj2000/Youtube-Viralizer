import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getRunRow } from "@/lib/db/runs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assembleKitMarkdown, kitFilename } from "@/lib/services/engagement-bundle";

export const runtime = "nodejs";

function errorJson(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ code, message, ...extra }, { status });
}

// GET /api/runs/[runId]/export?format=markdown — the full 12-stage kit as one
// markdown doc. 409 RUN_INCOMPLETE if any stage data is missing.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  if (!z.string().uuid().safeParse(runId).success) {
    return errorJson(400, "VALIDATION_FAILED", "Invalid run id.");
  }
  const format = request.nextUrl.searchParams.get("format") ?? "markdown";
  if (format !== "markdown") {
    return errorJson(400, "UNSUPPORTED_FORMAT", "Only markdown export is supported.");
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

  const { markdown, missingStages } = assembleKitMarkdown(row);
  if (missingStages.length > 0) {
    return errorJson(409, "RUN_INCOMPLETE", "Some stages haven't been generated.", { missingStages });
  }

  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${kitFilename(row)}"`,
    },
  });
}
