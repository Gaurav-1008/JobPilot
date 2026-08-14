/**
 * W3C trace context (P7.3.4, EC-P7-22, architecture.md §16.3).
 *
 * §16.3 asks for one trace per user action spanning ① → ② → ③ → ④, and notes
 * that the boundary crossings are the only spans worth having. That is exactly
 * right for this system: the interesting latency in a two-language stack is
 * never inside a function, it is in the hop where a TypeScript caller waits on
 * a Python handler and neither side's logs mention the other.
 *
 * We implement the wire format rather than a tracing SDK. The format IS the
 * interoperability contract — `traceparent` is what OpenTelemetry, Datadog, and
 * every managed backend read — so emitting a correct header from a 60-line file
 * means a collector can be added later by pointing at the logs, with no call
 * site touched. Pulling in an SDK now would be the larger commitment for the
 * same immediate benefit, which is that `traceId` appears on both sides of a
 * boundary and joins.
 *
 * Format (W3C Trace Context, version 00):
 *   traceparent: 00-<32 hex trace-id>-<16 hex parent-id>-<2 hex flags>
 */

import { randomBytes } from "node:crypto";

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/** All-zero ids are explicitly invalid in the spec, and mean "no trace". */
const NULL_TRACE = "0".repeat(32);
const NULL_SPAN = "0".repeat(16);

export interface TraceContext {
  traceId: string;
  spanId: string;
  /** 01 = sampled. We sample everything at this scale. */
  flags: string;
}

export function newTraceId(): string {
  return randomBytes(16).toString("hex");
}

export function newSpanId(): string {
  return randomBytes(8).toString("hex");
}

/**
 * Continue an inbound trace, or start a new one.
 *
 * A malformed or all-zero header starts a fresh trace rather than throwing. An
 * unparseable header is somebody else's bug, and losing a trace is a monitoring
 * gap; refusing the request over it would turn that gap into an outage.
 */
export function traceFromHeaders(headers: Headers): TraceContext {
  const raw = headers.get("traceparent");
  const match = raw ? TRACEPARENT.exec(raw.trim()) : null;

  if (match && match[1] !== NULL_TRACE && match[2] !== NULL_SPAN) {
    // Inbound span becomes our parent; we mint a fresh span id for this hop.
    return { traceId: match[1], spanId: newSpanId(), flags: match[3] };
  }
  return { traceId: newTraceId(), spanId: newSpanId(), flags: "01" };
}

/** Serialize for the outbound hop. The child gets us as its parent. */
export function traceparentHeader(ctx: TraceContext): string {
  return `00-${ctx.traceId}-${ctx.spanId}-${ctx.flags}`;
}
