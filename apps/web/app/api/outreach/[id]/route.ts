/**
 * Review one attempt: read and edit (P5.3.4, P5.3.5, P5.3.6).
 *
 * EC-P5-37/38 govern PATCH. An edit is the human writing their own words, so
 * grounding re-runs and WARNS rather than blocking — the user is the
 * accountable author. What must not happen is skipping the re-check while the
 * screen still implies the content was verified.
 *
 * The hash is recomputed on every edit and any existing approval token is
 * destroyed with it (see `updateAttemptBody`). Approval binds to specific
 * bytes; letting a token outlive the text it approved would make interlock
 * check 3 meaningless.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { BadRequestError, readJson, toErrorResponse } from "@/lib/api-errors";
import { getProfile } from "@/lib/db/users";
import {
  getAttemptForReview,
  updateAttemptBody,
} from "@/lib/db/stores/outreach";
import { countWords, normalizeAndHash } from "@/lib/outreach/body";
import { checkGrounding } from "@/lib/outreach/grounding";
import { buildPayload } from "@/lib/outreach/personalization";
import { loadGroundingContext } from "@/lib/outreach/review-context";
import { displayEmail } from "@/lib/outreach/email-address";
import { platformDryRunReason } from "@/lib/outreach/send-policy";

export const runtime = "nodejs";

const notFound = () =>
  NextResponse.json({ error: "Not found.", code: "NOT_FOUND" }, { status: 404 });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requireSession();
    const { id } = await params;

    const attempt = await getAttemptForReview(id, userId);
    if (!attempt || !attempt.contact || !attempt.application) return notFound();

    const ctx = await loadGroundingContext(userId, attempt.applicationId!);
    const profile = await getProfile(userId);
    const payload = ctx.run ? buildPayload(ctx.run) : null;
    const wordLimit = Number(process.env.EMAIL_WORD_LIMIT ?? 150);
    const body = attempt.bodySnapshot ?? "";

    const grounding = ctx.resume
      ? checkGrounding({
          body,
          resume: ctx.resume,
          tailoredBullets: ctx.tailoredBullets,
          skillVocabulary: ctx.skillVocabulary,
          recipientName: attempt.contact.recipientName,
          senderName: profile.candidateName,
          wordLimit,
          wordCount: attempt.wordCount,
          hasPayload: payload !== null,
          genericHook: false,
        })
      : { blocked: false, findings: [] };

    return NextResponse.json({
      id: attempt.id,
      status: attempt.status,
      subject: attempt.subject,
      body,
      bodyHash: attempt.bodyHash,
      wordCount: attempt.wordCount,
      wordLimit,
      generationSource: attempt.generationSource,
      contact: {
        id: attempt.contact.id,
        email: displayEmail(attempt.contact.recipientEmail),
        name: attempt.contact.recipientName,
        source: attempt.contact.source,
      },
      job: {
        title: attempt.application.job.title,
        company: attempt.application.job.company,
      },
      // P5.3.5 — which tailoring artifact produced each hook.
      payload,
      findings: grounding.findings,
      providerAttemptedAt: attempt.providerAttemptedAt?.toISOString() ?? null,
      errorMessage: attempt.errorMessage,
      /**
       * EC-P7-23 — told BEFORE writing and approving, not after.
       *
       * The platform override is invisible from the settings page, which shows
       * the user's own `dry_run` switch. Someone on staging with that switch
       * turned off would write, approve, and send, and only then learn that
       * nothing was ever going to leave the building. Finding out at the end is
       * what makes people stop believing the dry-run indicator entirely.
       */
      platformDryRunReason: platformDryRunReason(),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const PatchSchema = z.object({
  body: z.string().min(1).max(20_000),
  subject: z.string().min(1).max(300).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requireSession();
    const { id } = await params;

    const parsed = PatchSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new BadRequestError("Invalid edit.", parsed.error.flatten());
    }

    const existing = await getAttemptForReview(id, userId);
    if (!existing || !existing.contact) return notFound();

    // EC-P5-48: normalize first, hash the normalized bytes. Same function the
    // generator used, so "what I saw" and "what was hashed" cannot diverge.
    const { body, hash } = normalizeAndHash(parsed.data.body);
    const wordCount = countWords(body);

    const updated = await updateAttemptBody(
      id,
      userId,
      body,
      hash,
      wordCount,
      parsed.data.subject,
    );
    if (!updated) {
      // Already approved-and-delivered, or skipped. Rewriting the snapshot of
      // something already sent would falsify the audit trail.
      return NextResponse.json(
        {
          error: "This draft can no longer be edited.",
          code: "NOT_EDITABLE",
        },
        { status: 409 },
      );
    }

    const ctx = await loadGroundingContext(userId, existing.applicationId!);
    const profile = await getProfile(userId);
    const payload = ctx.run ? buildPayload(ctx.run) : null;
    const wordLimit = Number(process.env.EMAIL_WORD_LIMIT ?? 150);

    // EC-P5-37: re-run and WARN. `blocked` is reported so the UI can show it
    // loudly, but the edit is already persisted — the user's own words are
    // theirs to send.
    const grounding = ctx.resume
      ? checkGrounding({
          body,
          resume: ctx.resume,
          tailoredBullets: ctx.tailoredBullets,
          skillVocabulary: ctx.skillVocabulary,
          recipientName: existing.contact.recipientName,
          senderName: profile.candidateName,
          wordLimit,
          wordCount,
          hasPayload: payload !== null,
          genericHook: false,
        })
      : { blocked: false, findings: [] };

    return NextResponse.json({
      id: updated.id,
      body,
      bodyHash: hash,
      wordCount,
      subject: updated.subject,
      findings: grounding.findings,
      // The approval token, if any, was destroyed by the edit. The UI must ask
      // the user to approve again rather than reusing a stale one.
      requiresReapproval: true,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
