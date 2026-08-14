/**
 * Queue producer (P2.2.1) — ① enqueues, it never performs the work.
 *
 * FR1: harvesting is slow (Playwright, Firecrawl) and must not block a request.
 * Doing it inline would also time out on serverless (§10.4).
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EC-P7-09 / EC-P7-15 — WHY THE PRODUCER CONNECTION IS CONFIGURED SEPARATELY.
 *
 * §18 says a Redis outage makes "harvest/hydrate unavailable" while tailoring,
 * review, and delivery keep working. Fault injection (P7.2.5) showed the second
 * half held and the first half did not: with a Redis that refuses connections,
 * `queue.add()` did not reject. It hung, indefinitely, and the HTTP request hung
 * with it until the platform killed the invocation.
 *
 * The cause is a setting BullMQ requires: `maxRetriesPerRequest: null`. Workers
 * genuinely need it — a blocking `BRPOPLPUSH` must not be cancelled by a retry
 * budget — and it was copied here because one connection served both roles.
 * Combined with ioredis's default offline queue, it means a command issued
 * while disconnected waits in memory forever rather than failing.
 *
 * That distinction matters more than it sounds. "Unavailable" is a state a user
 * can be told about and route around; a hang is an outage that also consumes a
 * serverless invocation per attempt, and on a platform that bills by duration a
 * Redis outage silently becomes a bill. It also fails the §18 claim in the
 * worst way: not by degrading badly, but by never resolving at all.
 *
 * So the PRODUCER — which only ever issues short, non-blocking commands — gets
 * a finite retry budget and NO offline queue, and therefore fails fast and
 * loudly. The worker's connection in services/orchestrator keeps the null.
 * ═════════════════════════════════════════════════════════════════════════
 */

import { Queue } from "bullmq";
import Redis from "ioredis";

import { log } from "@/lib/obs/logger";
import { QUEUE_NAME, boardJobId, runJobId, hydrateJobId, scoreBatchJobId, type HarvestBoardJob, type HarvestRunJob, type HydrateJobPayload, type ScoreBatchPayload } from "./types";

/**
 * Thrown when background work cannot be accepted.
 *
 * A distinct type, not a generic Error, because the route handler's job is to
 * turn this into "harvest is unavailable; tailoring still works" — a specific,
 * true statement (EC-P7-10) — rather than a 500 that says nothing.
 */
export class QueueUnavailableError extends Error {
  readonly code = "QUEUE_UNAVAILABLE";
  constructor(message = "Background work is unavailable right now.") {
    super(message);
    this.name = "QueueUnavailableError";
  }
}

/** How long an enqueue may take before we call it unavailable. */
const ENQUEUE_TIMEOUT_MS = 3_000;

const g = globalThis as unknown as { __jobpilotQueue?: Queue; __jobpilotRedis?: Redis };

function connection(): Redis {
  g.__jobpilotRedis ??= new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    // ── The EC-P7-09 settings. See the header. ──
    // A producer command is short and non-blocking, so a bounded retry budget
    // is correct here even though the worker requires `null`.
    maxRetriesPerRequest: 2,
    // Without this, commands issued while disconnected queue in memory and
    // resolve whenever Redis returns — which is indistinguishable from a hang
    // to the person waiting on the response.
    enableOfflineQueue: false,
    connectTimeout: 2_000,
    // Keep reconnecting in the background so recovery needs no deploy, but cap
    // the backoff so a long outage does not leave us minutes behind the fix.
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  });

  // ioredis emits `error` on every failed reconnect. Unhandled, that is an
  // uncaught exception that takes the process down — turning a partial outage
  // into a total one, which is the exact §18 failure this file is defending.
  g.__jobpilotRedis.on("error", (err: Error) => {
    log.warn("redis.connection_error", { name: err.name, message: err.message });
  });

  return g.__jobpilotRedis;
}

/**
 * The shared producer connection.
 *
 * Exported for the LLM quota (lib/llm/quota.ts), which counts in Redis because
 * that is the only store ① and ③ share. Reusing this connection rather than
 * opening a second one keeps the fail-fast settings above — a quota check must
 * not be the thing that hangs a request.
 */
export function queueConnection(): Redis {
  return connection();
}

export function harvestQueue(): Queue {
  g.__jobpilotQueue ??= new Queue(QUEUE_NAME, { connection: connection() });
  return g.__jobpilotQueue;
}

/**
 * Wrap an enqueue so it always settles.
 *
 * Belt and braces over `enableOfflineQueue: false`: that setting makes ioredis
 * reject promptly, and this bounds the case where the socket connects but the
 * server never answers — a half-open connection through a load balancer, which
 * no client-side retry setting covers.
 */
async function enqueue(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new QueueUnavailableError()), ENQUEUE_TIMEOUT_MS),
      ),
    ]);
  } catch (err) {
    if (err instanceof QueueUnavailableError) {
      log.warn("queue.unavailable", { jobName: label, outcome: "degraded" });
      throw err;
    }
    log.warn("queue.enqueue_failed", {
      jobName: label,
      outcome: "degraded",
      name: err instanceof Error ? err.name : "Unknown",
      message: err instanceof Error ? err.message : String(err),
    });
    throw new QueueUnavailableError();
  }
}

export async function enqueueHarvest(data: HarvestRunJob): Promise<void> {
  await enqueue("harvest:run", () =>
    harvestQueue().add("harvest:run", data, {
      jobId: runJobId(data.runId),   // P2.2.5: deterministic
      attempts: 1,                   // children retry individually, not the parent
      removeOnComplete: 50,
      removeOnFail: 50,
    }),
  );
}

/**
 * P7.2.1 / EC-P7-13 — retry ONLY the boards that failed.
 *
 * `board_results` already records which board failed and why, so re-running the
 * whole search is both slower for the user and unkind to the boards that
 * already answered — it re-scrapes sites that did nothing wrong, which is what
 * §11.4's conduct controls exist to avoid.
 *
 * Enqueues board children directly rather than a fresh `harvest:run`, so jobs
 * already harvested stay attached to the original run and results accumulate
 * instead of forking into a second run the user has to reconcile.
 */
export async function enqueueHarvestBoards(
  jobs: HarvestBoardJob[],
  attempt: number,
): Promise<void> {
  const q = harvestQueue();
  await enqueue("harvest:board", () =>
    Promise.all(jobs.map((j) =>
      q.add("harvest:board", j, {
        jobId: boardJobId(j.runId, j.board, attempt),
        attempts: 2,                                  // EC-P2-29: two, not five
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      }),
    )),
  );
}

/**
 * P3.2.1 / FR2 — hydrate only the jobs the user selected, never a whole run.
 * Hydrating everything scraped is wasteful and unkind to the source sites.
 */
export async function enqueueHydrate(jobs: HydrateJobPayload[]): Promise<void> {
  const q = harvestQueue();
  await enqueue("hydrate:job", () =>
    Promise.all(jobs.map((j) =>
      q.add("hydrate:job", j, {
        jobId: hydrateJobId(j.jobId),   // deterministic: a retry is idempotent
        attempts: 2,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 200,
        removeOnFail: 200,
      }),
    )),
  );
}

/** P4.3.1 — batch scoring is queued: 20 jobs is minutes of LLM work. */
export async function enqueueScoreBatch(data: ScoreBatchPayload): Promise<void> {
  await enqueue("score:batch", () =>
    harvestQueue().add("score:batch", data, {
      jobId: scoreBatchJobId(data.userId, data.harvestRunId),
      attempts: 1,   // EC-P4-14: partial progress persists; a blind retry rescores
      removeOnComplete: 20,
      removeOnFail: 20,
    }),
  );
}

/**
 * Liveness probe for the health cache (P7.2.4).
 *
 * Deliberately its own short-timeout PING rather than a trial enqueue: a health
 * check must not have side effects, and it must not be able to become the load
 * it is measuring (EC-P7-11).
 */
export async function pingQueue(timeoutMs = 1_000): Promise<boolean> {
  try {
    await Promise.race([
      connection().ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);
    return true;
  } catch {
    return false;
  }
}
