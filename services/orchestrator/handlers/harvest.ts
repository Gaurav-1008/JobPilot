/**
 * Harvest handlers (P2.2.3, P2.2.4) — ③, the single writer.
 *
 * ADR-004 fan-out: `harvest:run` enqueues one `harvest:board` child per board,
 * and each child owns its own timeout, retries, rate limit, and failure state.
 *
 * P2.2.10 is the governing rule: A BOARD FAILURE IS DATA, NOT AN EXCEPTION.
 * Nothing in this file throws on a board problem — it records the outcome and
 * lets the run continue. A thrown error here would fail a run that other boards
 * are succeeding in.
 */

import type { PrismaClient } from "@prisma/client";
import type { Queue } from "bullmq";
import type Redis from "ioredis";

import { dedupeKey } from "../lib/dedupe";
import { BoardCircuitBreaker, BoardRateLimiter } from "../lib/board-circuit";
import { parsePostedAt } from "../lib/posted-at";
import type { HarvestBoardJob, HarvestRunJob } from "../../../apps/web/lib/queue/types";
import { boardJobId } from "../../../apps/web/lib/queue/types";

export interface Deps {
  prisma: PrismaClient;
  redis: Redis;
  queue: Queue;
  limiter: BoardRateLimiter;
  breaker: BoardCircuitBreaker;
  callBoard: (board: string, body: {
    role: string; location: string | null; limit: number;
  }) => Promise<{
    jobs: Array<{
      source: string; title: string; company: string;
      location: string | null; link: string; posted_at: string | null;
    }>;
    partial: boolean;
    error: string | null;
    response_bytes: number | null;
  }>;
}

type BoardStatus = "ok" | "partial" | "failed";

async function setBoardResult(
  deps: Deps, runId: string, board: string,
  result: { status: BoardStatus; count: number; reason: string | null; responseBytes: number | null },
) {
  // Durable per-board progress (EC-P2-42/45). This is the SOURCE OF TRUTH the
  // UI reconstructs from; the SSE stream is only an optimisation.
  const run = await deps.prisma.harvestRun.findUnique({
    where: { id: runId }, select: { boardResults: true },
  });
  if (!run) return;   // EC-P2-37: the run was cancelled or cascade-deleted
  const merged = { ...(run.boardResults as object ?? {}), [board]: result };
  await deps.prisma.harvestRun.update({
    where: { id: runId }, data: { boardResults: merged },
  });
  // Best-effort live channel. A failure here must not affect the run.
  await deps.redis.publish(`harvest:${runId}`, JSON.stringify({ board, ...result }))
    .catch(() => {});
}

/** Fan out one child per board, then mark the run running. */
export async function handleHarvestRun(deps: Deps, data: HarvestRunJob): Promise<void> {
  // EC-P2-37 — the run may be gone: the user cancelled, or their account was
  // deleted and the cascade took it. A queued job for a vanished run is a
  // NO-OP, not a failure. Treating it as a failure fills the dead-letter queue
  // with noise and buries the retries that actually matter.
  const updated = await deps.prisma.harvestRun.updateMany({
    where: { id: data.runId },
    data: { status: "running", startedAt: new Date() },
  });
  if (updated.count === 0) return;

  for (const board of data.boards) {
    await deps.queue.add(
      "harvest:board",
      {
        runId: data.runId, userId: data.userId, board,
        role: data.role, location: data.location, limit: data.limit,
      } satisfies HarvestBoardJob,
      {
        // P2.2.5 — deterministic id. A redelivered message maps onto the same
        // job rather than scraping the board twice.
        jobId: boardJobId(data.runId, board),
        attempts: 2,                                  // EC-P2-29: two, not five
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
  }
}

/** Scrape ONE board and persist its jobs. Never throws for a board problem. */
export async function handleHarvestBoard(deps: Deps, data: HarvestBoardJob): Promise<void> {
  const { runId, userId, board } = data;

  // EC-P2-38/39/40 — a board that is failing gets left alone, not hammered.
  const state = await deps.breaker.state(board);
  if (state === "open") {
    await setBoardResult(deps, runId, board, {
      status: "failed", count: 0, reason: "circuit_open", responseBytes: null,
    });
    return;
  }
  if (state === "half_open" && !(await deps.breaker.tryProbe(board))) {
    await setBoardResult(deps, runId, board, {
      status: "failed", count: 0, reason: "circuit_probing", responseBytes: null,
    });
    return;
  }

  // EC-P2-34/35 — global across users AND replicas.
  if (!(await deps.limiter.acquire(board))) {
    await setBoardResult(deps, runId, board, {
      status: "failed", count: 0, reason: "rate_limit_timeout", responseBytes: null,
    });
    return;
  }

  let response: Awaited<ReturnType<Deps["callBoard"]>>;
  try {
    response = await deps.callBoard(board, {
      role: data.role, location: data.location, limit: data.limit,
    });
  } catch (err) {
    // Transport failure: ④ unreachable, timeout, or a non-JSON body
    // (EC-P2-32/33). Still data, not an exception.
    await deps.breaker.recordFailure(board);
    await setBoardResult(deps, runId, board, {
      status: "failed", count: 0,
      reason: err instanceof Error ? err.message.slice(0, 200) : "worker_unreachable",
      responseBytes: null,
    });
    return;
  }

  if (response.error) {
    await deps.breaker.recordFailure(board);
    await setBoardResult(deps, runId, board, {
      status: "failed", count: 0,
      reason: response.error.slice(0, 200),
      responseBytes: response.response_bytes,
    });
    return;
  }

  await deps.breaker.recordSuccess(board);

  // Persist. EC-P2-29: the upsert is what makes a retry idempotent — the
  // deterministic job id prevents duplicate *work*, this prevents duplicate
  // *rows*.
  let written = 0;
  for (const j of response.jobs) {
    const key = dedupeKey(j);
    try {
      await deps.prisma.job.upsert({
        where: { userId_dedupeKey: { userId, dedupeKey: key } },
        // EC-P2-19: an existing job seen again updates lastSeenRunId. The
        // original harvestRunId is preserved, so "which run first found this?"
        // stays answerable.
        update: { lastSeenRunId: runId },
        create: {
          userId,
          harvestRunId: runId,
          lastSeenRunId: runId,
          source: j.source,
          title: j.title,
          company: j.company,
          location: j.location,
          link: j.link,
          postedAt: j.posted_at,                    // verbatim, always
          postedAtParsed: parsePostedAt(j.posted_at), // EC-P2-51: nullable
          dedupeKey: key,
          hydrationStatus: "pending",
        },
      });
      written += 1;
    } catch {
      // One row failing must not lose the other nineteen (EC-P2-04).
    }
  }

  // EC-P2-01 vs EC-P2-06 — `ok` with count 0 is a legitimately empty search.
  // A broken selector is `failed`, above. Conflating them makes every empty
  // search look like an outage.
  await setBoardResult(deps, runId, board, {
    status: response.partial ? "partial" : "ok",
    count: written,
    reason: null,
    responseBytes: response.response_bytes,
  });
}

/**
 * Roll the per-board results into a run status.
 *
 * EC-P2-27 — all boards failing is `failed`, NOT `partial`. `partial` implies
 * something succeeded.
 */
export async function finaliseRun(deps: Deps, runId: string): Promise<void> {
  const run = await deps.prisma.harvestRun.findUnique({
    where: { id: runId }, select: { boardResults: true, boards: true },
  });
  if (!run) return;

  const results = Object.values((run.boardResults as Record<string, { status: BoardStatus }>) ?? {});
  const done = results.length >= run.boards.length;
  if (!done) return;

  const anyOk = results.some((r) => r.status === "ok" || r.status === "partial");
  const allOk = results.every((r) => r.status === "ok");

  await deps.prisma.harvestRun.update({
    where: { id: runId },
    data: {
      status: allOk ? "complete" : anyOk ? "partial" : "failed",
      finishedAt: new Date(),
    },
  });
}
