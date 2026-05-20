import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { getRunRow } from "@/lib/db/runs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { publish } from "@/lib/services/pipeline-bus";
import { MissingHookPrereqError, lockHook, unlockHook } from "@/lib/services/hook";

export const runtime = "nodejs";

const PostBodySchema = z.object({
  runId: z.string().uuid(),
  variantIndex: z.union([z.literal(0), z.literal(1), z.literal(2)]),
});
const DeleteBodySchema = z.object({ runId: z.string().uuid() });

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status });
}

function checkOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  return Boolean(origin) && new URL(origin!).origin === new URL(env.SITE_URL).origin;
}

export async function POST(request: NextRequest) {
  if (!checkOrigin(request)) {
    return errorJson(403, "INVALID_ORIGIN", "Origin not allowed.");
  }
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorJson(400, "VALIDATION_FAILED", "Body must be JSON.");
  }
  const parsed = PostBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return errorJson(400, "VALIDATION_FAILED", "runId + variantIndex (0-2) required.");
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
    const next = await lockHook({
      runId: parsed.data.runId,
      userId: user.id,
      variantIndex: parsed.data.variantIndex,
    });
    await publish(parsed.data.runId, {
      event: "stage_complete",
      payload: { stage: 6 },
    });
    return NextResponse.json({ hookData: next }, { status: 200 });
  } catch (err) {
    if (err instanceof MissingHookPrereqError) {
      return errorJson(409, "MISSING_PREREQUISITES", "Generate hooks first.");
    }
    throw err;
  }
}

export async function DELETE(request: NextRequest) {
  if (!checkOrigin(request)) {
    return errorJson(403, "INVALID_ORIGIN", "Origin not allowed.");
  }
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorJson(400, "VALIDATION_FAILED", "Body must be JSON.");
  }
  const parsed = DeleteBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return errorJson(400, "VALIDATION_FAILED", "runId required.");
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
    const next = await unlockHook({ runId: parsed.data.runId, userId: user.id });
    await publish(parsed.data.runId, {
      event: "stage_complete",
      payload: { stage: 6 },
    });
    return NextResponse.json({ hookData: next }, { status: 200 });
  } catch (err) {
    if (err instanceof MissingHookPrereqError) {
      return errorJson(409, "MISSING_PREREQUISITES", "Generate hooks first.");
    }
    throw err;
  }
}
