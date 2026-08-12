/**
 * Orchestrator ③ — the single writer (P2.2.2, ADR-003).
 *
 * Run with: npx tsx --env-file=.env services/orchestrator/index.ts
 * (Node 20 loads .env natively; no dotenv dependency needed.)
 *
 * A persistent Node process, NOT serverless: a harvest:board job holds an HTTP
 * connection to ④ for up to 90s, which is fine here and fatal on most
 * serverless runtimes (§10.4). It shares the codebase and Prisma client with ①
 * and differs only by entrypoint.
 */

import { PrismaClient } from "@prisma/client";
import { Queue, Worker } from "bullmq";
import Redis from "ioredis";

import { QUEUE_NAME } from "../../apps/web/lib/queue/types";
import { BoardCircuitBreaker, BoardRateLimiter } from "./lib/board-circuit";
import { handleHarvestBoard, handleHarvestRun, finaliseRun, type Deps } from "./handlers/harvest";

const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,   // required by BullMQ
});

const prisma = new PrismaClient();
const queue = new Queue(QUEUE_NAME, { connection });

const deps: Deps = {
  prisma,
  redis: connection,
  queue,
  limiter: new BoardRateLimiter(connection, {
    perMinute: Number(process.env.SCRAPE_RATE_LIMIT_PER_MIN ?? 10),
  }),
  breaker: new BoardCircuitBreaker(connection),
  callBoard: async (board, body) => {
    const base = process.env.WORKER_SERVICE_URL ?? "http://localhost:8000";
    const controller = new AbortController();
    // 90s per board (§10.1). The board is slow, not broken, well before this.
    const timer = setTimeout(() => controller.abort(), 90_000);
    try {
      const res = await fetch(`${base}/boards/${board}/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-service-token": process.env.WORKER_SERVICE_TOKEN ?? "",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      // EC-P2-33: ④ may return a non-JSON error body. Do not let a parse
      // error masquerade as the real status.
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`worker returned ${res.status}: ${text.slice(0, 120)}`);
      }
    } finally {
      clearTimeout(timer);
    }
  },
};

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    if (job.name === "harvest:run") return handleHarvestRun(deps, job.data);
    if (job.name === "harvest:board") {
      await handleHarvestBoard(deps, job.data);
      return finaliseRun(deps, job.data.runId);
    }
  },
  {
    connection,
    // EC-P2-35: per-board concurrency is enforced by the Redis limiter, not by
    // this number. This only bounds total in-flight work in one replica.
    concurrency: Number(process.env.ORCHESTRATOR_CONCURRENCY ?? 4),
  },
);

worker.on("failed", (job, err) => {
  console.error(JSON.stringify({
    event: "job.failed", name: job?.name, id: job?.id, error: err.message,
  }));
});

worker.on("completed", (job) => {
  console.log(JSON.stringify({ event: "job.completed", name: job.name, id: job.id }));
});

console.log(JSON.stringify({ event: "orchestrator.ready", queue: QUEUE_NAME }));

/**
 * EC-P2-30 — a run whose job vanished (Redis restart, crash) would otherwise
 * sit in `running` forever and spin the UI. Anything running past the window is
 * marked failed with a reason.
 */
const REAP_AFTER_MIN = 10;
setInterval(async () => {
  const cutoff = new Date(Date.now() - REAP_AFTER_MIN * 60_000);
  const stale = await prisma.harvestRun.updateMany({
    where: { status: "running", startedAt: { lt: cutoff } },
    data: { status: "failed", finishedAt: new Date() },
  });
  if (stale.count > 0) {
    console.log(JSON.stringify({ event: "stale.reaped", count: stale.count }));
  }
}, 60_000);

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, async () => {
    await worker.close();
    await prisma.$disconnect();
    await connection.quit();
    process.exit(0);
  });
}
