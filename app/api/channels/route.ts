import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listChannels } from "@/lib/db/channels";
import { getProfile } from "@/lib/db/profiles";

export const runtime = "nodejs";

const CHANNEL_LIMIT = 3;

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status });
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorJson(401, "UNAUTHENTICATED", "Sign in to continue.");

  const [channels, profile] = await Promise.all([
    listChannels(supabase, user.id),
    getProfile(supabase, user.id),
  ]);

  return NextResponse.json(
    {
      channels: channels.map((c) => ({
        id: c.id,
        youtubeChannelId: c.youtube_channel_id,
        handle: c.handle,
        title: c.title,
        niche: c.niche,
        subscriberCount: c.subscriber_count,
        isActive: profile?.active_channel_id === c.id,
      })),
      activeChannelId: profile?.active_channel_id ?? null,
      channelLimit: CHANNEL_LIMIT,
      channelCount: channels.length,
    },
    { status: 200 },
  );
}
