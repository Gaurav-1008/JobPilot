/**
 * Minimal in-memory fixed-window rate limiter, keyed by client IP + bucket.
 *
 * MVP-grade: per-process only (resets on restart, not shared across serverless
 * instances). Good enough to protect the expensive LLM/PDF routes during a demo;
 * swap for a shared store (Redis/Upstash) if deployed at scale.
 */
const globalBuckets = globalThis as unknown as {
  __rsRateBuckets?: Map<string, { count: number; resetAt: number }>;
};
const buckets =
  globalBuckets.__rsRateBuckets ??
  new Map<string, { count: number; resetAt: number }>();
if (!globalBuckets.__rsRateBuckets) globalBuckets.__rsRateBuckets = buckets;

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec: number;
}

/** Return the client IP from standard proxy headers, falling back to "local". */
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "local";
}

/**
 * Allow up to `limit` requests per `windowMs` for a given key.
 * @param bucket logical route name so different routes have separate budgets.
 */
export function rateLimit(
  key: string,
  bucket: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const id = `${bucket}:${key}`;
  const entry = buckets.get(id);

  if (!entry || now >= entry.resetAt) {
    buckets.set(id, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }

  if (entry.count >= limit) {
    return { ok: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }

  entry.count += 1;
  return { ok: true, retryAfterSec: 0 };
}

/**
 * The per-user LLM quota (P7.2.3) is NOT here, deliberately.
 *
 * The plan says "per-user LLM quota via the existing rate-limit.ts", and this
 * file cannot do that job. The counters above live in one process's memory —
 * fine for their purpose, which is blunting a burst against an expensive route
 * — but the LLM spend that needs bounding happens in ③, the orchestrator,
 * during batch scoring. An in-memory counter in ① cannot see it, and ① is
 * autoscaled besides, so N instances would each grant a full budget.
 *
 * The quota therefore lives in lib/llm/quota.ts and counts in Redis, which is
 * the only store both services share. See that file for why it fails OPEN.
 */
