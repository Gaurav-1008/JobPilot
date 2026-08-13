import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { enqueueScoreBatch } from "@/lib/queue/producer";
import { getDefaultResume } from "@/lib/db/stores/resume";
import { countHydratedJobs } from "@/lib/db/stores/harvest";
import { toErrorResponse, BadRequestError } from "@/lib/api-errors";

export const runtime = "nodejs";

const Body = z.object({ harvestRunId: z.string().uuid().nullable().default(null) });

/** POST /api/jobs/score-batch — 202 (P4.3.1). */
export async function POST(request: Request) {
  try {
    const { userId } = await requireSession();
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new BadRequestError("Invalid request.");

    // EC-P4-21 — never enqueue a job that must fail. An actionable message
    // beats a queued run that silently does nothing.
    const resume = await getDefaultResume(userId);
    if (!resume) {
      throw new BadRequestError(
        "Upload a resume and set it as default before scoring jobs.",
      );
    }

    // EC-P4-22 — zero hydrated jobs is a message, not an error and not a run.
    const hydrated = await countHydratedJobs(userId, parsed.data.harvestRunId);
    if (hydrated === 0) {
      return NextResponse.json(
        { queued: 0, message: "Fetch some job descriptions first — scoring needs them." },
        { status: 200 },
      );
    }

    await enqueueScoreBatch({ userId, harvestRunId: parsed.data.harvestRunId });
    return NextResponse.json({ queued: hydrated }, { status: 202 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
