/**
 * Application tracker persistence (P6.1) — closes Breakage 3.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE STATUS MACHINE HAS TWO WRITERS, AND THEY WILL FIGHT.
 *
 * Automatic transitions fire from the pipeline (scored → tailored →
 * contact_added → emailed). Manual ones come from the user. Left ungoverned
 * they overwrite each other, and the direction that matters is specific:
 * EC-P6-01, a user marks an application `rejected`, re-tailors it out of
 * curiosity, and the automatic transition quietly erases their record of the
 * rejection.
 *
 * Two rules resolve it, and both are code rather than convention:
 *
 *   1. Automatic transitions only ADVANCE (EC-P6-02). Rank comparison in the
 *      update itself, not a blind set, so two racing transitions still land on
 *      the further one (EC-P6-03).
 *   2. Manual TERMINAL statuses are sticky. Once a human says replied,
 *      interviewing, rejected or closed, no automatic writer may move it.
 *
 * The user, by contrast, may set anything — including backwards (EC-P6-05).
 * They are tracking reality, and reality is not required to advance.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { prisma } from "../client";

/** Funnel order. Automatic transitions may only increase this. */
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
 * Statuses only a human can set, and which no automatic transition may
 * overwrite. `emailed` is deliberately NOT here: the pipeline owns it.
 */
export const MANUAL_STATUSES = [
  "replied",
  "interviewing",
  "rejected",
  "closed",
] as const;
export type ManualStatus = (typeof MANUAL_STATUSES)[number];

const isManualTerminal = (status: string): boolean =>
  (MANUAL_STATUSES as readonly string[]).includes(status);

/**
 * Advance an application from the pipeline (P6.1.3).
 *
 * Returns the status actually in force afterwards, which may be the one it
 * already had — callers should not assume their write won.
 */
export async function advanceApplicationStatus(
  applicationId: string,
  userId: string,
  target: string,
): Promise<string | null> {
  const application = await prisma.application.findFirst({
    where: { id: applicationId, userId },
    select: { id: true, status: true },
  });
  if (!application) return null;

  // EC-P6-01: a human's terminal verdict outranks any pipeline event.
  if (isManualTerminal(application.status)) return application.status;

  const current = RANK[application.status] ?? 0;
  const next = RANK[target] ?? 0;
  if (next <= current) return application.status;   // EC-P6-02

  // EC-P6-03: the rank comparison is IN the update. Two transitions racing
  // (a tailoring run finishing as an email delivers) both write, and the
  // further one survives regardless of arrival order.
  const rows = await prisma.$queryRaw<{ status: string }[]>`
    UPDATE applications
    SET status = ${target}, updated_at = now()
    WHERE id = ${applicationId}::uuid
      AND user_id = ${userId}::uuid
      AND status NOT IN ('replied', 'interviewing', 'rejected', 'closed')
      AND CASE status
            WHEN 'saved' THEN 0 WHEN 'scored' THEN 1 WHEN 'tailored' THEN 2
            WHEN 'contact_added' THEN 3 WHEN 'emailed' THEN 4
            ELSE 99 END < ${next}
    RETURNING status
  `;
  return rows[0]?.status ?? application.status;
}

/**
 * A user's own status change (P6.1.4).
 *
 * Deliberately unconstrained by rank. EC-P6-04: setting `emailed` with no
 * attempt on file is allowed, because people email outside the app — the
 * timeline is what distinguishes that, by showing no attempts rather than
 * pretending to. EC-P6-05: moving backwards is allowed too.
 */
export async function setApplicationStatusManually(
  applicationId: string,
  userId: string,
  status: string,
) {
  const { count } = await prisma.application.updateMany({
    where: { id: applicationId, userId },
    data: { status },
  });
  if (count === 0) return null;

  console.info(
    JSON.stringify({ event: "application.manual_status", applicationId, status }),
  );
  return status;
}

export async function updateApplicationNotes(
  applicationId: string,
  userId: string,
  notes: string,
) {
  const { count } = await prisma.application.updateMany({
    where: { id: applicationId, userId },
    data: { notes },
  });
  return count > 0;
}

/**
 * Every application with the columns the tracker board renders (P6.1.1).
 *
 * EC-P6-06: an application created by scoring alone has no contact and no
 * tailoring run. That is the majority state straight after a harvest, so every
 * field here tolerates absence — the row renders with blanks rather than
 * throwing.
 */
export async function listTrackerRows(userId: string) {
  const applications = await prisma.application.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      job: { select: { title: true, company: true, link: true, location: true } },
      resume: { select: { version: true } },
      contacts: { select: { recipientEmail: true, recipientName: true } },
      outreachAttempts: {
        orderBy: { createdAt: "desc" },
        select: { status: true, createdAt: true, parentId: true },
      },
    },
  });

  return applications.map((a) => {
    const attempts = a.outreachAttempts;
    return {
      id: a.id,
      status: a.status,
      jobTitle: a.job.title,
      company: a.job.company,
      location: a.job.location,
      jobUrl: a.job.link,
      originalScore: a.originalScore,
      tailoredScore: a.tailoredScore,
      resumeVersion: a.resume?.version ?? null,
      contactCount: a.contacts.length,
      firstContact: a.contacts[0]?.recipientEmail ?? null,
      attemptCount: attempts.length,
      lastAttemptStatus: attempts[0]?.status ?? null,
      lastAttemptAt: attempts[0]?.createdAt.toISOString() ?? null,
      /** EC-P6-23: a review queue nobody can see is a queue nobody clears. */
      pendingReview: attempts.filter((t) => t.status === "generated").length,
      notes: a.notes,
      updatedAt: a.updatedAt.toISOString(),
    };
  });
}

/**
 * The per-application timeline (P6.1.5).
 *
 * Includes skips and failures on purpose. A tracker that shows only successes
 * is a highlight reel, and the question this table exists to answer — "what
 * happened with this application?" — is usually asked when something did not
 * work.
 */
export async function getApplicationTimeline(applicationId: string, userId: string) {
  const application = await prisma.application.findFirst({
    where: { id: applicationId, userId },
    include: {
      job: true,
      resume: { select: { version: true } },
      contacts: true,
      outreachAttempts: {
        orderBy: { createdAt: "asc" },
        include: { contact: { select: { recipientEmail: true, recipientName: true } } },
      },
      tailoringRuns: { orderBy: { createdAt: "asc" }, select: { id: true, tier: true, createdAt: true } },
    },
  });
  if (!application) return null;

  return {
    id: application.id,
    status: application.status,
    notes: application.notes,
    job: {
      title: application.job.title,
      company: application.job.company,
      location: application.job.location,
      url: application.job.link,
    },
    resumeVersion: application.resume?.version ?? null,
    originalScore: application.originalScore,
    tailoredScore: application.tailoredScore,
    contacts: application.contacts.map((c) => ({
      id: c.id,
      email: c.recipientEmail,
      name: c.recipientName,
      source: c.source,
    })),
    tailoringRuns: application.tailoringRuns.map((r) => ({
      id: r.id,
      tier: r.tier,
      createdAt: r.createdAt.toISOString(),
    })),
    attempts: application.outreachAttempts.map((t) => ({
      id: t.id,
      status: t.status,
      provider: t.provider,
      subject: t.subject,
      wordCount: t.wordCount,
      generationSource: t.generationSource,
      providerMessageId: t.providerMessageId,
      // EC-P5-59: surfaced so "this may have been created" stays visible.
      providerAttemptedAt: t.providerAttemptedAt?.toISOString() ?? null,
      errorMessage: t.errorMessage,
      isFollowUp: t.parentId !== null,
      recipient: t.contact?.recipientEmail ?? null,
      createdAt: t.createdAt.toISOString(),
    })),
  };
}
