/**
 * Re-run the connection check on an already-stored credential (P5.5.2).
 *
 * Preflight runs once when a credential is saved, and until now that was the
 * only time it could ever run. If that single attempt failed for a reason that
 * had nothing to do with the credential — ④ not yet started, a restart mid-flow,
 * a transient network blip — the credential was stored, valid, and permanently
 * marked unverified, with `preflight_ok_at` null and interlock check 11
 * blocking every send.
 *
 * The only escape was to reconnect from scratch: for SMTP, retyping an app
 * password; for Google, a full OAuth round-trip including the consent screen.
 * Making a user re-authorize to retry a HEALTH CHECK is absurd, and worse, the
 * settings page told them to "re-save it", which is advice that does not exist
 * for the Google path.
 *
 * This endpoint verifies what is already stored. It never accepts credentials
 * in the request body — there is nothing to send, because the whole point is
 * that the secret is already on the server.
 */

import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { toErrorResponse } from "@/lib/api-errors";
import {
  clearPreflight,
  getDecryptedCredential,
  markPreflightOk,
} from "@/lib/db/stores/credentials";
import { refreshAccessToken } from "@/lib/outreach/google-oauth";
import { preflight, WorkerError } from "@/lib/outreach/worker-client";

export const runtime = "nodejs";

export async function POST() {
  try {
    const { userId } = await requireSession();

    const credential = await getDecryptedCredential(userId);
    if (!credential) {
      return NextResponse.json(
        {
          error: "No sending account is connected.",
          code: "NO_CREDENTIAL",
        },
        { status: 404 },
      );
    }

    let accessToken: string | null = null;
    if (credential.provider === "gmail_api") {
      accessToken = credential.gmailRefreshToken
        ? await refreshAccessToken(credential.gmailRefreshToken)
        : null;

      // EC-P5-64: a dead refresh token is a revoked grant, not a flaky check.
      // Clear verification so check 11 keeps blocking, and say what to do.
      if (!accessToken) {
        await clearPreflight(userId);
        return NextResponse.json({
          ok: false,
          reason:
            "Google no longer accepts this authorization. Disconnect and connect again.",
        });
      }
    }

    let result;
    try {
      result = await preflight({
        credentials: {
          provider: credential.provider,
          smtp_host: credential.smtpHost ?? null,
          smtp_port: credential.smtpPort ?? null,
          smtp_user: credential.smtpUser ?? null,
          smtp_password: credential.smtpPassword ?? null,
          sender_name: credential.senderName ?? null,
          gmail_access_token: accessToken,
        },
      });
    } catch (err) {
      // Distinguish "your credential is bad" from "our worker is down". The
      // first is the user's problem; the second is emphatically not, and
      // telling them to fix their password would send them chasing nothing.
      const detail =
        err instanceof WorkerError ? ` (email service: ${err.status})` : "";
      return NextResponse.json({
        ok: false,
        reason:
          `The email service could not be reached${detail}. ` +
          "Your account is still saved — try the check again once it is back.",
      });
    }

    if (result.ok) {
      await markPreflightOk(userId);
    } else {
      // A failed check must not leave a stale pass behind it.
      await clearPreflight(userId);
    }

    return NextResponse.json({ ok: result.ok, reason: result.reason });
  } catch (err) {
    return toErrorResponse(err);
  }
}
