import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { getJobWithDescription } from "@/lib/db/stores/harvest";
import { errorResponse, toErrorResponse } from "@/lib/api-errors";

export const runtime = "nodejs";

/** GET /api/jobs/:id — EC-P1-26: a foreign id 404s, never 403s. */
export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requireSession();
    const { id } = await params;
    const job = await getJobWithDescription(id, userId);
    if (!job) return errorResponse("Job not found.", "JOB_NOT_FOUND", 404);
    return NextResponse.json(job);
  } catch (err) {
    return toErrorResponse(err);
  }
}
