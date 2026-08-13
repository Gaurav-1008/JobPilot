/**
 * Outreach safety settings (P5.5.10).
 *
 * These three columns were read-only from P1.1.5 until now, on the grounds that
 * "read-only in the UI" has to mean "not writable on the server" or it means
 * nothing (EC-P1-07). They become writable here — and only here — because the
 * interlock chain that depends on them now exists.
 *
 * THE RULE THAT MATTERS: turning dry_run OFF requires a credential that has
 * passed preflight. Every other transition is free. Escalation is gated;
 * de-escalation never is, so a worried user can always switch dry run back on.
 *
 * EC-P5-55: a user may flip dry_run between approving and delivering. That is
 * allowed — check 10 reads the live value — but the review screen said "will
 * create a draft", so the outcome is re-confirmed at delivery rather than
 * silently upgraded. This endpoint is where the flip becomes deliberate.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { BadRequestError, readJson, toErrorResponse } from "@/lib/api-errors";
import { credentialStatus } from "@/lib/db/stores/credentials";
import { googleConfigured } from "@/lib/outreach/google-oauth";
import { getOutreachSettings, updateOutreachSettings } from "@/lib/db/users";

export const runtime = "nodejs";

const SettingsSchema = z.object({
  dryRun: z.boolean().optional(),
  sendMode: z.enum(["draft", "send"]).optional(),
  // Ceiling matches the DB CHECK (max_outreach_per_day BETWEEN 1 AND 25) so a
  // bad value is a readable 400 rather than a constraint violation.
  maxOutreachPerDay: z.number().int().min(1).max(25).optional(),
});

export async function GET() {
  try {
    const { userId } = await requireSession();
    return NextResponse.json({
      settings: await getOutreachSettings(userId),
      credential: await credentialStatus(userId),
      // Lets the UI show "Connect Google" only when the server can actually
      // complete the flow, instead of offering a button that 503s.
      googleConfigured: googleConfigured(),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const { userId } = await requireSession();
    const parsed = SettingsSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new BadRequestError("Invalid settings.", parsed.error.flatten());
    }

    const patch = parsed.data;
    const credential = await credentialStatus(userId);

    // ── The gate: leaving dry run requires a verified sender ────────────
    if (patch.dryRun === false) {
      if (!credential) {
        throw new BadRequestError(
          "Connect a sending account before turning dry run off.",
        );
      }
      if (!credential.preflightOk) {
        throw new BadRequestError(
          "Your sending account has not passed its connection check. " +
            "Re-save it to retry, then turn dry run off.",
        );
      }
    }

    // EC-P5-65: switching to 'send' with a drafts-only grant would be caught by
    // interlock check 12 at delivery — but only after the user believed it was
    // configured. Refusing here turns a late failure into an early answer.
    if (patch.sendMode === "send" && credential && !credential.canSend) {
      throw new BadRequestError(
        "Your connected account is authorized for drafts only. " +
          "Reconnect Google with sending access first.",
      );
    }

    // The mirror image: SMTP has no concept of a remote draft, so draft mode
    // with an SMTP account can never succeed. ④ refuses it at delivery; saying
    // so here means the user does not discover it one approved email later.
    if (patch.sendMode === "draft" && credential && !credential.canDraft) {
      throw new BadRequestError(
        "SMTP cannot create drafts. Connect Google for draft mode, or choose 'Send immediately'.",
      );
    }

    return NextResponse.json({
      settings: await updateOutreachSettings(userId, patch),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
