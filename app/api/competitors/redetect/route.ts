import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getChannel, updateChannel } from "@/lib/db/channels";
import { identifyCompetitors } from "@/lib/services/competitors";
import { RedetectRequestSchema } from "@/lib/validation/onboard";

export const runtime = "nodejs";

const REDETECT_THROTTLE_MS = 60 * 60 * 1000;

function errorJson(
  status: number,
  code: string,
  message: string,
  headers?: HeadersInit,
) {
  return NextResponse.json({ code, message }, { status, headers });
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

  const parsed = RedetectRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(400, "VALIDATION_FAILED", "Invalid re-detect payload.");
  }

  const { niche, currentChannelHandle, channelId } = parsed.data;

  let ownChannelId: string | null = null;
  let country: string | null = null;

  if (channelId) {
    const channel = await getChannel(supabase, channelId);
    if (!channel || channel.user_id !== user.id) {
      // Cross-user safety: return 404 instead of 403 to avoid existence probe.
      return errorJson(404, "NOT_FOUND", "Channel not found.");
    }
    ownChannelId = channel.youtube_channel_id;
    country = channel.country;

    if (channel.last_competitor_redetect_at) {
      const last = new Date(channel.last_competitor_redetect_at).getTime();
      const elapsed = Date.now() - last;
      if (elapsed < REDETECT_THROTTLE_MS) {
        const retryAfterSec = Math.ceil(
          (REDETECT_THROTTLE_MS - elapsed) / 1000,
        );
        return errorJson(
          429,
          "RATE_LIMITED",
          "Re-detect is available once per hour per channel.",
          { "Retry-After": String(retryAfterSec) },
        );
      }
    }

    // Update the timestamp via the service client so the trigger / RLS
    // contract for last_competitor_redetect_at is enforced consistently.
    const serviceClient = createSupabaseServiceClient();
    await updateChannel(serviceClient, channelId, {
      last_competitor_redetect_at: new Date().toISOString(),
    });
  } else if (currentChannelHandle) {
    ownChannelId = null;
  }

  const result = await identifyCompetitors({ niche, country, ownChannelId });
  return NextResponse.json(
    { competitors: result.competitors, retryAfterSec: null },
    { status: 200 },
  );
}
