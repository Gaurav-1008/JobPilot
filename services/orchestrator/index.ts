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
import { handleHydrateJob, type HydrateDeps } from "./handlers/hydrate";
import { handleScoreBatch, type ScoreBatchDeps } from "./handlers/score-batch";
import { SCORING_SYSTEM_PROMPT } from "../../apps/web/prompts/scoring-cheap";
import { createLlmClient } from "../../apps/web/lib/llm/client";
import { parseJobDescription } from "../../apps/web/services/jd-parser";
import { promptVersion } from "../../apps/web/prompts/versions";

const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,   // required by BullMQ
});

// DIRECT_URL, not the pooled DATABASE_URL. Supavisor's transaction mode is
// built for many short-lived serverless connections and drops idle ones; this
// is a PERSISTENT worker, which is the opposite shape. Using the pooled URL is
// what produced the P1017 "Server has closed the connection" crash below.
//
// ═════════════════════════════════════════════════════════════════════════
// THE POOL IS SIZED EXPLICITLY, AND THIS IS WHY.
//
// Prisma's default pool is `num_cpus * 2 + 1` — 17 on an 8-core laptop. That
// default is written for an app server talking to its own database, and both
// halves of the assumption are wrong here:
//
//   · Session mode (:5432) means a pool slot maps to a Supavisor session
//     holding a real backend for its lifetime. Nothing multiplexes them. The
//     web app's :6543 transaction-mode pool does not behave this way, which
//     is why it is not the half that pressures the instance.
//   · This process runs BullMQ at concurrency 4. It can never use 17.
//
// Prisma opens connections lazily, so an IDLE worker holds one or two, not
// seventeen. The exposure is under load, and against a Supabase instance
// reporting max_connections = 60 — shared with PostgREST, pg_cron, pg_net and
// the rest — a worker able to claim 17 on demand is a large share of the
// instance for work that is bounded at 4.
//
// HONEST SCOPE: this is hygiene, not a fix for the "Can't reach database
// server" errors that prompted it. Those were the POOLER being briefly
// unavailable — Postgres itself stayed up throughout, and both URLs answered
// normally minutes later. What an oversized pool did do was make that outage
// louder than it needed to be: 17 slots filled with retrying connection
// attempts, and the follow-on "Timed out fetching a new connection from the
// connection pool" is that exhaustion, downstream of the real cause.
//
// Sized at concurrency + 2: one slot per in-flight job, plus headroom for the
// reaper and `finaliseRun`. Raising ORCHESTRATOR_CONCURRENCY raises this with
// it, so the two cannot drift apart.
// ═════════════════════════════════════════════════════════════════════════
const CONCURRENCY = Number(process.env.ORCHESTRATOR_CONCURRENCY ?? 4);

/** Add pool sizing to a Postgres URL without clobbering existing params. */
function withPoolLimits(raw: string, limit: number): string {
  const url = new URL(raw);
  // Only set what the operator has not already chosen deliberately.
  if (!url.searchParams.has("connection_limit")) {
    url.searchParams.set("connection_limit", String(limit));
  }
  if (!url.searchParams.has("pool_timeout")) {
    // Longer than the 10s default: a board handler can hold its slot through a
    // slow scrape, and failing the queue job for that is worse than waiting.
    url.searchParams.set("pool_timeout", "20");
  }
  return url.toString();
}

const dbUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!dbUrl) {
  // Fail at boot rather than on the first job (P7.4.4 / EC-P7-28).
  console.error(JSON.stringify({
    event: "config.invalid",
    error: "Neither DIRECT_URL nor DATABASE_URL is set; the orchestrator cannot start.",
  }));
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: { db: { url: withPoolLimits(dbUrl, CONCURRENCY + 2) } },
});
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

const hydrateDeps: HydrateDeps = {
  prisma,
  redis: connection,
  fetchJd: async (url) => {
    const base = process.env.WORKER_SERVICE_URL ?? "http://localhost:8000";
    const controller = new AbortController();
    // Firecrawl + a Playwright fallback can legitimately take a while; the
    // per-page timeouts inside ④ are the real bound.
    const timer = setTimeout(() => controller.abort(), 180_000);
    try {
      const res = await fetch(`${base}/hydrate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-service-token": process.env.WORKER_SERVICE_TOKEN ?? "",
        },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });
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
  // P3.2.3 — the EXISTING extraction prompt, called unchanged.
  extractProfile: (rawText) => parseJobDescription(rawText),
};

const SCORING_MODEL = process.env.SCORING_MODEL ?? "llama-3.1-8b-instant";

const scoreDeps: ScoreBatchDeps = {
  prisma,
  redis: connection,
  systemPrompt: SCORING_SYSTEM_PROMPT,
  model: SCORING_MODEL,
  promptVersion: promptVersion(),
  scoreWithLlm: async (system, user) => {
    const client = createLlmClient();
    const res = await client.chat.completions.create({
      model: SCORING_MODEL,
      temperature: 0,                                  // ranking, not writing
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const raw = res.choices[0]?.message?.content ?? "{}";
    // Strip a markdown fence if the model adds one despite json_object.
    const cleaned = raw.replace(/^```(?:json)?\n?|```$/g, "").trim();
    const parsed = JSON.parse(cleaned) as { results?: unknown };
    return {
      results: Array.isArray(parsed.results) ? (parsed.results as never) : [],
      tokens: {
        prompt: res.usage?.prompt_tokens ?? 0,
        completion: res.usage?.completion_tokens ?? 0,
      },
    };
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
    if (job.name === "hydrate:job") return handleHydrateJob(hydrateDeps, job.data);
    if (job.name === "score:batch") return handleScoreBatch(scoreDeps, job.data);
  },
  {
    connection,
    // EC-P2-35: per-board concurrency is enforced by the Redis limiter, not by
    // this number. This only bounds total in-flight work in one replica.
    // Same constant the Prisma pool is sized from, so the two cannot drift.
    concurrency: CONCURRENCY,
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
 * EC-P2-30 — a run whose job vanished would otherwise sit in `running` forever
 * and spin the UI. Anything past the window is marked failed.
 *
 * The try/catch is NOT decoration. The first version of this had none, and an
 * `async` callback inside setInterval turns any rejection into an UNHANDLED
 * rejection, which Node exits on by default. Supabase closed an idle pooled
 * connection, Prisma threw P1017, and the reaper killed the entire orchestrator
 * — the safety mechanism became the failure mode. Runs then sat `queued`
 * forever, because the process that would have reaped them was the one that
 * died.
 *
 * Known limitation, worth stating plainly: this reaper lives INSIDE ③. If ③
 * is down, nothing reaps. A run stuck because the orchestrator died is exactly
 * the case it cannot cover. Moving it to a cron or a DB-side job would fix
 * that; until then, ③ needs a supervisor that restarts it.
 */
const REAP_AFTER_MIN = 10;
const REAP_INTERVAL_MS = 60_000;
/** Give up escalating the backoff here — 16 minutes between attempts. */
const REAP_MAX_BACKOFF = 16;

/**
 * Consecutive failures, driving both the backoff and the log volume.
 *
 * Two problems this fixes, both observed against a real Supabase instance:
 *
 * 1. NO BACKOFF. A reaper that retries every 60s through an outage adds load
 *    to a database that is already struggling, and when the cause is
 *    connection exhaustion — which it was — the retry is a participant in the
 *    problem rather than an observer of it.
 *
 * 2. IDENTICAL LINES FOREVER. Six copies of the same multi-line Prisma error
 *    is not six pieces of information. It is one, repeated until the operator
 *    stops reading the log — the same way an undifferentiated
 *    `interlock_block_total` gets muted (EC-P7-21). So the first failure logs
 *    in full, subsequent ones log a count, and recovery logs once.
 */
let reapFailures = 0;

function scheduleReap(delayMs: number): void {
  setTimeout(() => {
    void (async () => {
      try {
        const cutoff = new Date(Date.now() - REAP_AFTER_MIN * 60_000);
        const stale = await prisma.harvestRun.updateMany({
          where: { status: "running", startedAt: { lt: cutoff } },
          data: { status: "failed", finishedAt: new Date() },
        });

        if (reapFailures > 0) {
          console.log(JSON.stringify({
            event: "reaper.recovered",
            afterFailures: reapFailures,
          }));
          reapFailures = 0;
        }
        if (stale.count > 0) {
          console.log(JSON.stringify({ event: "stale.reaped", count: stale.count }));
        }
      } catch (err) {
        // A database blip must not take the worker down with it.
        reapFailures += 1;
        const message = err instanceof Error ? err.message : String(err);
        if (reapFailures === 1) {
          console.error(JSON.stringify({
            event: "reaper.failed",
            // First line only. Prisma renders a code frame across a dozen
            // lines, and repeating that per attempt is what made this
            // unreadable in the first place.
            error: message.split("\n").find((l) => l.trim()) ?? message,
          }));
        } else {
          console.error(JSON.stringify({
            event: "reaper.failing",
            consecutive: reapFailures,
          }));
        }
      } finally {
        // Exponential backoff, capped. Rescheduled from `finally` so a throw
        // anywhere above cannot stop the reaper permanently — which would be
        // worse than the noise, since nothing else marks a run stale.
        const factor = Math.min(2 ** Math.min(reapFailures, 4), REAP_MAX_BACKOFF);
        scheduleReap(REAP_INTERVAL_MS * (reapFailures === 0 ? 1 : factor));
      }
    })();
  }, delayMs).unref?.();
}

scheduleReap(REAP_INTERVAL_MS);

/**
 * Last line of defence. A single failed async operation anywhere must not kill
 * a worker that other jobs depend on. BullMQ already isolates job failures;
 * these cover everything outside a job handler.
 */
process.on("unhandledRejection", (reason) => {
  console.error(JSON.stringify({
    event: "unhandledRejection",
    error: reason instanceof Error ? reason.message : String(reason),
  }));
});

process.on("uncaughtException", (err) => {
  console.error(JSON.stringify({ event: "uncaughtException", error: err.message }));
});

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, async () => {
    await worker.close();
    await prisma.$disconnect();
    await connection.quit();
    process.exit(0);
  });
}
