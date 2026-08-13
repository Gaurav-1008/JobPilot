/**
 * Contacts (P5.1.1, P5.1.2, P5.1.5, P5.1.6).
 *
 * ADR-008: there is no discovery endpoint here and there never will be. The
 * only way a contact enters the system is a human typing one and declaring its
 * provenance. If this feels like a missing feature, that is the design working.
 *
 * EC-P5-07: `source` has no default and no fallback. A request without it is a
 * 400, not a row with a guessed provenance — the whole point of the column is
 * that it answers "how did I get this address?" months later, at which point an
 * invented default is worse than no record at all.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { BadRequestError, readJson, toErrorResponse } from "@/lib/api-errors";
import { CONTACT_SOURCES, createContact, listContacts } from "@/lib/db/stores/contacts";
import { displayEmail } from "@/lib/outreach/email-address";

export const runtime = "nodejs";

const CreateSchema = z.object({
  applicationId: z.string().uuid(),
  recipientEmail: z.string().min(1).max(320),
  recipientName: z.string().max(200).nullable().optional(),
  // EC-P5-07 / EC-P5-08: required, and constrained to exactly what the DB CHECK
  // accepts so a bad value is a readable 400 rather than a 500 from Postgres.
  source: z.enum(CONTACT_SOURCES),
  personalizationNote: z.string().max(2000).nullable().optional(),
  linkedinUrl: z.string().url().max(500).nullable().optional(),
});

/** EC-P5-05: display form is derived, so an IDN domain reads as the user typed it. */
function present(contact: Awaited<ReturnType<typeof listContacts>>[number]) {
  return {
    id: contact.id,
    applicationId: contact.applicationId,
    recipientEmail: contact.recipientEmail,
    recipientEmailDisplay: displayEmail(contact.recipientEmail),
    recipientName: contact.recipientName,
    // P5.1.5: provenance travels with the contact everywhere it is shown.
    source: contact.source,
    personalizationNote: contact.personalizationNote,
    linkedinUrl: contact.linkedinUrl,
    suppressed: contact.suppressed,
    suppressionReason: contact.suppressionReason,
    createdAt: contact.createdAt.toISOString(),
  };
}

export async function GET(request: Request) {
  try {
    const { userId } = await requireSession();
    const applicationId =
      new URL(request.url).searchParams.get("applicationId") ?? undefined;

    const contacts = await listContacts(userId, applicationId);
    return NextResponse.json({ contacts: contacts.map(present) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { userId } = await requireSession();
    const parsed = CreateSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      // Name the provenance requirement explicitly — a bare "invalid body" here
      // reads as a bug rather than as the deliberate constraint it is.
      const message = flat.fieldErrors.source
        ? "`source` is required: how did you obtain this address? " +
          `One of: ${CONTACT_SOURCES.join(", ")}.`
        : "Invalid contact.";
      throw new BadRequestError(message, flat);
    }

    const result = await createContact({ userId, ...parsed.data });

    if (!result.ok) {
      if (result.reason === "invalid_email") {
        throw new BadRequestError("That is not a valid email address.");
      }
      if (result.reason === "duplicate") {
        return NextResponse.json(
          {
            error: "This address is already a contact on this application.",
            code: "DUPLICATE_CONTACT",
          },
          { status: 409 },
        );
      }
      // EC-P1-26: "not yours" and "does not exist" are the same answer.
      return NextResponse.json(
        { error: "Application not found.", code: "NOT_FOUND" },
        { status: 404 },
      );
    }

    return NextResponse.json({ contact: present(result.contact) }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
