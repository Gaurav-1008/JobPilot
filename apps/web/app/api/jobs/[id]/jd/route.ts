import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { saveManualJd } from "@/lib/db/stores/harvest";
import { sanitiseResumeText, UnreadableDocumentError } from "@/lib/resume-text";
import { errorResponse, toErrorResponse, BadRequestError } from "@/lib/api-errors";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({ text: z.string().min(1) });

/**
 * POST /api/jobs/:id/jd — the manual paste fallback (P3.3.4, FR2).
 *
 * This is not a consolation prize. Every hydration failure routes here, and it
 * is what makes "never dead-end the user" true rather than aspirational.
 *
 * EC-P3-05 — a paste NEVER enters `jd_cache`. That cache is cross-user, which
 * is only defensible because a fetched job posting is public content; whatever
 * a user typed carries no such guarantee.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requireSession();
    const { id } = await params;

    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new BadRequestError("Paste the job description text.");

    // Reuses the resume sanitiser: same NUL-byte problem (EC-P1-09), same
    // empty/whitespace and runaway-length checks.
    const clean = sanitiseResumeText(parsed.data.text);

    const result = await saveManualJd(id, userId, clean.text);
    if (!result) return errorResponse("Job not found.", "JOB_NOT_FOUND", 404);

    return NextResponse.json({ ok: true, warnings: clean.warnings });
  } catch (err) {
    if (err instanceof UnreadableDocumentError) {
      return NextResponse.json(
        { error: "UNREADABLE", message: err.message }, { status: 400 },
      );
    }
    return toErrorResponse(err);
  }
}
