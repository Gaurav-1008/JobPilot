/**
 * One application: timeline, manual status, notes (P6.1.4, P6.1.5, P6.1.6).
 *
 * The timeline includes skipped and failed attempts deliberately. A tracker
 * showing only successes is a highlight reel, and "what happened with this
 * application?" is a question usually asked precisely when something did not
 * work — a blocked send, a draft never reviewed, an email skipped on purpose.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { BadRequestError, readJson, toErrorResponse } from "@/lib/api-errors";
import {
  getApplicationTimeline,
  MANUAL_STATUSES,
  setApplicationStatusManually,
  updateApplicationNotes,
} from "@/lib/db/stores/tracker";

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
    const timeline = await getApplicationTimeline(id, userId);
    return timeline ? NextResponse.json(timeline) : notFound();
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * The user's own edits.
 *
 * `status` accepts the full vocabulary, not just the manual four. EC-P6-05:
 * moving an application backwards is the user's call — they are recording
 * reality, and reality is not obliged to advance. What the pipeline may do is
 * constrained (see tracker.ts); what a human may do is not.
 */
const PatchSchema = z.object({
  status: z
    .enum([
      "saved", "scored", "tailored", "contact_added",
      "emailed", ...MANUAL_STATUSES,
    ])
    .optional(),
  notes: z.string().max(5000).optional(),
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
      throw new BadRequestError("Invalid update.", parsed.error.flatten());
    }
    if (parsed.data.status === undefined && parsed.data.notes === undefined) {
      throw new BadRequestError("Nothing to update.");
    }

    if (parsed.data.notes !== undefined) {
      const ok = await updateApplicationNotes(id, userId, parsed.data.notes);
      if (!ok) return notFound();
    }
    if (parsed.data.status !== undefined) {
      const set = await setApplicationStatusManually(id, userId, parsed.data.status);
      if (set === null) return notFound();
    }

    const timeline = await getApplicationTimeline(id, userId);
    return timeline ? NextResponse.json(timeline) : notFound();
  } catch (err) {
    return toErrorResponse(err);
  }
}
