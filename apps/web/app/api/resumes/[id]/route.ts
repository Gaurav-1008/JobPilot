import { NextResponse } from "next/server";

import { getResume, deleteResume } from "@/lib/db/stores/resume";
import { requireSession } from "@/lib/auth/session";
import { errorResponse, toErrorResponse } from "@/lib/api-errors";

export const runtime = "nodejs";

/** GET /api/resumes/:id — EC-P1-26: a foreign id 404s, never 403s. */
export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requireSession();
    const { id } = await params;
    const resume = await getResume(id, userId);
    if (!resume) return errorResponse("Resume not found.", "RESUME_NOT_FOUND", 404);
    return NextResponse.json(resume);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requireSession();
    const { id } = await params;
    const result = await deleteResume(id, userId);

    if (result.ok) return NextResponse.json({ ok: true });

    // Each refusal explains itself. "Cannot delete" with no reason is the kind
    // of error that makes users think the app is broken.
    switch (result.reason) {
      case "not_found":
        return errorResponse("Resume not found.", "RESUME_NOT_FOUND", 404);
      case "would_leave_no_default":
        return errorResponse(
          "Set another resume as default before deleting this one.",
          "WOULD_LEAVE_NO_DEFAULT", 409,
        );
      case "referenced":
        return errorResponse(
          "This resume was used for an application and is kept for the record.",
          "RESUME_REFERENCED", 409,
        );
      default:
        return errorResponse("Could not delete.", "DELETE_FAILED", 400);
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
