/**
 * Complete Google consent (P5.5.3).
 *
 * Google sends the user's BROWSER here, so every exit from this handler is a
 * redirect back to settings with a readable message — never a JSON body. A raw
 * error object rendered in the address bar is where an OAuth flow goes to die.
 *
 * What lands in the database: the refresh token, AES-256-GCM encrypted, and the
 * scope string exactly as Google reported it. The scope string is the record
 * EC-P5-65 depends on — consent screens let users uncheck permissions, so what
 * was requested and what was granted are different facts, and only the second
 * one is safe to act on.
 *
 * `preflight_ok_at` is set only after a live call to Gmail succeeds. A stored
 * credential that has never been exercised is not a working credential, and
 * interlock check 11 treats it as unusable until proven otherwise.
 */

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { markPreflightOk, saveCredential } from "@/lib/db/stores/credentials";
import { EncryptionUnavailableError } from "@/lib/outreach/crypto";
import {
  exchangeCode,
  GoogleOAuthError,
  refreshAccessToken,
} from "@/lib/outreach/google-oauth";
import { preflight } from "@/lib/outreach/worker-client";
import { OAUTH_STATE_COOKIE } from "../start/route";

export const runtime = "nodejs";

const SETTINGS = "/outreach/settings";

/** Every exit is a redirect the user can read. */
function back(request: Request, params: Record<string, string>) {
  const url = new URL(SETTINGS, new URL(request.url).origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = NextResponse.redirect(url);
  // One-shot nonce: clear it whatever the outcome, so a replayed callback
  // cannot reuse it.
  response.cookies.set(OAUTH_STATE_COOKIE, "", {
    path: "/api/outreach/oauth",
    maxAge: 0,
  });
  return response;
}

function noncesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // Length check first: timingSafeEqual throws on a length mismatch.
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: Request) {
  try {
    const { userId } = await requireSession();
    const url = new URL(request.url);

    // The user pressed Cancel, or unchecked everything on the consent screen.
    const denied = url.searchParams.get("error");
    if (denied) {
      return back(request, {
        google: "cancelled",
        message: "Google authorization was cancelled. Nothing changed.",
      });
    }

    const code = url.searchParams.get("code");
    const rawState = url.searchParams.get("state");
    if (!code || !rawState) {
      return back(request, {
        google: "error",
        message: "Google's response was incomplete. Try connecting again.",
      });
    }

    /* ── CSRF: state nonce must match the httpOnly cookie ──────────────── */
    const cookieNonce = request.headers
      .get("cookie")
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`))
      ?.split("=")[1];

    let stateNonce: string | undefined;
    try {
      stateNonce = JSON.parse(
        Buffer.from(rawState, "base64url").toString("utf8"),
      ).nonce;
    } catch {
      stateNonce = undefined;
    }

    if (!cookieNonce || !stateNonce || !noncesMatch(cookieNonce, stateNonce)) {
      return back(request, {
        google: "error",
        message:
          "That authorization link did not come from this browser session. Start again from settings.",
      });
    }

    /* ── Exchange ──────────────────────────────────────────────────────── */
    let grant;
    try {
      grant = await exchangeCode(code);
    } catch (err) {
      if (err instanceof GoogleOAuthError) {
        return back(request, { google: "error", message: err.message });
      }
      throw err;
    }

    /* ── Store, encrypted ──────────────────────────────────────────────── */
    try {
      await saveCredential({
        userId,
        secret: {
          provider: "gmail_api",
          // The long-lived secret never leaves ①; ④ only ever sees an access
          // token with an hour's life.
          gmailRefreshToken: grant.refreshToken,
          senderName: null,
          smtpUser: grant.email,
        },
        // EC-P5-65: what was GRANTED, not what was asked for.
        grantedScopes: grant.grantedScopes,
      });
    } catch (err) {
      if (err instanceof EncryptionUnavailableError) {
        // Invariant 3: no key means no storage, never a plaintext fallback.
        return back(request, {
          google: "error",
          message:
            "Connected to Google, but this server has no ENCRYPTION_KEY, so the credential cannot be stored securely. Nothing was saved.",
        });
      }
      throw err;
    }

    /* ── Prove it works before trusting it ─────────────────────────────── */
    const accessToken =
      grant.accessToken || (await refreshAccessToken(grant.refreshToken));

    if (accessToken) {
      try {
        const check = await preflight({
          credentials: {
            provider: "gmail_api",
            smtp_host: null,
            smtp_port: null,
            smtp_user: null,
            smtp_password: null,
            sender_name: null,
            gmail_access_token: accessToken,
          },
        });
        if (check.ok) await markPreflightOk(userId);
      } catch {
        // Leave preflight unset: check 11 blocks until it passes, which is the
        // correct posture for a credential we could not exercise.
      }
    }

    const canSend = grant.grantedScopes.includes("gmail.send");
    return back(request, {
      google: "connected",
      message: canSend
        ? `Connected${grant.email ? ` as ${grant.email}` : ""}. Drafts and direct sending are both authorized.`
        : `Connected${grant.email ? ` as ${grant.email}` : ""}. Drafts only — reconnect with sending access if you want to send directly.`,
    });
  } catch {
    return back(request, {
      google: "error",
      message: "Could not complete the Google connection. Try again.",
    });
  }
}
