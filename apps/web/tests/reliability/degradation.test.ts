/**
 * §18 degradation, fault-injected (P7.2.5, EC-P7-09, EC-P7-15).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE §18 ROW THIS FILE EXISTS FOR:
 *
 *   "Redis down | async work | harvest/hydrate unavailable; tailoring, review,
 *    and delivery all still work (sync paths)"
 *
 * That row is the main payoff of the four-container split, and per the phase-7
 * traps note it is "trivially broken by one module-level client that throws on
 * import". Until it is fault-injected it is a hypothesis.
 *
 * Injecting it found the row was HALF true. The synchronous paths did survive.
 * The claim that harvest is merely "unavailable" did not: with Redis refusing
 * connections, `queue.add()` never rejected — BullMQ requires
 * `maxRetriesPerRequest: null`, and combined with ioredis's default offline
 * queue that means a command issued while disconnected waits in memory
 * indefinitely. The request hung until the platform killed it.
 *
 * "Unavailable" and "hangs forever" are different products. One is a state a
 * user is told about and routes around; the other burns a serverless invocation
 * per attempt and never resolves. lib/queue/producer.ts now configures the
 * producer connection separately, and these tests pin that.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = join(__dirname, "..", "..");

/* ------------------------------------------------------------------ */
/* 1. The sync paths must not depend on the queue at all               */
/* ------------------------------------------------------------------ */

/**
 * Source with comments stripped.
 *
 * These files discuss Redis and the queue at length in their headers, so a
 * naive grep matches the prose explaining the rule and fails on files that
 * obey it — the same trap the follow-up sweep test documents.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("EC-P7-09 — a Redis outage cannot reach the synchronous paths", () => {
  // Tailoring, review, and delivery. If any of these grows an import of the
  // queue producer, a Redis outage stops being partial — which is precisely
  // the "one module-level client" failure the traps section names.
  const SYNC_PATHS = [
    ["interlock chain", join(ROOT, "lib", "outreach", "interlocks.ts")],
    ["delivery client", join(ROOT, "lib", "outreach", "worker-client.ts")],
    ["PDF renderer", join(ROOT, "lib", "pdf", "renderer.ts")],
    ["prompt runner", join(ROOT, "lib", "llm", "run-prompt.ts")],
    ["grounding checks", join(ROOT, "lib", "outreach", "grounding.ts")],
    ["personalization", join(ROOT, "lib", "outreach", "personalization.ts")],
  ] as const;

  for (const [label, path] of SYNC_PATHS) {
    it(`${label} imports neither the queue producer nor ioredis`, () => {
      const source = code(path);
      expect(source).not.toMatch(/from\s+["'].*queue\/producer["']/);
      expect(source).not.toMatch(/from\s+["']ioredis["']/);
      expect(source).not.toMatch(/from\s+["']bullmq["']/);
    });
  }

  it("the delivery route reaches delivery without touching the queue", () => {
    // The end-to-end version of the same claim: a user can still send while
    // Redis is down, because nothing on that route needs it.
    const source = code(join(ROOT, "app", "api", "outreach", "[id]", "deliver", "route.ts"));
    expect(source).not.toMatch(/queue\/producer|ioredis|bullmq/);
  });
});

/* ------------------------------------------------------------------ */
/* 2. The async paths must fail FAST, not hang                         */
/* ------------------------------------------------------------------ */

/** A queue whose `add` never settles — a disconnected ioredis offline queue. */
const hangingAdd = vi.hoisted(() => vi.fn(() => new Promise(() => {})));
/** A queue whose `add` rejects — what `enableOfflineQueue: false` produces. */
const rejectingAdd = vi.hoisted(() =>
  vi.fn(() => Promise.reject(new Error("Stream isn't writeable and enableOfflineQueue options is false"))),
);
const addImpl = vi.hoisted(() => ({ current: hangingAdd }));

vi.mock("bullmq", () => ({
  Queue: class {
    add(...args: unknown[]) {
      return addImpl.current(...(args as []));
    }
  },
}));

vi.mock("ioredis", () => ({
  default: class {
    on() { return this; }
    ping() { return Promise.reject(new Error("ECONNREFUSED")); }
  },
}));

describe("EC-P7-09 — enqueueing against a down Redis fails fast", () => {
  beforeEach(() => {
    vi.resetModules();
    (globalThis as Record<string, unknown>).__jobpilotQueue = undefined;
    (globalThis as Record<string, unknown>).__jobpilotRedis = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects with QueueUnavailableError rather than hanging", async () => {
    // The regression this whole file exists for. Before P7.2.4 this promise
    // never settled, and the assertion below would time out rather than fail —
    // which is itself the bug, reproduced.
    addImpl.current = hangingAdd;
    vi.useFakeTimers();

    const { enqueueHarvest, QueueUnavailableError } = await import("@/lib/queue/producer");

    const pending = enqueueHarvest({
      runId: "r1", userId: "u1", role: "engineer",
      location: null, boards: ["remoteok"], limit: 5,
    });
    const assertion = expect(pending).rejects.toBeInstanceOf(QueueUnavailableError);

    // Advance past the enqueue timeout. Real time would make this a 3s test.
    await vi.advanceTimersByTimeAsync(3_500);
    await assertion;
  });

  it("surfaces an immediate connection refusal as the same typed error", async () => {
    // With `enableOfflineQueue: false` ioredis rejects promptly. The route must
    // see one error type either way, so it can say one true thing to the user.
    addImpl.current = rejectingAdd;
    const { enqueueHydrate, QueueUnavailableError } = await import("@/lib/queue/producer");

    await expect(
      enqueueHydrate([{ jobId: "j1", userId: "u1" }]),
    ).rejects.toBeInstanceOf(QueueUnavailableError);
  });

  it("reports the queue as down without throwing, for the banner", async () => {
    // A health probe must never throw: it is called from a page that is
    // otherwise working, and an exception would take that page down in order
    // to report that something else is down.
    const { pingQueue } = await import("@/lib/queue/producer");
    await expect(pingQueue(50)).resolves.toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 3. The user is told which half is degraded                          */
/* ------------------------------------------------------------------ */

describe("EC-P7-10 — the notice names the degraded capability", () => {
  const up = (name: "redis" | "worker") => ({ name, up: true, checkedAt: 0 });
  const down = (name: "redis" | "worker") => ({ name, up: false, checkedAt: 0 });

  it("says nothing when everything is reachable", async () => {
    const { degradationNotice } = await import("@/lib/health/dependencies");
    expect(
      degradationNotice({ redis: up("redis"), worker: up("worker"), allUp: true }),
    ).toBeNull();
  });

  it("names harvest as paused and tailoring as working when Redis is down", async () => {
    const { degradationNotice } = await import("@/lib/health/dependencies");
    const notice = degradationNotice({
      redis: down("redis"), worker: up("worker"), allUp: false,
    });
    // Both halves of the §18 row have to appear: what stopped, and what did not.
    // "Something went wrong" is the failure this edge case is about.
    expect(notice).toMatch(/paused/i);
    expect(notice).toMatch(/tailoring/i);
  });

  it("names sending as affected when ④ is unreachable", async () => {
    const { degradationNotice } = await import("@/lib/health/dependencies");
    const notice = degradationNotice({
      redis: up("redis"), worker: down("worker"), allUp: false,
    });
    // §18: "④ unreachable | harvest, hydrate, send | tailoring and PDF export
    // unaffected (they live in ①)".
    expect(notice).toMatch(/sending|send/i);
    expect(notice).toMatch(/tailoring|PDF/i);
  });
});
