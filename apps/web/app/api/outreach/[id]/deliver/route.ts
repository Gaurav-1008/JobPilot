/**
 * Deliver an approved outreach email (P5.5.6 - P5.5.9).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS IS THE ONLY CODE PATH THAT REACHES A PROVIDER.
 *
 * The order below is fixed and load-bearing:
 *
 *     runInterlocks()  →  burn the token  →  call ④  →  record the outcome
 *
 * The token burn sits AFTER every check and BEFORE the provider call. After,
 * because burning first would consume the approval on a request that a later
 * check refuses. Before, because burning after the provider call leaves a
 * window in which two concurrent requests both deliver (EC-P5-45).
 *
 * There is no bulk variant of this route, and §12.3 says there never will be.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { readJson, toErrorResponse } from "@/lib/api-errors";
import { prismaSafeUpdateApplication } from "@/lib/db/stores/application-status";
import {
  clearPreflight,
  getDecryptedCredential,
} from "@/lib/db/stores/credentials";
import {
  markAttemptDelivered,
  markAttemptFailed,
} from "@/lib/db/stores/outreach";
import { burnToken } from "@/lib/db/stores/review";
import { runInterlocks } from "@/lib/outreach/interlocks";
import { refreshAccessToken } from "@/lib/outreach/google-oauth";
import { deliver as deliverViaWorker, WorkerError } from "@/lib/outreach/worker-client";

export const runtime = "nodejs";

const DeliverSchema = z.object({
  /** The capability minted at approval. Absent → blocked at check 2. */
  token: z.string().min(1).max(200).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requireSession();
    const { id } = await params;

    // A body is optional so a token-less curl reaches the interlocks rather
    // than dying on validation — EC-P5-42 is about check 2 refusing it, and a
    // 400 here would test the parser instead of the safety chain.
    const parsed = DeliverSchema.safeParse(
      await readJson(request).catch(() => ({})),
    );
    const token = parsed.success ? (parsed.data.token ?? null) : null;

    /* ── The chain ────────────────────────────────────────────────────── */
    const verdict = await runInterlocks({ userId, attemptId: id, token });

    if (!verdict.ok) {
      // EC-P5-57: every block writes a row naming the check that refused. A
      // silent block is unauditable and indistinguishable from a bug.
      await markAttemptFailed(id, userId, verdict.check, verdict.message);
      return NextResponse.json(
        { error: verdict.message, code: "BLOCKED", check: verdict.check },
        { status: 422 },
      );
    }

    /* ── Burn the token ───────────────────────────────────────────────── */
    // EC-P5-45: the conditional UPDATE is the authority, not the earlier read.
    // Losing this race means a concurrent request already delivered.
    const burned = await burnToken(userId, token!);
    if (!burned) {
      await markAttemptFailed(
        id,
        userId,
        "approval_token",
        "The approval was already used.",
      );
      return NextResponse.json(
        {
          error: "This email was already sent from another tab or window.",
          code: "BLOCKED",
          check: "approval_token",
        },
        { status: 422 },
      );
    }

    /* ── Dry run: simulate, log, no network ───────────────────────────── */
    // P5.5.7 / EC-P5-60. The request never leaves this process — ④ is not
    // called at all, so there is no socket to assert about.
    if (verdict.mode === "dry_run") {
      await markAttemptDelivered(id, userId, {
        status: "drafted",
        provider: "dry_run",
        bodySnapshot: verdict.body,
        errorMessage: null,
      });
      await prismaSafeUpdateApplication(id, userId, "emailed");
      return NextResponse.json({
        status: "drafted",
        mode: "dry_run",
        message:
          "Dry run — every safety check ran and nothing was sent. Turn dry run off in settings to send for real.",
      });
    }

    /* ── Real delivery ────────────────────────────────────────────────── */
    const credential = await getDecryptedCredential(userId);
    if (!credential) {
      // Check 11 passed a moment ago, so this is a rotation or revocation that
      // landed mid-request. Fail closed.
      await markAttemptFailed(id, userId, "credentials", "Credential unavailable.");
      return NextResponse.json(
        { error: "Your sending account is no longer readable. Reconnect it.", code: "BLOCKED" },
        { status: 422 },
      );
    }

    // P5.5.3: the stored refresh token is exchanged for a short-lived access
    // token HERE, in ①. ④ never sees the long-lived secret.
    //
    // EC-P5-64: a refresh failure means the grant was revoked in the user's
    // Google account. Clear the verification and stop — retrying into a
    // withdrawn grant is exactly the behavior the interlock exists to prevent,
    // and the next attempt now blocks at check 11 with a re-consent prompt.
    let googleAccessToken: string | null = null;
    if (credential.provider === "gmail_api") {
      googleAccessToken = credential.gmailRefreshToken
        ? await refreshAccessToken(credential.gmailRefreshToken)
        : null;

      if (!googleAccessToken) {
        await clearPreflight(userId);
        await markAttemptFailed(
          id,
          userId,
          "credentials",
          "Google authorization was revoked or expired.",
        );
        return NextResponse.json(
          {
            error:
              "Your Google authorization is no longer valid. Reconnect your account in settings.",
            code: "BLOCKED",
            check: "credentials",
          },
          { status: 422 },
        );
      }
    }

    // EC-P5-59: stamped BEFORE the call. If the response is lost, the row still
    // proves an attempt reached the provider — the one direction in which the
    // audit trail must never under-report.
    await markAttemptDelivered(id, userId, {
      provider: credential.provider === "gmail_api" ? "gmail_api" : "smtp",
      providerAttemptedAt: new Date(),
    });

    let result;
    try {
      result = await deliverViaWorker({
        credentials: {
          provider: credential.provider,
          smtp_host: credential.smtpHost ?? null,
          smtp_port: credential.smtpPort ?? null,
          smtp_user: credential.smtpUser ?? null,
          smtp_password: credential.smtpPassword ?? null,
          sender_name: credential.senderName ?? null,
          gmail_access_token: googleAccessToken,
        },
        to: verdict.recipient,
        subject: verdict.subject,
        body: verdict.body,
        mode: verdict.mode,
      });
    } catch (err) {
      const message =
        err instanceof WorkerError ? `worker ${err.status}` : "unreachable";
      await markAttemptFailed(id, userId, "delivery", message);
      return NextResponse.json(
        {
          error:
            "The email service could not be reached. A draft may still have been created — check your mailbox before retrying.",
          code: "DELIVERY_FAILED",
        },
        { status: 502 },
      );
    }

    if (result.status === "failed") {
      // EC-P5-63/64: an auth failure invalidates the credential until the user
      // re-verifies, so the next attempt blocks at check 11 rather than
      // hammering a revoked password.
      if (result.error?.startsWith("auth_failed")) {
        await clearPreflight(userId);
      }
      await markAttemptFailed(id, userId, "delivery", result.error ?? "unknown");
      return NextResponse.json(
        { error: result.error ?? "Delivery failed.", code: "DELIVERY_FAILED" },
        { status: 502 },
      );
    }

    /* ── Success (P5.5.8, P5.5.9) ─────────────────────────────────────── */
    await markAttemptDelivered(id, userId, {
      status: result.status,
      providerMessageId: result.provider_message_id,
      bodySnapshot: verdict.body,
      errorMessage: null,
    });
    await prismaSafeUpdateApplication(id, userId, "emailed");

    return NextResponse.json({
      status: result.status,
      mode: verdict.mode,
      providerMessageId: result.provider_message_id,
      message:
        result.status === "drafted"
          ? "Draft created in your mailbox. Open it there to send."
          : "Sent.",
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

