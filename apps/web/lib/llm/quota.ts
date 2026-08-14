/**
 * Per-user daily LLM quota (P7.2.3, EC-P7-14).
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THIS IS NOT IN lib/rate-limit.ts, WHICH IS WHERE THE PLAN POINTS.
 *
 * That limiter holds counters in one process's memory. It is the right tool for
 * its job — blunting a burst against an expensive route — and the wrong one
 * here for two reasons: the spend being bounded happens in ③ during batch
 * scoring, which ①'s memory cannot observe; and ① is autoscaled, so N instances
 * would each hand out a full budget.
 *
 * Redis is the only store both services share, so the counter lives there. One
 * key per user per UTC day, INCR to spend, TTL to expire.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * IT FAILS OPEN, AND THAT IS THE CORRECT DIRECTION.
 *
 * Everywhere else in this codebase, a check that cannot complete BLOCKS —
 * interlock check 12 refuses to send, the config validator refuses to boot,
 * encryption refuses to store. Those all guard against irreversible harm to
 * someone else.
 *
 * A quota is a cost control. Failing it closed means a Redis outage stops
 * tailoring, which contradicts §18's "Redis down → tailoring, review, and
 * delivery all still work" and breaks the guarantee EC-P7-09 exists to protect.
 * The worst case of failing open is a larger bill for the length of an outage.
 * The worst case of failing closed is the product not working. This is the one
 * place where "degrade, never dead-end" (P5) outranks "fail closed", and the
 * distinguishing question is who gets hurt: here, nobody but the operator, and
 * only in money.
 * ─────────────────────────────────────────────────────────────────────────
 */

import type Redis from "ioredis";

import { log } from "@/lib/obs/logger";

export interface QuotaState {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets. 0 when there is budget left. */
  retryAfterSec: number;
}

export function llmQuotaLimit(): number {
  const raw = Number(process.env.LLM_CALLS_PER_USER_PER_DAY ?? 200);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 200;
}

/**
 * One key per user per UTC day.
 *
 * A UTC day rather than a rolling window: a rolling window needs a sorted set
 * and a trim on every call, which is real work for a cost control, and the
 * failure it prevents — 2N calls straddling the boundary — costs money rather
 * than causing harm. Compare the volume cap in the interlock chain, which IS a
 * rolling window (EC-P5-52) because 2N emails across midnight reaches 2N real
 * people.
 *
 * UTC rather than local time so the reset is the same instant for every user
 * and does not move twice a year.
 */
function quotaKey(userId: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return `llm:quota:${day}:${userId}`;
}

const DAY_SECONDS = 24 * 60 * 60;

/**
 * Spend `cost` units and report what is left.
 *
 * `cost` exists because one Tier-1 batch is one request covering up to five
 * jobs (§22.1 #4). Charging per job would make the quota mean something
 * different depending on how batching is tuned; charging per request means it
 * tracks what is actually billed.
 */
export async function consumeLlmQuota(
  redis: Redis,
  userId: string,
  cost = 1,
): Promise<QuotaState> {
  const limit = llmQuotaLimit();
  const key = quotaKey(userId);

  try {
    // INCR then EXPIRE, in one round trip. INCR creates the key at 0 first, so
    // the sequence is safe on a missing key, and EXPIRE is re-issued each time
    // rather than only on creation — a key whose TTL failed to set once would
    // otherwise live forever and permanently exhaust that user.
    const [used] = await redis
      .multi()
      .incrby(key, cost)
      .expire(key, DAY_SECONDS)
      .exec()
      .then((res) => (res ?? []).map((r) => Number(r?.[1] ?? 0)));

    const remaining = Math.max(0, limit - used);
    return {
      ok: used <= limit,
      limit,
      remaining,
      retryAfterSec: used <= limit ? 0 : await ttl(redis, key),
    };
  } catch (err) {
    // Fails open — see the header.
    log.warn("llm_quota.unavailable", {
      outcome: "degraded",
      name: err instanceof Error ? err.name : "Unknown",
      message: err instanceof Error ? err.message : String(err),
    });
    return { ok: true, limit, remaining: limit, retryAfterSec: 0 };
  }
}

/** Read the budget without spending any of it — for the door check in ①. */
export async function peekLlmQuota(
  redis: Redis,
  userId: string,
): Promise<QuotaState> {
  const limit = llmQuotaLimit();
  const key = quotaKey(userId);

  try {
    const used = Number((await redis.get(key)) ?? 0);
    return {
      ok: used < limit,
      limit,
      remaining: Math.max(0, limit - used),
      retryAfterSec: used < limit ? 0 : await ttl(redis, key),
    };
  } catch {
    return { ok: true, limit, remaining: limit, retryAfterSec: 0 };
  }
}

async function ttl(redis: Redis, key: string): Promise<number> {
  const seconds = await redis.ttl(key).catch(() => -1);
  // -1 (no expiry) and -2 (no key) are both "we do not know"; report a full day
  // rather than 0, since 0 would tell the user to retry immediately.
  return seconds > 0 ? seconds : DAY_SECONDS;
}
