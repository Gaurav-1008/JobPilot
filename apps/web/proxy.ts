/**
 * Route protection + session refresh (P1.1.3).
 *
 * Named proxy.ts, not middleware.ts: Next 16 renamed the convention and warns
 * on the old name. Same semantics — this runs before every matched request.
 *
 * EC-P1-05 — DEFAULT DENY. Everything is protected; public routes are an
 * explicit allow-list. The reverse (protect a named list) means every new route
 * group added later is public until someone remembers to add it — and nobody
 * remembers.
 *
 * This also refreshes the Supabase session on every request. Access tokens are
 * short-lived; without a refresh here a user is silently signed out mid-session
 * and mutations start failing with 401 for no visible reason.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** The complete set of routes reachable without a session. */
const PUBLIC_PREFIXES = [
  "/sign-in",
  "/sign-up",
  "/auth/callback",
  "/api/auth",   // sign-in/up/out handlers must be reachable while signed out
] as const;

function isPublic(pathname: string): boolean {
  if (pathname === "/") return true;   // landing page
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Invariant 3: misconfiguration must not silently authenticate anyone. With
  // no auth configured, protected routes are unreachable rather than open.
  if (!url || !key) {
    if (isPublic(request.nextUrl.pathname)) return response;
    return NextResponse.json(
      { error: "AUTH_NOT_CONFIGURED", message: "Supabase Auth is not configured." },
      { status: 503 },
    );
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser(), not getSession(): this validates the JWT against the auth server
  // rather than trusting the cookie's contents.
  const { data: { user } } = await supabase.auth.getUser();

  if (!user && !isPublic(request.nextUrl.pathname)) {
    // API callers get a machine-readable 401; humans get redirected.
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "UNAUTHORIZED", message: "Not signed in." },
        { status: 401 },
      );
    }
    const signIn = request.nextUrl.clone();
    signIn.pathname = "/sign-in";
    signIn.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(signIn);
  }

  return response;
}

export const config = {
  // Everything except static assets. Note this INCLUDES /api — the checks above
  // decide what is public, not this matcher.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
