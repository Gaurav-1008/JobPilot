/**
 * Tracker rows (P6.1.1) — the system of record, made visible.
 *
 * One request returns everything the board renders: job, scores, resume
 * version, contacts, and the last outreach attempt. Fanning out per row would
 * turn a 40-application board into 120 queries, and the tracker is the screen
 * most likely to be left open.
 */

import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { toErrorResponse } from "@/lib/api-errors";
import { listTrackerRows } from "@/lib/db/stores/tracker";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { userId } = await requireSession();
    const rows = await listTrackerRows(userId);

    return NextResponse.json({
      applications: rows,
      // EC-P6-23: a pending review queue nobody is told about is a queue
      // nobody clears — surfaced as a total the board can show at a glance.
      pendingReview: rows.reduce((n, r) => n + r.pendingReview, 0),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
