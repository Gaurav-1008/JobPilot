import { NextResponse } from "next/server";

import { getRun } from "@/lib/db/stores/tailoring-run";
import { requireSession } from "@/lib/auth/session";
import { errorResponse, toErrorResponse } from "@/lib/api-errors";

export const runtime = "nodejs";

/**
 * GET /api/runs/:id — the persisted TailoringRun, or 404.
 *
 * EC-P1-26: the lookup is tenant-scoped and another user's valid id resolves to
 * null, so this returns 404 — NOT 403. For tenant-scoped resources "not yours"
 * and "does not exist" must be the same response; a 403 confirms the id exists,
 * which is an enumeration oracle across the whole platform.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requireSession();
    const { id } = await params;
    const run = await getRun(id, userId);
    if (!run) {
      return errorResponse("Run not found.", "RUN_NOT_FOUND", 404);
    }
    return NextResponse.json(run);
  } catch (err) {
    return toErrorResponse(err);
  }
}
