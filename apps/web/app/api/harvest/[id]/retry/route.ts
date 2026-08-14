/**
 * POST /api/harvest/:id/retry — re-run the boards that failed (P7.2.1).
 *
 * ═════════════════════════════════════════════════════════════════════════
 * TWO EDGE CASES, AND THEY PULL IN OPPOSITE DIRECTIONS.
 *
 * EC-P7-12: a retry control must not be offered for a job that is still
 * running. A user watching a slow board will press it, and the second run
 * either duplicates the work or — with deterministic job ids — is silently
 * discarded while the button appears to have done something. Both outcomes
 * teach the user that the button lies.
 *
 * EC-P7-13: a retry must re-run ONLY the failed boards. `board_results` already
 * records which ones those are, so re-scraping the boards that succeeded is
 * pure cost: slower for the user, and a request to a site that did nothing
 * wrong, which is what §11.4's conduct controls exist to prevent.
 *
 * Together they make retry a narrow operation: legal only from a terminal
 * state, and scoped to the subset that actually failed. The server enforces
 * both — the UI disabling a button is a courtesy, not a control.
 * ═════════════════════════════════════════════════════════════════════════
 */

import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { errorResponse, toErrorResponse } from "@/lib/api-errors";
import { getHarvestRun, reopenRunForRetry } from "@/lib/db/stores/harvest";
import { enqueueHarvestBoards } from "@/lib/queue/producer";
import { log } from "@/lib/obs/logger";

export const runtime = "nodejs";

/** A run in any other state still has work in flight. */
const TERMINAL = new Set(["complete", "partial", "failed"]);

/** How many user-initiated retries one run may accumulate. */
const MAX_RETRIES = 3;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requireSession();
    const { id } = await params;

    const run = await getHarvestRun(id, userId);
    // EC-P1-26 — not-yours and does-not-exist give the same answer.
    if (!run) return errorResponse("Run not found.", "RUN_NOT_FOUND", 404);

    // ── EC-P7-12 — refuse while the run is still live. ──
    if (!TERMINAL.has(run.status)) {
      return NextResponse.json(
        {
          error: "This search is still running. Wait for it to finish before retrying.",
          code: "RUN_NOT_TERMINAL",
          status: run.status,
        },
        { status: 409 },
      );
    }

    // ── EC-P7-13 — only the boards that failed. ──
    const results = (run.boardResults ?? {}) as Record<
      string,
      { status?: string; reason?: string | null } | null
    >;
    const failed = run.boards.filter((board) => results[board]?.status === "failed");

    if (failed.length === 0) {
      // Not an error state, and worth saying plainly: the reason there is
      // nothing to retry is that nothing failed.
      return NextResponse.json(
        {
          error: "Every board in this search succeeded. There is nothing to retry.",
          code: "NOTHING_TO_RETRY",
        },
        { status: 400 },
      );
    }

    // A bounded number of retries. Without a cap, a board that is down for the
    // afternoon becomes a button a frustrated user presses twenty times, and
    // every press is a real request to a site that is already struggling.
    const attempt = (run.retryCount ?? 0) + 1;
    if (attempt > MAX_RETRIES) {
      return NextResponse.json(
        {
          error: `This search has already been retried ${MAX_RETRIES} times. Start a new search instead.`,
          code: "RETRY_LIMIT",
        },
        { status: 429 },
      );
    }

    await reopenRunForRetry(id, userId, failed, attempt);

    await enqueueHarvestBoards(
      failed.map((board) => ({
        runId: id,
        userId,
        board,
        role: run.roleQuery,
        location: run.location,
        limit: 20,
      })),
      attempt,
    );

    log.info("harvest.retry", {
      runId: id,
      outcome: "ok",
      count: failed.length,
      attempt,
    });

    return NextResponse.json({ retrying: failed, attempt }, { status: 202 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
