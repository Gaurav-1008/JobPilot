/**
 * Application status transitions driven by outreach (P5.5.9).
 *
 * Kept separate from the outreach store because the rule it encodes is about
 * the APPLICATION funnel, not about email: status only ever moves forward.
 * A second contact added to an application already at `replied` must not drag
 * it back to `contact_added`, and a dry-run delivery must not reset a real
 * reply that already arrived.
 */

import { prisma } from "../client";

/** Funnel order. Anything at or past the target is left alone. */
const RANK: Record<string, number> = {
  saved: 0,
  scored: 1,
  tailored: 2,
  contact_added: 3,
  emailed: 4,
  replied: 5,
  interviewing: 6,
  rejected: 7,
  closed: 8,
};

/**
 * Advance the application behind an outreach attempt, never rewind it.
 *
 * Takes the ATTEMPT id rather than the application id because every caller has
 * the attempt in hand, and looking the application up here keeps the tenant
 * scoping in one place.
 */
export async function prismaSafeUpdateApplication(
  attemptId: string,
  userId: string,
  target: string,
): Promise<void> {
  const attempt = await prisma.outreachAttempt.findFirst({
    where: { id: attemptId, userId },
    select: { applicationId: true },
  });
  if (!attempt?.applicationId) return;

  const application = await prisma.application.findFirst({
    where: { id: attempt.applicationId, userId },
    select: { id: true, status: true },
  });
  if (!application) return;

  const current = RANK[application.status] ?? 0;
  const next = RANK[target] ?? 0;
  if (next <= current) return;

  await prisma.application.update({
    where: { id: application.id },
    data: { status: target },
  });
}
