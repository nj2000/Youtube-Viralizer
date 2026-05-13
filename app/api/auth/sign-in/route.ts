import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { recordLoginAttempt } from "@/lib/db/login-attempts";
import { checkSendRateLimit } from "@/lib/services/auth";
import { SignInInputSchema } from "@/lib/validation/auth";

export const runtime = "nodejs";

function errorResponse(
  status: number,
  code: string,
  message: string,
  extraHeaders?: HeadersInit,
) {
  return NextResponse.json({ code, message }, { status, headers: extraHeaders });
}

function getClientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return request.headers.get("x-real-ip");
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).origin !== new URL(env.SITE_URL).origin) {
    return errorResponse(403, "INVALID_ORIGIN", "Origin not allowed.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "INVALID_EMAIL", "Request body is not JSON.");
  }

  const parsed = SignInInputSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "INVALID_EMAIL",
      "That doesn't look like a complete email address.",
    );
  }
  const { email, next } = parsed.data;

  const serviceClient = createSupabaseServiceClient();
  const userAgent = request.headers.get("user-agent");
  const ipAddress = getClientIp(request);

  const baseAttempt = {
    email,
    user_agent: userAgent,
    ip_address: ipAddress ?? undefined,
  };

  const limit = await checkSendRateLimit(serviceClient, email);
  if (!limit.allowed) {
    await recordLoginAttempt(serviceClient, {
      ...baseAttempt,
      outcome: "rate_limited",
    });
    return errorResponse(
      429,
      "RATE_LIMITED",
      "Too many sign-in attempts. Try again shortly.",
      { "Retry-After": String(limit.retryAfterSec) },
    );
  }

  const supabase = await createSupabaseServerClient();
  const emailRedirectTo = new URL("/api/auth/callback", env.SITE_URL);
  if (next) emailRedirectTo.searchParams.set("next", next);

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: emailRedirectTo.toString(),
      shouldCreateUser: true,
    },
  });

  if (error) {
    await recordLoginAttempt(serviceClient, {
      ...baseAttempt,
      outcome: "send_failed",
    });
    return errorResponse(
      502,
      "EMAIL_SEND_FAILED",
      "Couldn't send the sign-in link. Please try again in a minute.",
    );
  }

  await recordLoginAttempt(serviceClient, {
    ...baseAttempt,
    outcome: "sent",
  });

  return new NextResponse(null, { status: 204 });
}
