import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { getRunRow } from "@/lib/db/runs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { publish } from "@/lib/services/pipeline-bus";
import { MissingSeoPrereqError, regenerateSeoSection, InvalidSeoError } from "@/lib/services/seo";
import { SeoSectionSchema } from "@/lib/validation/seo";

export const runtime = "nodejs";

const BodySchema = z.object({
  runId: z.string().uuid(),
  section: SeoSectionSchema,
});

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status });
}

// POST /api/pipeline/seo/regenerate-section — re-roll one section, preserving
// the rest (spec §4.2).
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
    return errorJson(400, "VALIDATION_FAILED", "runId + section required.");
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
    const seoData = await regenerateSeoSection({
      runId: parsed.data.runId,
      userId: user.id,
      run: row,
      section: parsed.data.section,
    });
    await publish(parsed.data.runId, { event: "stage_complete", payload: { stage: 10 } });
    return NextResponse.json({ seoData }, { status: 200 });
  } catch (err) {
    if (err instanceof MissingSeoPrereqError) {
      return errorJson(409, "MISSING_PREREQUISITES", "Generate the SEO pack first.");
    }
    if (err instanceof InvalidSeoError) {
      return errorJson(502, "UPSTREAM_ERROR", "Couldn't regenerate that section — retry.");
    }
    throw err;
  }
}
