/**
 * Per-board rate limiting and circuit breaking (P2.2.7, P2.2.8, P2.4.3).
 *
 * Both live in REDIS, not in process memory, and that is the whole point.
 *
 * EC-P2-34/35/39 — an in-process counter is the easy accidental
 * implementation and it is wrong the moment ③ runs two replicas: three users
 * searching Naukri would produce 3x the request rate against Naukri, which is
 * exactly what P2.2.8 exists to prevent. Redis makes the limit global.
 *
 * EC-P2-34 specifically: the token bucket is a Lua SCRIPT so check-and-consume
 * is atomic. A read-then-write bucket lets two replicas both see a token and
 * both take it.
 */

import type Redis from "ioredis";

/* ------------------------------------------------------------------ */
/* Token bucket — atomic via Lua                                       */
/* ------------------------------------------------------------------ */

const BUCKET_LUA = `
local key      = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill   = tonumber(ARGV[2])   -- tokens per second
local now      = tonumber(ARGV[3])

local state  = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts     = tonumber(state[2])

if tokens == nil then
  tokens = capacity
  ts = now
end

-- Refill for elapsed time, capped at capacity.
local elapsed = math.max(0, now - ts)
tokens = math.min(capacity, tokens + elapsed * refill)

local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end

redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
redis.call('EXPIRE', key, 3600)
return allowed
`;

export interface RateLimitOptions {
  /** Requests per minute, per board, across ALL users and replicas. */
  perMinute: number;
}

export class BoardRateLimiter {
  private sha: string | null = null;

  constructor(private readonly redis: Redis, private readonly opts: RateLimitOptions) {}

  private async script(): Promise<string> {
    if (!this.sha) this.sha = await this.redis.script("LOAD", BUCKET_LUA) as string;
    return this.sha;
  }

  /** True if a token was consumed. False means "wait and retry". */
  async tryAcquire(board: string): Promise<boolean> {
    const sha = await this.script();
    const result = await this.redis.evalsha(
      sha, 1,
      `ratelimit:board:${board}`,
      String(this.opts.perMinute),
      String(this.opts.perMinute / 60),
      String(Date.now() / 1000),
    );
    return result === 1;
  }

  /** Block until a token is available, or give up. */
  async acquire(board: string, timeoutMs = 60_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.tryAcquire(board)) return true;
      await new Promise((r) => setTimeout(r, 1_000));
    }
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Circuit breaker                                                     */
/* ------------------------------------------------------------------ */

export type CircuitState = "closed" | "open" | "half_open";

/**
 * CLOSED --5 failures in 10 min--> OPEN --after 15 min--> HALF_OPEN
 *    ^                                                        |
 *    +---------------------- 1 success -----------------------+
 *
 * EC-P2-38 — this is deliberately GLOBAL, so one user's bad luck skips the
 * board for everyone. That is the correct trade (it protects the board, which
 * protects everyone's long-term access), but the UI must say "temporarily
 * unavailable" rather than "failed": the second user did nothing wrong.
 */
export class BoardCircuitBreaker {
  constructor(
    private readonly redis: Redis,
    private readonly failureThreshold = 5,
    private readonly windowSec = 600,
    private readonly openSec = 900,
  ) {}

  private key(board: string) { return `circuit:board:${board}`; }

  async state(board: string): Promise<CircuitState> {
    const [openedAt, failures] = await this.redis.hmget(
      this.key(board), "openedAt", "failures",
    );
    if (!openedAt) return "closed";

    const elapsed = (Date.now() - Number(openedAt)) / 1000;
    if (elapsed > this.openSec) return "half_open";
    return Number(failures) >= this.failureThreshold ? "open" : "closed";
  }

  async recordSuccess(board: string): Promise<void> {
    await this.redis.del(this.key(board));
  }

  async recordFailure(board: string): Promise<void> {
    const key = this.key(board);
    const failures = await this.redis.hincrby(key, "failures", 1);
    if (failures === 1) {
      await this.redis.hset(key, "openedAt", Date.now());
    }
    await this.redis.expire(key, this.windowSec + this.openSec);
  }

  /**
   * EC-P2-40 — in half-open, only ONE probe should go through. Without the
   * lock, half-open behaves like closed and every waiting request stampedes
   * the board that was just failing.
   */
  async tryProbe(board: string): Promise<boolean> {
    const acquired = await this.redis.set(
      `${this.key(board)}:probe`, "1", "EX", 30, "NX",
    );
    return acquired === "OK";
  }
}
