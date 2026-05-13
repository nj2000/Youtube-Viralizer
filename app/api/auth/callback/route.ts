import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { recordLoginAttempt } from "@/lib/db/login-attempts";
import {
  callbackReasonToOutcome,
  mapCallbackError,
  resolvePostAuthDestination,
} from "@/lib/services/auth";
import { CallbackQuerySchema } from "@/lib/validation/auth";

export const runtime = "nodejs";

function errorRedirect(request: NextRequest, reason: ReturnType<typeof mapCallbackError>) {
  const url = request.nextUrl.clone();
  url.pathname = "/sign-in/error";
  url.search = `?reason=${reason}`;
  return NextResponse.redirect(url, 303);
}

export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const parsed = CallbackQuerySchema.safeParse(params);

  const serviceClient = createSupabaseServiceClient();
  const userAgent = request.headers.get("user-agent");
  const forwarded = request.headers.get("x-forwarded-for");
  const ipAddress = forwarded?.split(",")[0]?.trim() ?? null;

  if (!parsed.success) {
    await recordLoginAttempt(serviceClient, {
      email: "",
      outcome: "callback_invalid",
      user_agent: userAgent,
      ip_address: ipAddress ?? undefined,
    });
    return errorRedirect(request, "invalid");
  }

  const { code, token_hash, type, next } = parsed.data;
  const supabase = await createSupabaseServerClient();

  const exchange = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({
        token_hash: token_hash!,
        type: type!,
      });

  if (exchange.error || !exchange.data.session?.user) {
    const reason = mapCallbackError(exchange.error?.message);
    await recordLoginAttempt(serviceClient, {
      email: exchange.data.user?.email ?? "",
      outcome: callbackReasonToOutcome(reason),
      user_agent: userAgent,
      ip_address: ipAddress ?? undefined,
      user_id: exchange.data.user?.id ?? null,
    });
    return errorRedirect(request, reason);
  }

  const user = exchange.data.session.user;
  await recordLoginAttempt(serviceClient, {
    email: user.email ?? "",
    outcome: "callback_success",
    user_agent: userAgent,
    ip_address: ipAddress ?? undefined,
    user_id: user.id,
  });

  const destination = await resolvePostAuthDestination(supabase, user.id, next);
  const dest = request.nextUrl.clone();
  dest.pathname = destination;
  dest.search = "";
  return NextResponse.redirect(dest, 303);
}
