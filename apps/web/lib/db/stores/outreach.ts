/**
 * Outreach attempt persistence (P5.2.7, P5.3.7, P5.4.8).
 *
 * EC-P5-57 is the rule this file exists to enforce: EVERY outcome writes a row.
 * A block that leaves no trace is unauditable and indistinguishable from a bug,
 * and the user's proof artifact (FR11) is only as honest as this table.
 */

import type { Prisma } from "@prisma/client";

import { prisma } from "../client";

export interface CreateAttemptInput {
  userId: string;
  applicationId: string;
  contactId: string;
  subject: string;
  /** Already normalized by lib/outreach/body.ts. */
  body: string;
  bodyHash: string;
  wordCount: number;
  generationSource: "template" | "llm";
  parentId?: string | null;
}

/**
 * A freshly generated draft, before any human has looked at it.
 *
 * `provider` is 'dry_run' at this point because nothing has been delivered and
 * the column is NOT NULL. The real provider is stamped at delivery, once
 * interlock check 12 has decided what the send mode actually is.
 */
export async function createGeneratedAttempt(input: CreateAttemptInput) {
  return prisma.outreachAttempt.create({
    data: {
      userId: input.userId,
      applicationId: input.applicationId,
      contactId: input.contactId,
      origin: "platform",
      parentId: input.parentId ?? null,
      subject: input.subject,
      bodySnapshot: input.body,
      bodyHash: input.bodyHash,
      wordCount: input.wordCount,
      generationSource: input.generationSource,
      status: "generated",
      provider: "dry_run",
    },
  });
}

/**
 * Persist an edit (P5.3.6).
 *
 * EC-P5-38: the hash is recomputed on every edit, and any approval token minted
 * against the previous text is invalidated by deleting its review event. A
 * stale token plus new text is precisely the state interlock check 3 exists to
 * catch, and leaving it reachable makes the check the only thing standing
 * between an edit and an unreviewed send.
 */
export async function updateAttemptBody(
  attemptId: string,
  userId: string,
  body: string,
  bodyHash: string,
  wordCount: number,
  subject?: string,
) {
  return prisma.$transaction(async (tx) => {
    const attempt = await tx.outreachAttempt.findFirst({
      where: { id: attemptId, userId },
      select: { id: true, status: true },
    });
    if (!attempt) return null;
    // Only an un-delivered draft is editable. Rewriting the snapshot of
    // something already sent would falsify the audit trail.
    if (attempt.status !== "generated") return null;

    await tx.reviewEvent.deleteMany({ where: { attemptId, userId } });

    return tx.outreachAttempt.update({
      where: { id: attemptId },
      data: {
        bodySnapshot: body,
        bodyHash,
        wordCount,
        ...(subject ? { subject } : {}),
      },
    });
  });
}

/**
 * EC-P5-41 — a skip is logged and never suppresses a future attempt. Only
 * `sent` and `drafted` feed dedup, so the user can skip today and write a
 * better email tomorrow.
 */
export async function skipAttempt(attemptId: string, userId: string) {
  const { count } = await prisma.outreachAttempt.updateMany({
    where: { id: attemptId, userId, status: "generated" },
    data: { status: "skipped" },
  });
  return count > 0;
}

/** The review screen's read: the attempt plus everything it is evidence about. */
export async function getAttemptForReview(attemptId: string, userId: string) {
  return prisma.outreachAttempt.findFirst({
    where: { id: attemptId, userId },
    include: {
      contact: true,
      application: { include: { job: true } },
    },
  });
}

export async function listAttemptsForApplication(
  applicationId: string,
  userId: string,
) {
  return prisma.outreachAttempt.findMany({
    where: { applicationId, userId },
    orderBy: { createdAt: "desc" },
    include: { contact: true },
  });
}

/**
 * Record a terminal failure (P5.4.8, EC-P5-57).
 *
 * `check` names the specific interlock that refused, so the audit row answers
 * "why did this not send?" without a log dive. A generic "blocked" would make
 * every failure look the same and hide a real bug among expected refusals.
 */
export async function markAttemptFailed(
  attemptId: string,
  userId: string,
  check: string,
  message: string,
) {
  await prisma.outreachAttempt.updateMany({
    where: { id: attemptId, userId },
    data: { status: "failed", errorMessage: `${check}: ${message}` },
  });
}

/** Stamp the outcome of a delivery (P5.5.8). */
export async function markAttemptDelivered(
  attemptId: string,
  userId: string,
  data: Prisma.OutreachAttemptUpdateManyMutationInput,
) {
  await prisma.outreachAttempt.updateMany({
    where: { id: attemptId, userId },
    data,
  });
}
