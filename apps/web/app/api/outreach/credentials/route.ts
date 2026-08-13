/**
 * Sending credentials + preflight (P5.5.1, P5.5.2).
 *
 * GET returns STATUS ONLY — connected, verified, can-send. Never the values.
 * There is deliberately no way to read a stored password back out; a "reveal"
 * affordance would put the secret into a response body, a browser cache, and
 * eventually a screenshot in a support thread.
 *
 * POST stores the credential and immediately preflights it. Storing without
 * verifying would leave `preflight_ok_at` null, which interlock check 11 treats
 * as "cannot send" — so the two steps are one action from the user's side.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { BadRequestError, readJson, toErrorResponse } from "@/lib/api-errors";
import {
  credentialStatus,
  deleteCredential,
  getDecryptedCredential,
  markPreflightOk,
  saveCredential,
} from "@/lib/db/stores/credentials";
import { encryptionAvailable, EncryptionUnavailableError } from "@/lib/outreach/crypto";
import { preflight, WorkerError } from "@/lib/outreach/worker-client";

export const runtime = "nodejs";

const SmtpSchema = z.object({
  provider: z.literal("smtp"),
  smtpHost: z.string().min(1).max(255),
  smtpPort: z.number().int().min(1).max(65535).default(587),
  smtpUser: z.string().min(1).max(320),
  smtpPassword: z.string().min(1).max(500),
  senderName: z.string().max(200).nullable().optional(),
});

export async function GET() {
  try {
    const { userId } = await requireSession();
    return NextResponse.json({
      credential: await credentialStatus(userId),
      // Surfaced so the settings screen can explain WHY saving is unavailable
      // rather than failing with a generic error the user cannot act on.
      encryptionAvailable: encryptionAvailable(),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { userId } = await requireSession();
    const parsed = SmtpSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new BadRequestError("Invalid credentials.", parsed.error.flatten());
    }

    try {
      await saveCredential({
        userId,
        secret: {
          provider: "smtp",
          smtpHost: parsed.data.smtpHost,
          smtpPort: parsed.data.smtpPort,
          smtpUser: parsed.data.smtpUser,
          smtpPassword: parsed.data.smtpPassword,
          senderName: parsed.data.senderName ?? null,
        },
      });
    } catch (err) {
      if (err instanceof EncryptionUnavailableError) {
        // Invariant 3: no key means no storage. Never a plaintext fallback.
        return NextResponse.json(
          { error: err.message, code: "ENCRYPTION_UNAVAILABLE" },
          { status: 503 },
        );
      }
      throw err;
    }

    // Verify immediately. `preflight_ok_at` stays null on failure, so check 11
    // keeps blocking until the user fixes the credential.
    const secret = await getDecryptedCredential(userId);
    if (!secret) {
      return NextResponse.json(
        { error: "Saved, but could not be read back. Try again.", code: "STORE_FAILED" },
        { status: 500 },
      );
    }

    let result;
    try {
      result = await preflight({
        credentials: {
          provider: "smtp",
          smtp_host: secret.smtpHost ?? null,
          smtp_port: secret.smtpPort ?? null,
          smtp_user: secret.smtpUser ?? null,
          smtp_password: secret.smtpPassword ?? null,
          sender_name: secret.senderName ?? null,
          gmail_access_token: null,
        },
      });
    } catch (err) {
      const detail = err instanceof WorkerError ? `(${err.status})` : "";
      return NextResponse.json(
        {
          saved: true,
          preflightOk: false,
          error: `Saved, but the connection check could not run ${detail}. Nothing can be sent until it passes.`,
        },
        { status: 200 },
      );
    }

    if (result.ok) await markPreflightOk(userId);

    return NextResponse.json({
      saved: true,
      preflightOk: result.ok,
      reason: result.reason,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const { userId } = await requireSession();
    await deleteCredential(userId);
    return NextResponse.json({ removed: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
