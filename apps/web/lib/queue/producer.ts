/**
 * Queue producer (P2.2.1) — ① enqueues, it never performs the work.
 *
 * FR1: harvesting is slow (Playwright, Firecrawl) and must not block a request.
 * Doing it inline would also time out on serverless (§10.4).
 */

import { Queue } from "bullmq";
import Redis from "ioredis";

import { QUEUE_NAME, runJobId, hydrateJobId, scoreBatchJobId, type HarvestRunJob, type HydrateJobPayload, type ScoreBatchPayload } from "./types";

const g = globalThis as unknown as { __jobpilotQueue?: Queue; __jobpilotRedis?: Redis };

function connection(): Redis {
  g.__jobpilotRedis ??= new Redis(
    process.env.REDIS_URL ?? "redis://localhost:6379",
    { maxRetriesPerRequest: null },
  );
  return g.__jobpilotRedis;
}

export function harvestQueue(): Queue {
  g.__jobpilotQueue ??= new Queue(QUEUE_NAME, { connection: connection() });
  return g.__jobpilotQueue;
}

export async function enqueueHarvest(data: HarvestRunJob): Promise<void> {
  await harvestQueue().add("harvest:run", data, {
    jobId: runJobId(data.runId),   // P2.2.5: deterministic
    attempts: 1,                   // children retry individually, not the parent
    removeOnComplete: 50,
    removeOnFail: 50,
  });
}

/**
 * P3.2.1 / FR2 — hydrate only the jobs the user selected, never a whole run.
 * Hydrating everything scraped is wasteful and unkind to the source sites.
 */
export async function enqueueHydrate(jobs: HydrateJobPayload[]): Promise<void> {
  const q = harvestQueue();
  await Promise.all(jobs.map((j) =>
    q.add("hydrate:job", j, {
      jobId: hydrateJobId(j.jobId),   // deterministic: a retry is idempotent
      attempts: 2,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 200,
      removeOnFail: 200,
    }),
  ));
}

/** P4.3.1 — batch scoring is queued: 20 jobs is minutes of LLM work. */
export async function enqueueScoreBatch(data: ScoreBatchPayload): Promise<void> {
  await harvestQueue().add("score:batch", data, {
    jobId: scoreBatchJobId(data.userId, data.harvestRunId),
    attempts: 1,   // EC-P4-14: partial progress persists; a blind retry rescores
    removeOnComplete: 20,
    removeOnFail: 20,
  });
}
