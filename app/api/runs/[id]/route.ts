import { NextResponse } from "next/server";

import { getRun } from "@/lib/run-store";
import { errorResponse } from "@/lib/api-errors";

export const runtime = "nodejs";

/** GET /api/runs/:id — return the persisted TailoringRun or 404. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const run = getRun(id);
  if (!run) {
    return errorResponse("Run not found.", "RUN_NOT_FOUND", 404);
  }
  return NextResponse.json(run);
}
