import "server-only";

import { createHash } from "node:crypto";

import { callHaiku, extractTextFromMessage } from "@/lib/anthropic";
import { getCachedPayload, setCachedPayload } from "@/lib/db/youtube-cache";
import type { Json } from "@/lib/db/types";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { TopVideosSchema } from "@/lib/validation/channels";

// Lightweight per-channel voice descriptor for the script prompt. NOT Feature
// #19 (real personality calibration) — a 7-day-cached Haiku 4.5 approximation
// (CRIT-2 lists Haiku for this sub-call).

const VOICE_FALLBACK =
  "Conversational, direct, peer-to-peer — speaks to fellow practitioners without condescension.";
const CACHE_TTL_SEC = 7 * 24 * 60 * 60;

export async function getVoiceFingerprint(args: {
  channelId: string;
  topVideosJson: unknown;
}): Promise<string> {
  const parsed = TopVideosSchema.safeParse(args.topVideosJson);
  const titles = parsed.success
    ? [...parsed.data]
        .sort((a, b) => b.viewCount - a.viewCount)
        .slice(0, 5)
        .map((v) => v.title)
    : [];
  if (titles.length === 0) return VOICE_FALLBACK;

  const titleHash = createHash("sha256")
    .update(titles.join(""))
    .digest("hex")
    .slice(0, 16);
  const cacheKey = `voice_fp:${args.channelId}:${titleHash}`;

  const supabase = createSupabaseServiceClient();
  const cached = await getCachedPayload(supabase, cacheKey);
  if (cached !== null && typeof cached === "object" && cached !== null) {
    const desc = (cached as { descriptor?: unknown }).descriptor;
    if (typeof desc === "string" && desc.length > 0) return desc;
  }

  try {
    const numbered = titles.map((t, i) => `${i + 1}. ${t}`).join("\n");
    const message = await callHaiku({
      system:
        "You describe a YouTube channel's voice in exactly two sentences: tone (formal/casual), pacing, and rhetorical posture. Output only the two sentences, no preamble.",
      messages: [
        {
          role: "user",
          content: `Recent video titles:\n${numbered}\n\nDescribe this channel's voice in two sentences.`,
        },
      ],
      maxTokens: 160,
    });
    const descriptor = extractTextFromMessage(message).slice(0, 400);
    if (descriptor) {
      await setCachedPayload(
        supabase,
        cacheKey,
        { descriptor } as unknown as Json,
        CACHE_TTL_SEC,
      );
      return descriptor;
    }
  } catch {
    // fall through to fallback
  }
  return VOICE_FALLBACK;
}
