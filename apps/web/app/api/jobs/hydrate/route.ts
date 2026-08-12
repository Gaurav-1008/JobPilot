import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { enqueueHydrate } from "@/lib/queue/producer";
import { markJobsQueued } from "@/lib/db/stores/harvest";
import { toErrorResponse, BadRequestError } from "@/lib/api-errors";

export const runtime = "nodejs";

const Body = z.object({
  // FR2 / P3.3.2 — explicit ids only. There is deliberately no "hydrate the
  // whole run" option: hydrating every scraped row is wasteful and unkind to
  // the source sites, and most rows are never opened.
  jobIds: z.array(z.string().uuid()).min(1).max(50),
});

/** POST /api/jobs/hydrate — queue selected jobs for hydration. */
export async function POST(request: Request) {
  try {
    const { userId } = await requireSession();
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      throw new BadRequestError("Select between 1 and 50 jobs.", parsed.error.flatten());
    }

    // Tenant-scoped: ids belonging to another user are silently dropped here,
    // so a crafted request cannot queue work against someone else's rows.
    const owned = await markJobsQueued(parsed.data.jobIds, userId);
    if (owned.length === 0) {
      return NextResponse.json({ queued: 0 }, { status: 202 });
    }

    await enqueueHydrate(owned.map((jobId) => ({ jobId, userId })));
    return NextResponse.json({ queued: owned.length }, { status: 202 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
