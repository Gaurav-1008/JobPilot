/**
 * Skip a draft (P5.3.7).
 *
 * EC-P5-41 — a skip is LOGGED, and it never suppresses a future attempt. Only
 * `sent` and `drafted` feed dedup, so the user can discard a weak draft today
 * and write a better one tomorrow to the same person.
 *
 * The row exists because the audit trail should record decisions, not only
 * actions. "I looked at this and chose not to send it" is a meaningful entry
 * in a proof artifact (FR11); a deleted row says nothing happened at all.
 */

import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { toErrorResponse } from "@/lib/api-errors";
import { skipAttempt } from "@/lib/db/stores/outreach";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requireSession();
    const { id } = await params;

    const skipped = await skipAttempt(id, userId);
    if (!skipped) {
      // Either it is not this user's, or it already reached a terminal state.
      return NextResponse.json(
        { error: "Not found, or no longer skippable.", code: "NOT_FOUND" },
        { status: 404 },
      );
    }
    return NextResponse.json({ status: "skipped" });
  } catch (err) {
    return toErrorResponse(err);
  }
}
