import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSSEStream } from "@/lib/streaming/sse";
import {
  ChannelLimitReachedError,
  runOnboard,
  type OnboardProgress,
} from "@/lib/services/onboard";
import { countActiveChannels } from "@/lib/db/channels";
import {
  InvalidChannelError,
  QuotaExceededError,
  UpstreamError,
} from "@/lib/youtube/errors";
import { OnboardRequestSchema } from "@/lib/validation/onboard";
import { assertHeadroom } from "@/lib/youtube/quota";

export const runtime = "nodejs";

const CHANNEL_LIMIT = 3;
// Spec's fresh-onboard quota envelope: URL resolution + metadata + videos +
// 5 competitor searches + hydrate ≈ 520 units. Pre-check at 600 leaves
// headroom for parallel users without false-positive blocking on cache hits.
const ONBOARD_QUOTA_BUDGET = 600;

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status });
}

function mapUpstreamError(err: UpstreamError): {
  code: string;
  message: string;
} {
  if (err.httpStatus === 404) {
    return {
      code: "CHANNEL_NOT_FOUND",
      message: "We couldn't find that channel on YouTube.",
    };
  }
  if (err.httpStatus === 403) {
    return {
      code: "CHANNEL_PRIVATE",
      message: "That channel is private and can't be analyzed.",
    };
  }
  if (err.httpStatus === 410) {
    return {
      code: "CHANNEL_TERMINATED",
      message: "That channel has been terminated by YouTube.",
    };
  }
  return {
    code: "UPSTREAM_ERROR",
    message: "YouTube didn't respond. Please try again in a minute.",
  };
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

  const parsed = OnboardRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(400, "VALIDATION_FAILED", "Invalid onboarding payload.");
  }

  const channelCount = await countActiveChannels(supabase, user.id);
  if (channelCount >= CHANNEL_LIMIT) {
    return errorJson(
      403,
      "CHANNEL_LIMIT_REACHED",
      "You can connect up to 3 channels. Remove one to add another.",
    );
  }

  try {
    await assertHeadroom(ONBOARD_QUOTA_BUDGET);
  } catch (err) {
    if (err instanceof QuotaExceededError) {
      return errorJson(
        429,
        "QUOTA_EXCEEDED",
        "We're temporarily over capacity. Try again in a few hours.",
      );
    }
    throw err;
  }

  const stream = createSSEStream<OnboardProgress, unknown>();

  (async () => {
    try {
      const draft = await runOnboard(user.id, parsed.data.url, (event) =>
        stream.emitProgress(event),
      );
      stream.emitComplete(draft);
    } catch (err) {
      if (err instanceof InvalidChannelError) {
        stream.emitError({
          code: "INVALID_URL",
          message: "That doesn't look like a YouTube channel URL.",
        });
        return;
      }
      if (err instanceof QuotaExceededError) {
        stream.emitError({
          code: "QUOTA_EXCEEDED",
          message: "We're temporarily over capacity. Try again in a few hours.",
        });
        return;
      }
      if (err instanceof ChannelLimitReachedError) {
        stream.emitError({
          code: "CHANNEL_LIMIT_REACHED",
          message: "You can connect up to 3 channels.",
        });
        return;
      }
      if (err instanceof UpstreamError) {
        stream.emitError(mapUpstreamError(err));
        return;
      }
      stream.emitError({
        code: "INTERNAL_ERROR",
        message: "Something went wrong. Please try again.",
      });
    }
  })();

  return stream.response;
}
