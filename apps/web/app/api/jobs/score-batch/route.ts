import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { enqueueScoreBatch } from "@/lib/queue/producer";
import { getDefaultResume } from "@/lib/db/stores/resume";
import { countHydratedJobs } from "@/lib/db/stores/harvest";
import { toErrorResponse, BadRequestError } from "@/lib/api-errors";
import { peekLlmQuota } from "@/lib/llm/quota";
import { queueConnection } from "@/lib/queue/producer";

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

    /**
     * P7.2.3 / EC-P7-14 — a per-user daily LLM budget, checked before the run.
     *
     * The check is at the DOOR here, not inside the batch: the orchestrator
     * keeps its own per-call accounting so a run that exhausts the quota
     * halfway stops cleanly with its partial results persisted. This one only
     * refuses to START a run for a user who already has nothing left, which is
     * the case where queuing would produce a job that immediately gives up.
     *
     * The message says what happened and when it resets. "Quota exceeded" with
     * no number is indistinguishable from a bug, and a user who cannot tell
     * those apart will retry until they can.
     */
    const quota = await peekLlmQuota(queueConnection(), userId);
    if (!quota.ok) {
      const hours = Math.ceil(quota.retryAfterSec / 3600);
      return NextResponse.json(
        {
          error:
            `You have used all ${quota.limit} of today's scoring and tailoring runs. ` +
            `This resets in about ${hours} hour${hours === 1 ? "" : "s"}. ` +
            "Everything already scored is still there.",
          code: "LLM_QUOTA_EXCEEDED",
          remaining: 0,
        },
        { status: 429, headers: { "Retry-After": String(quota.retryAfterSec) } },
      );
    }

    await enqueueScoreBatch({ userId, harvestRunId: parsed.data.harvestRunId });
    return NextResponse.json(
      { queued: hydrated, quotaRemaining: quota.remaining },
      { status: 202 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
