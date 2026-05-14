import { NextResponse } from "next/server";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  countActiveRunsForChannel,
  getChannel,
} from "@/lib/db/channels";

export const runtime = "nodejs";

const ChannelIdSchema = z.string().uuid();

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
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

  const channel = await getChannel(supabase, channelId);
  if (!channel || channel.user_id !== user.id) {
    return errorJson(404, "NOT_FOUND", "Channel not found.");
  }

  const runCount = await countActiveRunsForChannel(supabase, channelId);
  return NextResponse.json({ runCount }, { status: 200 });
}
