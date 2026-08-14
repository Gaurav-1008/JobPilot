/**
 * Dependency health for the degradation banner (P7.2.4).
 *
 * Answers from the TTL cache (EC-P7-11), so polling this endpoint cannot turn
 * into load on the dependencies it reports. Deliberately cheap and
 * unauthenticated-in-effect: it exposes two booleans and no detail about why
 * something is down, which is what a banner needs and all a stranger gets.
 *
 * Postgres is absent by design — see the header of lib/health/dependencies.ts.
 */

import { NextResponse } from "next/server";

import { degradationNotice, systemHealth } from "@/lib/health/dependencies";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const health = await systemHealth();

  return NextResponse.json(
    {
      ok: health.allUp,
      redis: health.redis.up,
      worker: health.worker.up,
      notice: degradationNotice(health),
    },
    {
      // 200 even when degraded: this endpoint reports a state, it does not
      // have one. A 503 here would make an uptime monitor page for a Redis
      // outage that, per §18, leaves the product usable.
      status: 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
