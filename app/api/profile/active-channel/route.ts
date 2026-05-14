import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getChannel } from "@/lib/db/channels";
import { setActiveChannel } from "@/lib/db/profiles";
import { SetActiveChannelSchema } from "@/lib/validation/onboard";

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

  const parsed = SetActiveChannelSchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(400, "VALIDATION_FAILED", "Invalid channel id.");
  }

  const channel = await getChannel(supabase, parsed.data.channelId);
  if (!channel || channel.user_id !== user.id) {
    return errorJson(404, "NOT_FOUND", "Channel not found.");
  }

  await setActiveChannel(supabase, user.id, channel.id);
  return new NextResponse(null, { status: 204 });
}
