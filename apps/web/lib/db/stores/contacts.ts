/**
 * Contacts and opt-out persistence (P5.1).
 *
 * ADR-008 governs this whole file: JobPilot does not discover contacts. There
 * is no enrichment call, no pattern guesser, no "find the recruiter" button.
 * A contact enters the system because a human put it there and said where it
 * came from. `source` is NOT NULL with no default in the schema, and nothing
 * here supplies one — if a caller omits it the insert fails, which is the
 * intended pressure.
 *
 * EC-P5-19: the same address on two applications is two rows, by design
 * (`UNIQUE (user_id, application_id, recipient_email)`). Dedup at send time
 * keys on the PERSON instead, so the second row still gets blocked — see
 * EC-P5-50 and interlock check 6.
 */

import { Prisma } from "@prisma/client";

import { normalizeEmail, normalizeOptOutEntry } from "@/lib/outreach/email-address";
import { prisma } from "../client";

/** The only sources the DB CHECK accepts. `public_profile` is deliberately absent. */
export const CONTACT_SOURCES = [
  "user_entered",
  "company_careers_page",
  "imported_csv",
] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

export interface CreateContactInput {
  userId: string;
  applicationId: string;
  recipientEmail: string;
  recipientName?: string | null;
  source: ContactSource;
  personalizationNote?: string | null;
  linkedinUrl?: string | null;
}

export type CreateContactResult =
  | { ok: true; contact: Awaited<ReturnType<typeof prisma.contact.create>> }
  | { ok: false; reason: "invalid_email" | "no_application" | "duplicate" };

/**
 * Create one contact and advance the application (P5.1.6).
 *
 * The application lookup is tenant-scoped and happens INSIDE the transaction:
 * without it a caller could attach a contact to another user's application by
 * guessing a UUID, and the contact row's own `user_id` would look perfectly
 * legitimate afterwards.
 */
export async function createContact(
  input: CreateContactInput,
): Promise<CreateContactResult> {
  const email = normalizeEmail(input.recipientEmail);
  if (!email) return { ok: false, reason: "invalid_email" };

  try {
    return await prisma.$transaction(async (tx) => {
      const application = await tx.application.findFirst({
        where: { id: input.applicationId, userId: input.userId },
        select: { id: true, status: true },
      });
      if (!application) return { ok: false as const, reason: "no_application" as const };

      const contact = await tx.contact.create({
        data: {
          userId: input.userId,
          applicationId: input.applicationId,
          recipientEmail: email,
          recipientName: input.recipientName ?? null,
          source: input.source,
          personalizationNote: input.personalizationNote ?? null,
          linkedinUrl: input.linkedinUrl ?? null,
        },
      });

      // Only advance forward. A contact added to an application already at
      // 'emailed' or 'replied' must not drag it backwards down the funnel.
      if (application.status === "saved" || application.status === "scored" ||
          application.status === "tailored") {
        await tx.application.update({
          where: { id: application.id },
          data: { status: "contact_added" },
        });
      }

      return { ok: true as const, contact };
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return { ok: false, reason: "duplicate" };
    }
    throw err;
  }
}

export async function listContacts(userId: string, applicationId?: string) {
  return prisma.contact.findMany({
    where: { userId, ...(applicationId ? { applicationId } : {}) },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Applications the outreach hub can act on, with the counts it needs to render
 * without a follow-up query per row.
 *
 * `_count.outreachAttempts` counts every attempt including `skipped` and
 * `failed` on purpose: the hub is an audit surface, and hiding failures there
 * would make a blocked send look like it never happened.
 */
export async function listApplicationsForOutreach(userId: string) {
  const applications = await prisma.application.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    include: {
      job: { select: { title: true, company: true, link: true } },
      _count: { select: { contacts: true, outreachAttempts: true } },
    },
  });

  return applications.map((application) => ({
    id: application.id,
    status: application.status,
    jobTitle: application.job.title,
    company: application.job.company,
    jobUrl: application.job.link,
    contactCount: application._count.contacts,
    attemptCount: application._count.outreachAttempts,
    updatedAt: application.updatedAt.toISOString(),
  }));
}

/* ---------------- Opt-out (P5.1.4) ---------------- */

/**
 * EC-P5-16: accepts either a single address or a whole `@domain`. Both forms
 * are normalized; interlock check 5 tests an address against both.
 *
 * Idempotent — re-adding an existing entry is a no-op rather than an error,
 * because the user's intent ("this address must not be contacted") is already
 * satisfied and a 409 here would be noise.
 */
export async function addOptOut(
  userId: string,
  rawEmail: string,
  reason?: string | null,
): Promise<{ ok: boolean; entry?: string }> {
  const email = normalizeOptOutEntry(rawEmail);
  if (!email) return { ok: false };

  await prisma.optOutEntry.upsert({
    where: { userId_email: { userId, email } },
    create: { userId, email, reason: reason ?? null },
    update: {},
  });
  return { ok: true, entry: email };
}

export async function listOptOuts(userId: string) {
  return prisma.optOutEntry.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function removeOptOut(userId: string, rawEmail: string): Promise<boolean> {
  const email = normalizeOptOutEntry(rawEmail);
  if (!email) return false;

  const { count } = await prisma.optOutEntry.deleteMany({ where: { userId, email } });
  return count > 0;
}

/* ---------------- CSV import (P5.1.3) ---------------- */

export interface ImportRow {
  recipientEmail: string;
  recipientName?: string | null;
  personalizationNote?: string | null;
  linkedinUrl?: string | null;
}

export interface ImportOutcome {
  imported: number;
  skipped: { row: number; email: string; reason: string }[];
}

/**
 * Bulk-create contacts for one application.
 *
 * EC-P5-14: a bad record skips with an actionable warning naming its row
 * number; it never aborts the batch. Half a spreadsheet being wrong is the
 * normal case, and failing the whole import teaches users to stop importing.
 *
 * Rows are inserted individually rather than via createMany so that one
 * duplicate cannot roll back the rows around it.
 */
export async function importContacts(
  userId: string,
  applicationId: string,
  rows: ImportRow[],
): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { imported: 0, skipped: [] };

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;   // +1 for zero-index, +1 for the header line
    const result = await createContact({
      userId,
      applicationId,
      recipientEmail: row.recipientEmail,
      recipientName: row.recipientName ?? null,
      source: "imported_csv",
      personalizationNote: row.personalizationNote ?? null,
      linkedinUrl: row.linkedinUrl ?? null,
    });

    if (result.ok) {
      outcome.imported += 1;
      continue;
    }

    const reason =
      result.reason === "invalid_email"
        ? "not a valid email address"
        : result.reason === "duplicate"
          ? "already a contact on this application"
          : "application not found";
    outcome.skipped.push({ row: rowNumber, email: row.recipientEmail, reason });
  }

  return outcome;
}
