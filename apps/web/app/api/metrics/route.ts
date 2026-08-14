/**
 * Prometheus exposition for the §16.2 metric set (P7.3.3).
 *
 * Not public. Metrics describe the shape of the system — how many sends are
 * blocked, which boards are failing, how many tokens a tier burns — and while
 * none of it is personal data (EC-P7-20 guarantees no label carries an id), it
 * is reconnaissance. A scraper presents `METRICS_TOKEN`.
 *
 * With no token configured the endpoint 404s rather than serving openly. That
 * ordering matters: "unconfigured" must resolve to the closed state, not the
 * open one (invariant 3 — safe defaults survive misconfiguration). A 404 rather
 * than a 403 because the endpoint's existence is itself not worth confirming.
 */

import { NextResponse } from "next/server";

import { renderPrometheus } from "@/lib/obs/metrics";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const expected = process.env.METRICS_TOKEN?.trim();
  if (!expected) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const presented = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (presented !== expected) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return new NextResponse(renderPrometheus(), {
    status: 200,
    headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
  });
}
