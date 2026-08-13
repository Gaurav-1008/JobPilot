/**
 * Applications list (P5.1.2 support).
 *
 * The outreach hub needs to answer "which applications can I contact someone
 * about, and have I already?" in one request. Contact and attempt counts come
 * back with each row so the UI never fans out N follow-up queries.
 */

import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { toErrorResponse } from "@/lib/api-errors";
import { listApplicationsForOutreach } from "@/lib/db/stores/contacts";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { userId } = await requireSession();
    return NextResponse.json({
      applications: await listApplicationsForOutreach(userId),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
