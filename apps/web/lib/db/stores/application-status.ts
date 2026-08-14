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
import { advanceApplicationStatus } from "./tracker";

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

  // Delegates rather than reimplementing. This file used to carry its own copy
  // of the rank comparison, which was fine until P6.1.3 added a second rule —
  // manual terminal statuses being sticky (EC-P6-01). Two copies of a status
  // machine drift, and the drift shows up as a user's "rejected" being silently
  // overwritten by a re-tailor.
  await advanceApplicationStatus(attempt.applicationId, userId, target);
}
