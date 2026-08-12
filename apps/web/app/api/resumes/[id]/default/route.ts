import { NextResponse } from "next/server";

import { setDefaultResume } from "@/lib/db/stores/resume";
import { requireSession } from "@/lib/auth/session";
import { errorResponse, toErrorResponse } from "@/lib/api-errors";

export const runtime = "nodejs";

/**
 * POST /api/resumes/:id/default — EC-P1-20.
 *
 * The unset-then-set happens in one transaction in the store. Two tabs racing
 * here hit the partial unique index rather than both becoming default.
 */
export async function POST(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requireSession();
    const { id } = await params;
    const updated = await setDefaultResume(id, userId);
    if (!updated) return errorResponse("Resume not found.", "RESUME_NOT_FOUND", 404);
    return NextResponse.json({ id: updated.id, isDefault: updated.isDefault });
  } catch (err) {
    return toErrorResponse(err);
  }
}
