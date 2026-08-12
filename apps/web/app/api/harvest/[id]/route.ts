import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { getHarvestRun } from "@/lib/db/stores/harvest";
import { errorResponse, toErrorResponse } from "@/lib/api-errors";

export const runtime = "nodejs";

/**
 * GET /api/harvest/:id — the DURABLE run record.
 *
 * EC-P2-42/45: this is the source of truth the UI reconstructs from. The SSE
 * stream is an optimisation that may drop at any time; polling this always
 * works.
 */
export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requireSession();
    const { id } = await params;
    const run = await getHarvestRun(id, userId);
    if (!run) return errorResponse("Run not found.", "RUN_NOT_FOUND", 404);
    return NextResponse.json(run);
  } catch (err) {
    return toErrorResponse(err);
  }
}
