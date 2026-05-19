import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  CreateRunInputSchema,
  RunsListQuerySchema,
} from "@/lib/validation/runs";
import {
  NoActiveChannelError,
  QuotaExceededRunError,
  RateLimitedError,
  createRun,
  listRunsForActiveChannel,
} from "@/lib/services/runs";

export const runtime = "nodejs";

function errorJson(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json({ code, message, ...extra }, { status });
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorJson(401, "UNAUTHENTICATED", "Sign in to continue.");

  const url = new URL(request.url);
  const parsed = RunsListQuerySchema.safeParse({
    q: url.searchParams.get("q") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    page: url.searchParams.get("page") ?? undefined,
  });
  if (!parsed.success) {
    return errorJson(400, "VALIDATION_FAILED", "Invalid query parameters.");
  }

  try {
    const result = await listRunsForActiveChannel(supabase, {
      userId: user.id,
      q: parsed.data.q,
      status: parsed.data.status,
      page: parsed.data.page,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof NoActiveChannelError) {
      return errorJson(
        409,
        "NO_ACTIVE_CHANNEL",
        "Connect a channel before viewing runs.",
      );
    }
    throw err;
  }
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).origin !== new URL(env.SITE_URL).origin) {
    return errorJson(403, "INVALID_ORIGIN", "Origin not allowed.");
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorJson(401, "UNAUTHENTICATED", "Sign in to continue.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorJson(400, "VALIDATION_FAILED", "Request body is not JSON.");
  }

  const parsed = CreateRunInputSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => i.message);
    return errorJson(400, "VALIDATION_FAILED", issues[0] ?? "Invalid idea.", {
      details: { fieldErrors: { ideaText: issues } },
    });
  }

  try {
    const result = await createRun(supabase, {
      userId: user.id,
      ideaText: parsed.data.ideaText,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof NoActiveChannelError) {
      return errorJson(
        409,
        "NO_ACTIVE_CHANNEL",
        "Connect a channel before submitting an idea.",
      );
    }
    if (err instanceof QuotaExceededRunError) {
      return errorJson(
        403,
        "QUOTA_EXCEEDED",
        "We're temporarily over capacity. Try again in a few hours.",
      );
    }
    if (err instanceof RateLimitedError) {
      return errorJson(
        429,
        "RATE_LIMITED",
        "You can submit up to 30 ideas per hour.",
        undefined,
      );
    }
    return errorJson(500, "INTERNAL_ERROR", "Something went wrong.");
  }
}
