import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  ChannelLimitReachedError,
  DraftExpiredError,
  confirmOnboard,
} from "@/lib/services/onboard";
import { ConfirmRequestSchema } from "@/lib/validation/onboard";

export const runtime = "nodejs";

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status });
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

  const parsed = ConfirmRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(400, "VALIDATION_FAILED", "Invalid confirm payload.");
  }

  if (parsed.data.niche.length === 0) {
    return errorJson(
      400,
      "VALIDATION_FAILED",
      "Niche is required before confirming.",
    );
  }

  try {
    const result = await confirmOnboard(supabase, {
      userId: user.id,
      draftId: parsed.data.draftId,
      niche: parsed.data.niche,
      competitors: parsed.data.competitors,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof DraftExpiredError) {
      return errorJson(
        404,
        "DRAFT_EXPIRED",
        "Onboard draft expired. Re-enter your channel URL.",
      );
    }
    if (err instanceof ChannelLimitReachedError) {
      return errorJson(
        403,
        "CHANNEL_LIMIT_REACHED",
        "You can connect up to 3 channels.",
      );
    }
    return errorJson(
      500,
      "INTERNAL_ERROR",
      "Couldn't save the channel. Please try again.",
    );
  }
}
