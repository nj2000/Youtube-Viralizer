import { NextResponse, type NextRequest } from "next/server";

import { createSupabaseMiddlewareClient } from "@/lib/supabase/middleware";
import { isSafeNext } from "@/lib/services/auth";

const PROTECTED_PREFIXES = [
  "/onboard",
  "/runs",
  "/api/onboard",
  "/api/channels",
  "/api/profile",
  "/api/competitors",
  "/api/pipeline",
];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function middleware(request: NextRequest) {
  const { supabase, response } = createSupabaseMiddlewareClient(request);

  // Calling getUser() refreshes the cookie when the access token has expired;
  // we always invoke it so SSR cookies stay current even on public routes.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (!isProtected(pathname)) return response;
  if (user) return response;

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = "/sign-in";
  const requested = `${pathname}${search}`;
  redirectUrl.search = isSafeNext(pathname)
    ? `?next=${encodeURIComponent(requested)}`
    : "";

  const redirect = NextResponse.redirect(redirectUrl, 307);
  // Carry over any Set-Cookie headers the SSR client emitted during refresh.
  for (const cookie of response.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
