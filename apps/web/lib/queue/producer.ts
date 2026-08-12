/**
 * Queue producer (P2.2.1) — ① enqueues, it never performs the work.
 *
 * FR1: harvesting is slow (Playwright, Firecrawl) and must not block a request.
 * Doing it inline would also time out on serverless (§10.4).
 */

import { Queue } from "bullmq";
import Redis from "ioredis";

import { QUEUE_NAME, runJobId, type HarvestRunJob } from "./types";

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
