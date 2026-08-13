/**
 * Approve an outreach draft (P5.4.1, P5.4.2).
 *
 * This endpoint replaces The Closer's `input()` confirmation, and it is the
 * structural upgrade of the whole phase (§14.1). A terminal `y/N` is a promise
 * a program makes to itself: nothing outside the process can verify it
 * happened, and nothing binds it to what was actually on screen.
 *
 * Here, approval mints a single-use token bound to `sha256(body)`. Delivery
 * must present that token AND the body must still hash to the approved value,
 * so "the user approved this" becomes a claim the server can check rather than
 * one it takes on faith.
 *
 * EC-P5-48: the client sends the body it displayed. It is normalized and
 * re-hashed HERE, with the same function the generator used — approval binds to
 * the bytes that will actually be handed to the provider, not to whatever the
 * textarea happened to contain.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { BadRequestError, readJson, toErrorResponse } from "@/lib/api-errors";
import { scoped } from "@/lib/db/repository";
import { mintApprovalToken } from "@/lib/db/stores/review";
import { hashBody, normalizeBody } from "@/lib/outreach/body";

export const runtime = "nodejs";

const ApproveSchema = z.object({
  /** What the reviewer actually saw. Compared against the stored draft. */
  body: z.string().min(1).max(20_000),
  subject: z.string().min(1).max(300),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requireSession();
    const { id } = await params;

    const parsed = ApproveSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new BadRequestError("Invalid approval.", parsed.error.flatten());
    }

    const db = scoped(userId);
    const attempt = await db.outreach.byId(id);
    if (!attempt) {
      return NextResponse.json(
        { error: "Not found.", code: "NOT_FOUND" },
        { status: 404 },
      );
    }
    if (attempt.status !== "generated") {
      return NextResponse.json(
        {
          error: `This attempt is already ${attempt.status}.`,
          code: "NOT_APPROVABLE",
        },
        { status: 409 },
      );
    }

    const body = normalizeBody(parsed.data.body);
    const hash = hashBody(body);

    // The reviewer must be approving what is actually stored. A mismatch means
    // the screen drifted from the database — an unsaved edit, or a second tab —
    // and approving the stored copy would bind the token to text the human
    // never read.
    if (hash !== attempt.bodyHash) {
      return NextResponse.json(
        {
          error:
            "This draft changed since it was loaded. Save your edits, re-read the email, then approve.",
          code: "STALE_DRAFT",
        },
        { status: 409 },
      );
    }

    const { token, expiresInMinutes } = await mintApprovalToken(
      userId,
      id,
      parsed.data.subject,
      hash,
    );

    // The raw token is returned exactly once and never stored — only its hash
    // is. It is a capability, not an identifier.
    return NextResponse.json({ token, expiresInMinutes });
  } catch (err) {
    return toErrorResponse(err);
  }
}
