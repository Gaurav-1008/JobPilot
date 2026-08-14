import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { createHarvestRun, failUnqueuedRun } from "@/lib/db/stores/harvest";
import { enqueueHarvest, QueueUnavailableError } from "@/lib/queue/producer";
import { toErrorResponse, BadRequestError } from "@/lib/api-errors";

export const runtime = "nodejs";

const BOARDS = ["naukri", "remoteok", "wellfound"] as const;

const Body = z.object({
  role: z.string().trim().min(1).max(200),
  location: z.string().trim().max(200).nullable().default(null),
  // EC-P2-28: an empty board list would enqueue a run that can do nothing.
  boards: z.array(z.enum(BOARDS)).min(1),
  // EC-P2-14: clamped here, and again in ④ which does not trust this.
  limit: z.number().int().min(1).max(50).default(20),
});

/**
 * POST /api/harvest — 202 + runId (FR1).
 *
 * Returns immediately. Harvesting takes tens of seconds to minutes and must
 * never block a request (§10.4).
 */
export async function POST(request: Request) {
  try {
    const { userId } = await requireSession();
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      throw new BadRequestError("Invalid search.", parsed.error.flatten());
    }
    const { role, location, boards, limit } = parsed.data;

    const run = await createHarvestRun({ userId, role, location, boards });

    try {
      await enqueueHarvest({ runId: run.id, userId, role, location, boards, limit });
    } catch (err) {
      // EC-P7-12 — the row exists but nothing will ever process it. Left
      // `queued`, it is a permanently non-terminal run: the tracker shows it as
      // in progress, and the retry control correctly refuses to offer a retry
      // for a job that is still running. Marking it failed is what makes it
      // retryable once Redis is back.
      if (err instanceof QueueUnavailableError) {
        await failUnqueuedRun(
          run.id,
          "The queue was unreachable, so this search never started.",
        );
      }
      throw err;
    }

    return NextResponse.json({ runId: run.id }, { status: 202 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
