/**
 * Dependency health, cached (P7.2.4, architecture.md §18).
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EC-P7-11 — A HEALTH CHECK THAT COSTS MORE THAN THE FEATURE.
 *
 * The banner wants to know whether ④ and Redis are reachable. Done naively —
 * probe on every render, from every ① instance — a page with four components
 * asking produces four probes, autoscaling multiplies that by instance count,
 * and the monitoring becomes a self-inflicted load test against the very
 * service it is worried about. Worse, it does this hardest exactly when the
 * dependency is already struggling.
 *
 * So: one probe per dependency per TTL per instance, and concurrent callers
 * share the in-flight probe rather than starting their own (the single-flight
 * below). Under any burst of traffic the cost is bounded by wall-clock time,
 * not by request count.
 *
 * ASYMMETRIC TTLs. A healthy result is cached for 30s; an unhealthy one for
 * 5s. Recovery should be noticed quickly — a user staring at "harvest is
 * unavailable" after the outage ended will retry and get the same stale banner
 * — while a steady-state healthy system should be probed rarely. Being slow to
 * notice recovery is the more annoying failure, so it gets the shorter TTL.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * WHAT IS NOT CHECKED HERE. Postgres. §18 accepts it as a single point of
 * failure, and a health endpoint that queries the database to report the
 * database is down cannot answer when it matters — the request handling the
 * probe fails first. EC-P7-16 is handled where it belongs: a clean 503 from the
 * error path (lib/api-errors.ts), not a green/red dot.
 */

import { pingQueue } from "@/lib/queue/producer";
import { log } from "@/lib/obs/logger";
import { dependencyState } from "@/lib/obs/metrics";

export type DependencyName = "redis" | "worker";

export interface DependencyHealth {
  name: DependencyName;
  up: boolean;
  checkedAt: number;
}

export interface SystemHealth {
  redis: DependencyHealth;
  worker: DependencyHealth;
  /** True when everything is reachable — the banner's only question. */
  allUp: boolean;
}

const TTL_UP_MS = 30_000;
const TTL_DOWN_MS = 5_000;

interface CacheEntry {
  result: DependencyHealth;
  expiresAt: number;
  /** Shared by concurrent callers so N requests cause one probe. */
  inFlight?: Promise<DependencyHealth>;
}

const g = globalThis as unknown as {
  __jobpilotHealth?: Map<DependencyName, CacheEntry>;
};
const cache = (g.__jobpilotHealth ??= new Map<DependencyName, CacheEntry>());

async function probe(
  name: DependencyName,
  fn: () => Promise<boolean>,
): Promise<DependencyHealth> {
  const entry = cache.get(name);
  const now = Date.now();

  if (entry && now < entry.expiresAt) return entry.result;
  // Single-flight: a burst of concurrent renders shares one probe.
  if (entry?.inFlight) return entry.inFlight;

  const inFlight = (async () => {
    // A probe must never throw. This function is called from a banner on a page
    // that is otherwise working; an exception here would take down a page in
    // order to report that something else is down.
    let up: boolean;
    try {
      up = await fn();
    } catch {
      up = false;
    }

    const result: DependencyHealth = { name, up, checkedAt: Date.now() };
    cache.set(name, {
      result,
      expiresAt: Date.now() + (up ? TTL_UP_MS : TTL_DOWN_MS),
    });

    // Only log and count TRANSITIONS. Emitting on every probe would produce a
    // line every 30s per instance forever, which is how a signal becomes noise
    // and then gets filtered out (the EC-P7-21 lesson, applied here).
    if (entry?.result.up !== up) {
      log.warn("dependency.state_change", {
        name,
        status: up ? "up" : "down",
        outcome: up ? "ok" : "degraded",
      });
      dependencyState(name, up ? "up" : "down");
    }
    return result;
  })();

  cache.set(name, {
    result: entry?.result ?? { name, up: true, checkedAt: 0 },
    expiresAt: entry?.expiresAt ?? 0,
    inFlight,
  });

  return inFlight;
}

/** Is ④ answering? Uses its unauthenticated /health, with a tight timeout. */
async function probeWorker(): Promise<boolean> {
  const base = process.env.WORKER_SERVICE_URL ?? "http://localhost:8000";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_500);
  try {
    const res = await fetch(`${base}/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function systemHealth(): Promise<SystemHealth> {
  const [redis, worker] = await Promise.all([
    probe("redis", () => pingQueue()),
    probe("worker", probeWorker),
  ]);
  return { redis, worker, allUp: redis.up && worker.up };
}

/**
 * What is unavailable, in words a user can act on (EC-P7-10).
 *
 * §18 gives per-dependency blast radii, and the banner's whole job is to say
 * which one applies. "Something is wrong" tells a user nothing; "harvesting is
 * paused, tailoring and email still work" tells them what to do next, and is
 * the difference between a degraded system and a broken-looking one.
 */
export function degradationNotice(health: SystemHealth): string | null {
  const { redis, worker } = health;
  if (redis.up && worker.up) return null;

  // Both down: the whole async half of the platform is out, but the synchronous
  // half genuinely still works, and saying so is the point of the four-container
  // split (§18, "the blast radii are small because the seams are real").
  if (!redis.up && !worker.up) {
    return "Job searching and sending are paused — the background service is unreachable. Tailoring, review, and PDF export still work.";
  }
  if (!redis.up) {
    return "Job searching is paused — the queue is unreachable. Tailoring, review, and sending still work.";
  }
  return "Job searching and sending are paused — the worker service is unreachable. Tailoring and PDF export still work.";
}

/** Test seam. */
export function __resetHealthCache(): void {
  cache.clear();
}
