import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { listJobs } from "@/lib/db/stores/harvest";
import { toErrorResponse } from "@/lib/api-errors";

export const runtime = "nodejs";

/** GET /api/jobs — the deduplicated board, newest first. */
export async function GET(request: Request) {
  try {
    const { userId } = await requireSession();
    const url = new URL(request.url);
    const runId = url.searchParams.get("runId");

    const jobs = await listJobs(userId, runId);
    return NextResponse.json({ jobs });
  } catch (err) {
    return toErrorResponse(err);
  }
}
