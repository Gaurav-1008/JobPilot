/**
 * Follow-up sweep persistence (P6.2) — the query half.
 *
 * Lives under lib/db/stores because it touches the Prisma client, which the
 * P0.3.4 lint rule confines to this directory (invariant 5: one file to audit
 * for tenant scoping). The rule caught this during Phase 6 — the sweep was
 * originally written in lib/outreach and imported the client directly.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS FILE MUST NEVER IMPORT THE DELIVERY MODULE.
 *
 * EC-P6-13 is the phase's defining constraint. The sweep creates rows in
 * `generated` state and stops. Follow-ups enter the same review queue and
 * traverse the identical twelve interlocks as anything else, because the
 * moment a scheduled job can send, this stops being a tool that helps someone
 * write email and becomes an automated cold-email engine — the exact thing
 * problemStatement.md §12.3 exists to prevent.
 *
 * The defence is structural rather than procedural: no import of
 * `worker-client`'s deliver, no import of the interlock chain, no call to any
 * /deliver route. A test asserts the absence, because "we checked" decays and
 * a grep does not.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two design corrections from edge-cases/phase-6.md, both of which change what
 * the feature IS rather than how it works:
 *
 * EC-P6-11 — the sweep keys off `outreach_attempts.status='sent'`, NEVER off
 *   `applications.status='emailed'`. In draft mode "delivery succeeded" means
 *   a draft was created in Gmail, which the user may never have sent. Following
 *   up on an email that was never sent is the most embarrassing thing this
 *   feature could do.
 *
 * EC-P6-12 — nothing in this architecture can detect a reply. There is no IMAP
 *   connection, no webhook, no inbox read anywhere. So "no reply after N days"
 *   is really "no response RECORDED BY THE USER after N days", and it is named
 *   that way here and in the UI. Naming it honestly costs nothing; naming it
 *   dishonestly means every user eventually discovers the system was never
 *   watching their inbox.
 */

import { prisma } from "../client";

/** §22.2 Q6 default. Days without a recorded response before a follow-up. */
export const DEFAULT_FOLLOWUP_DAYS = 7;

/** EC-P6-19: two follow-ups maximum. Unbounded chains are pestering. */
export const MAX_FOLLOWUP_DEPTH = 2;

export interface SweepCandidate {
  applicationId: string;
  contactId: string;
  parentAttemptId: string;
  parentSubject: string;
  parentBody: string;
  recipientEmail: string;
  recipientName: string | null;
  company: string;
  role: string;
  depth: number;
}

export interface SweepOptions {
  userId: string;
  days?: number;
  /** EC-P6-21: never generate far more than could plausibly be sent. */
  limit?: number;
  now?: Date;
}

/**
 * Find applications eligible for a follow-up.
 *
 * Pure selection — it reads and returns candidates, writes nothing. Keeping the
 * decision separate from the effect is what lets the rules below be tested
 * without generating anything.
 */
export async function findSweepCandidates(
  options: SweepOptions,
): Promise<SweepCandidate[]> {
  const { userId } = options;
  const days = options.days ?? DEFAULT_FOLLOWUP_DAYS;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const limit = options.limit ?? 5;

  // EC-P6-11: `sent`, not `drafted`, and not the application's status.
  const sent = await prisma.outreachAttempt.findMany({
    where: {
      userId,
      status: "sent",
      createdAt: { lt: cutoff },
      applicationId: { not: null },
      contactId: { not: null },
    },
    orderBy: { createdAt: "asc" },
    include: {
      contact: true,
      application: { include: { job: true } },
    },
  });

  const candidates: SweepCandidate[] = [];

  for (const parent of sent) {
    if (candidates.length >= limit) break;   // EC-P6-21
    // EC-P6-18: an orphan whose application or contact was deleted.
    if (!parent.application || !parent.contact) continue;

    /**
     * EC-P6-12 again, at the row level: a recorded response ends the chain.
     * These are the statuses a human sets to say "something happened", and
     * following up after one is exactly the pestering this cap exists to stop.
     */
    if (["replied", "interviewing", "rejected", "closed"].includes(
      parent.application.status,
    )) {
      continue;
    }

    // EC-P6-16: suppression is checked at GENERATION, not only at the
    // interlock. A draft addressed to someone who opted out is a mis-click
    // waiting to happen, and it should never reach the review queue.
    const suppressed = await prisma.optOutEntry.findFirst({
      where: {
        userId,
        email: {
          in: [
            parent.contact.recipientEmail,
            `@${parent.contact.recipientEmail.split("@").pop()}`,
          ],
        },
      },
      select: { email: true },
    });
    if (suppressed) continue;

    const siblings = await prisma.outreachAttempt.findMany({
      where: { userId, contactId: parent.contactId },
      select: { id: true, status: true, parentId: true, createdAt: true },
    });

    // EC-P6-15: one pending follow-up at a time. Without this a daily sweep
    // fills the review queue with identical drafts until the user clears them
    // carelessly, which is worse than not generating any.
    if (siblings.some((s) => s.status === "generated")) continue;

    // EC-P6-14: already followed up on THIS parent — a second sweep the same
    // day, or any later day, must not produce another.
    if (siblings.some((s) => s.parentId === parent.id)) continue;

    // EC-P6-19: depth cap. Count how many follow-ups already exist for this
    // contact; the parent itself is depth 0.
    const depth = siblings.filter((s) => s.parentId !== null).length;
    if (depth >= MAX_FOLLOWUP_DEPTH) continue;

    // EC-P6-17: a legacy-imported parent has no body to quote. Generating a
    // follow-up that references nothing renders `null` into someone's inbox.
    if (!parent.bodySnapshot) continue;

    candidates.push({
      applicationId: parent.applicationId!,
      contactId: parent.contactId!,
      parentAttemptId: parent.id,
      parentSubject: parent.subject,
      parentBody: parent.bodySnapshot,
      recipientEmail: parent.contact.recipientEmail,
      recipientName: parent.contact.recipientName,
      company: parent.application.job.company,
      role: parent.application.job.title,
      depth: depth + 1,
    });
  }

  return candidates;
}

/**
 * Persist a generated follow-up (P6.2.3).
 *
 * `status: "generated"` and `provider: "dry_run"` are not placeholders — they
 * are the whole guarantee. Nothing here transitions toward delivery, and the
 * row is indistinguishable from a hand-written draft awaiting review, which is
 * precisely what it is.
 */
export async function recordFollowUp(input: {
  userId: string;
  candidate: SweepCandidate;
  subject: string;
  body: string;
  bodyHash: string;
  wordCount: number;
  generationSource: "template" | "llm";
}) {
  return prisma.outreachAttempt.create({
    data: {
      userId: input.userId,
      applicationId: input.candidate.applicationId,
      contactId: input.candidate.contactId,
      parentId: input.candidate.parentAttemptId,
      origin: "platform",
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
