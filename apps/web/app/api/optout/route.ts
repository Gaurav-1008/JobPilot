/**
 * Opt-out list management (P5.1.4).
 *
 * This list is the one place a recipient's own wishes are recorded, so it is
 * deliberately easy to add to and requires no application context: a reply
 * saying "stop emailing me" should take one paste, not a hunt for the right
 * application.
 *
 * EC-P5-17: adding an entry here does NOT retroactively suppress existing
 * contact rows, and it does not need to. Suppression is evaluated at SEND time
 * by interlock check 5, so a contact created before the opt-out is still
 * blocked. Doing it the other way — sweeping contacts on write — would leave
 * anything created afterwards unprotected.
 *
 * EC-P5-16: `@company.com` is accepted as a domain-level entry rather than
 * being stored as a literal address that could never match.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { BadRequestError, readJson, toErrorResponse } from "@/lib/api-errors";
import { addOptOut, listOptOuts, removeOptOut } from "@/lib/db/stores/contacts";
import { displayEmail } from "@/lib/outreach/email-address";

export const runtime = "nodejs";

const AddSchema = z.object({
  email: z.string().min(1).max(320),
  reason: z.string().max(500).nullable().optional(),
});

export async function GET() {
  try {
    const { userId } = await requireSession();
    const entries = await listOptOuts(userId);
    return NextResponse.json({
      entries: entries.map((entry) => ({
        email: entry.email,
        // A domain entry has no local part to render; pass it through as-is.
        emailDisplay: entry.email.startsWith("@")
          ? entry.email
          : displayEmail(entry.email),
        isDomain: entry.email.startsWith("@"),
        reason: entry.reason,
        createdAt: entry.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { userId } = await requireSession();
    const parsed = AddSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new BadRequestError("Invalid opt-out entry.", parsed.error.flatten());
    }

    const result = await addOptOut(userId, parsed.data.email, parsed.data.reason);
    if (!result.ok) {
      throw new BadRequestError(
        "Enter a valid email address, or a whole domain as @example.com.",
      );
    }

    return NextResponse.json({ entry: result.entry }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const { userId } = await requireSession();
    const email = new URL(request.url).searchParams.get("email");
    if (!email) throw new BadRequestError("email is required.");

    const removed = await removeOptOut(userId, email);
    if (!removed) {
      return NextResponse.json(
        { error: "No such opt-out entry.", code: "NOT_FOUND" },
        { status: 404 },
      );
    }
    return NextResponse.json({ removed: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
