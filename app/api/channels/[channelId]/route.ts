import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { env } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  getChannel,
  listChannels,
  softDeleteChannel,
  softDeletePipelineRunsForChannel,
} from "@/lib/db/channels";
import { getProfile, setActiveChannel } from "@/lib/db/profiles";

export const runtime = "nodejs";

const ChannelIdSchema = z.string().uuid();

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).origin !== new URL(env.SITE_URL).origin) {
    return errorJson(403, "INVALID_ORIGIN", "Origin not allowed.");
  }

  const { channelId: rawChannelId } = await params;
  const parsed = ChannelIdSchema.safeParse(rawChannelId);
  if (!parsed.success) {
    return errorJson(404, "NOT_FOUND", "Channel not found.");
  }
  const channelId = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorJson(401, "UNAUTHENTICATED", "Sign in to continue.");

  // Cross-user reads return null via RLS; we surface 404 (not 403) to avoid
  // existence probes per the verification matrix.
  const channel = await getChannel(supabase, channelId);
  if (!channel || channel.user_id !== user.id) {
    return errorJson(404, "NOT_FOUND", "Channel not found.");
  }

  const serviceClient = createSupabaseServiceClient();
  const deletedRunCount = await softDeletePipelineRunsForChannel(
    serviceClient,
    channelId,
  );
  await softDeleteChannel(serviceClient, channelId);

  const profile = await getProfile(supabase, user.id);
  if (profile?.active_channel_id === channelId) {
    const remaining = await listChannels(supabase, user.id);
    const next = remaining[0]?.id ?? null;
    await setActiveChannel(supabase, user.id, next);
  }

  return NextResponse.json({ deletedRunCount }, { status: 200 });
}
