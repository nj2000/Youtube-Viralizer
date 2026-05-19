import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  RunNotFoundForUserError,
  getRunForUser,
  softDeleteRunForUser,
} from "@/lib/services/runs";

export const runtime = "nodejs";

const RunIdSchema = z.string().uuid();

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId: rawId } = await params;
  const parsed = RunIdSchema.safeParse(rawId);
  if (!parsed.success) return errorJson(404, "RUN_NOT_FOUND", "Run not found.");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorJson(401, "UNAUTHENTICATED", "Sign in to continue.");

  try {
    const run = await getRunForUser(supabase, {
      runId: parsed.data,
      userId: user.id,
    });
    return NextResponse.json(run, { status: 200 });
  } catch (err) {
    if (err instanceof RunNotFoundForUserError) {
      return errorJson(404, "RUN_NOT_FOUND", "Run not found.");
    }
    throw err;
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).origin !== new URL(env.SITE_URL).origin) {
    return errorJson(403, "INVALID_ORIGIN", "Origin not allowed.");
  }

  const { runId: rawId } = await params;
  const parsed = RunIdSchema.safeParse(rawId);
  if (!parsed.success) return errorJson(404, "RUN_NOT_FOUND", "Run not found.");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorJson(401, "UNAUTHENTICATED", "Sign in to continue.");

  try {
    await softDeleteRunForUser(supabase, {
      runId: parsed.data,
      userId: user.id,
    });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof RunNotFoundForUserError) {
      return errorJson(404, "RUN_NOT_FOUND", "Run not found.");
    }
    throw err;
  }
}
