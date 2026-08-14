/**
 * Structured logging (P7.3.1, architecture.md §16.1).
 *
 * §16.1: one JSON line per operation, always carrying
 * `{ requestId, userId, jobName?, durationMs, outcome }`.
 *
 * Two design points worth stating.
 *
 * 1. CORRELATION IS AMBIENT, NOT THREADED. `requestId`, `traceId`, and `userId`
 *    live in an AsyncLocalStorage established once per request, so a log line
 *    written five calls deep carries them without every intermediate function
 *    taking a context parameter. The alternative — passing a logger down — is
 *    tidier in theory and in practice means the one call site that matters, the
 *    error path in a leaf helper, is the one that never got the parameter.
 *
 * 2. EVERY LINE GOES THROUGH `safeSerialize`. There is no unredacted path out
 *    of this module (EC-P7-17). `log.error("x", { err })` is a normal thing to
 *    write and must be safe by construction, not by the author remembering what
 *    an axios error carries.
 *
 * `console` is the transport on purpose. Both deployment targets in §17 —
 * Vercel for ① and a container platform for ③/④ — collect stdout and do their
 * own shipping. A log library would add a dependency to do what the platform
 * already does, and JSON-on-stdout is what every collector ingests.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import { safeSerialize } from "./redact";
import { newSpanId, newTraceId, traceFromHeaders, type TraceContext } from "./trace";

export interface RequestContext {
  requestId: string;
  traceId: string;
  spanId: string;
  flags: string;
  /** Absent until the session resolves — routes log before they authenticate. */
  userId?: string;
  route?: string;
  method?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

/** The trace to propagate on an outbound hop, if we are inside a request. */
export function currentTrace(): TraceContext | undefined {
  const ctx = storage.getStore();
  return ctx && { traceId: ctx.traceId, spanId: ctx.spanId, flags: ctx.flags };
}

/**
 * Attach the user to the ambient context once the session resolves.
 *
 * Mutating the stored object rather than re-entering the storage: the session
 * is resolved inside the request scope, and every subsequent line — including
 * ones written by code that never saw the session — should carry the id.
 */
export function setContextUser(userId: string): void {
  const ctx = storage.getStore();
  if (ctx) ctx.userId = userId;
}

/** Run `fn` inside a fresh request context, continuing any inbound trace. */
export function withRequestContext<T>(
  init: { headers?: Headers; route?: string; method?: string },
  fn: (ctx: RequestContext) => T,
): T {
  const trace = init.headers
    ? traceFromHeaders(init.headers)
    : { traceId: newTraceId(), spanId: newSpanId(), flags: "01" };

  const ctx: RequestContext = {
    requestId: randomUUID(),
    traceId: trace.traceId,
    spanId: trace.spanId,
    flags: trace.flags,
    route: init.route,
    method: init.method,
  };
  return storage.run(ctx, () => fn(ctx));
}

/**
 * Background jobs get a context too (③ has no HTTP request to hang one off).
 *
 * `jobName` is the §16.1 field that distinguishes a queue line from a request
 * line; it is passed per-call rather than stored, because one worker process
 * handles several job types.
 */
export function withJobContext<T>(
  init: { traceId?: string; userId?: string },
  fn: (ctx: RequestContext) => T,
): T {
  const ctx: RequestContext = {
    requestId: randomUUID(),
    traceId: init.traceId ?? newTraceId(),
    spanId: newSpanId(),
    flags: "01",
    userId: init.userId,
  };
  return storage.run(ctx, () => fn(ctx));
}

export type Outcome = "ok" | "error" | "blocked" | "degraded" | "skipped";

type Level = "info" | "warn" | "error";

function emit(level: Level, event: string, fields: Record<string, unknown>): void {
  const ctx = storage.getStore();
  const line = safeSerialize({
    event,
    level,
    requestId: ctx?.requestId,
    traceId: ctx?.traceId,
    spanId: ctx?.spanId,
    userId: ctx?.userId,
    route: ctx?.route,
    method: ctx?.method,
    ...fields,
  });

  // eslint-disable-next-line no-console -- stdout is the transport (see header)
  (level === "error" ? console.error : level === "warn" ? console.warn : console.info)(line);
}

export const log = {
  info: (event: string, fields: Record<string, unknown> = {}) => emit("info", event, fields),
  warn: (event: string, fields: Record<string, unknown> = {}) => emit("warn", event, fields),
  error: (event: string, fields: Record<string, unknown> = {}) => emit("error", event, fields),
};

/**
 * Time an operation and log exactly one line for it, whatever happens.
 *
 * The `outcome` field is what makes these lines aggregatable — "how many
 * deliveries were blocked this hour" is a filter, not a text search. Errors are
 * re-thrown after logging: this is an observer, and swallowing here would turn
 * a failed operation into a successful-looking one.
 */
export async function observe<T>(
  event: string,
  fields: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    log.info(event, { ...fields, outcome: "ok", durationMs: Date.now() - started });
    return result;
  } catch (err) {
    log.error(event, {
      ...fields,
      outcome: "error",
      durationMs: Date.now() - started,
      // Passed as a value, not interpolated: redact() projects Error safely,
      // while `${err}` would flatten a credential-carrying error into a string
      // before the serializer ever saw its shape.
      message: err instanceof Error ? err.message : String(err),
      name: err instanceof Error ? err.name : "Unknown",
    });
    throw err;
  }
}
