/**
 * Begin Google consent (P5.5.3).
 *
 * Requires a session: this connects a mailbox to a specific JobPilot user, and
 * an unauthenticated start would let anyone begin a flow whose callback then
 * attaches a mailbox to whoever happens to be signed in on that browser.
 *
 * CSRF: a random nonce goes into BOTH the `state` parameter and an httpOnly
 * cookie. The callback requires them to match, so a forged callback URL — the
 * classic "attacker completes their own OAuth flow in your session" attack,
 * which would leave the victim silently sending from the attacker's mailbox —
 * has no matching cookie and is refused.
 */

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { toErrorResponse } from "@/lib/api-errors";
import {
  consentUrl,
  googleConfigured,
  GoogleOAuthError,
  type GoogleAccess,
} from "@/lib/outreach/google-oauth";

export const runtime = "nodejs";

export const OAUTH_STATE_COOKIE = "jp_google_oauth_state";

export async function GET(request: Request) {
  try {
    await requireSession();

    if (!googleConfigured()) {
      return NextResponse.json(
        {
          error:
            "Google sending is not configured on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
          code: "NOT_CONFIGURED",
        },
        { status: 503 },
      );
    }

    // Default to the narrower grant. Asking for send when the user only wants
    // drafts trains people to click through consent screens without reading.
    const requested = new URL(request.url).searchParams.get("access");
    const access: GoogleAccess = requested === "send" ? "send" : "draft";

    const nonce = randomBytes(32).toString("hex");
    const state = Buffer.from(JSON.stringify({ nonce, access })).toString(
      "base64url",
    );

    const response = NextResponse.redirect(consentUrl(state, access));

    response.cookies.set(OAUTH_STATE_COOKIE, nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      // MUST be "lax", not "strict": the callback arrives as a top-level
      // navigation from accounts.google.com, and a strict cookie would not be
      // sent with it — every callback would fail the nonce check.
      sameSite: "lax",
      path: "/api/outreach/oauth",
      maxAge: 600,
    });

    return response;
  } catch (err) {
    if (err instanceof GoogleOAuthError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 503 },
      );
    }
    return toErrorResponse(err);
  }
}
