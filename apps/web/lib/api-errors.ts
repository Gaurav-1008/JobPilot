import { NextResponse } from "next/server";

import { LlmError, llmErrorMessage, type LlmErrorCode } from "@/lib/llm/errors";
import { log } from "@/lib/obs/logger";
import { PdfError } from "@/lib/pdf/errors";
import { QueueUnavailableError } from "@/lib/queue/producer";

const STATUS_BY_CODE: Record<LlmErrorCode, number> = {
  LLM_AUTH_FAILED: 502,
  LLM_RATE_LIMIT: 429,
  LLM_TIMEOUT: 504,
  LLM_INVALID_JSON: 502,
  LLM_CONFIG_ERROR: 503,
  LLM_UNKNOWN: 500,
};

/** 429 response with a Retry-After header. */
export function rateLimitedResponse(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    {
      error: "Too many requests. Please wait a moment and try again.",
      code: "RATE_LIMITED",
    },
    { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
  );
}

/** Standard error body: { error, code, details? }. */
export function errorResponse(
  message: string,
  code: string,
  status: number,
  details?: unknown,
): NextResponse {
  return NextResponse.json({ error: message, code, details }, { status });
}

/** Map any thrown error to the standard API error response (no payload leaks). */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof BadRequestError) {
    return errorResponse(err.message, "VALIDATION_ERROR", 400, err.details);
  }

  if (err instanceof PdfError) {
    const status = err.code === "PDF_NOT_TAILORED" ? 409 : 500;
    console.error(
      JSON.stringify({ event: "api.error", code: err.code, message: err.message }),
    );
    return errorResponse(err.message, err.code, status);
  }

  if (err instanceof LlmError) {
    const status = STATUS_BY_CODE[err.code] ?? 500;
    // Prefer the safe, user-facing message; fall back to the thrown message.
    const message =
      err.code === "LLM_UNKNOWN" ? err.message : llmErrorMessage(err.code);
    console.error(
      JSON.stringify({
        event: "api.error",
        code: err.code,
        stage: err.stage,
        message: err.message,
      }),
    );
    return errorResponse(message, err.code, status);
  }

  // EC-P7-10 — name what is degraded, rather than saying something is wrong.
  //
  // A 500 would be both wrong and unhelpful: nothing failed, a dependency is
  // unreachable, and the rest of the product still works. 503 is the honest
  // status, and the message says which capability is paused so the user knows
  // there is somewhere else worth going.
  if (err instanceof QueueUnavailableError) {
    log.warn("api.degraded", { code: "QUEUE_UNAVAILABLE", outcome: "degraded" });
    return NextResponse.json(
      {
        error:
          "Job searching is temporarily unavailable — the background queue is unreachable. Tailoring, review, and sending still work.",
        code: "QUEUE_UNAVAILABLE",
      },
      // Retry-After turns "try again later" into a number. 30s matches the
      // health cache's healthy TTL, so a client honouring it will not beat the
      // banner to the news that things recovered.
      { status: 503, headers: { "Retry-After": "30" } },
    );
  }

  // EC-P7-16 — Postgres is §18's accepted single point of failure, and the
  // requirement there is narrow: a clean 503 with a maintenance message, not a
  // stack trace and not a hang. Prisma types its connection failures, so "the
  // database is down" is distinguishable from "this query is wrong" without
  // inferring anything from message text.
  if (isDatabaseUnavailable(err)) {
    log.error("api.database_unavailable", {
      code: "DATABASE_UNAVAILABLE",
      outcome: "error",
    });
    return NextResponse.json(
      {
        error:
          "The service is temporarily unavailable while the database is unreachable. Nothing you submitted was lost — please try again shortly.",
        code: "DATABASE_UNAVAILABLE",
      },
      { status: 503, headers: { "Retry-After": "15" } },
    );
  }

  log.error("api.error", {
    code: "INTERNAL_ERROR",
    // Passed as a value so the serializer projects the Error safely rather than
    // us flattening it first — an error off the delivery path can carry a
    // credential in an attached property (EC-P7-17).
    message: err,
  });
  return errorResponse("Unexpected server error.", "INTERNAL_ERROR", 500);
}

/**
 * Is this "the database is unreachable" rather than "this query is wrong"?
 *
 * Prisma uses P1xxx for connection and startup problems and P2xxx for query
 * problems, which is exactly the line EC-P7-16 needs drawn.
 * `PrismaClientInitializationError` covers the case where the pool never came
 * up at all.
 *
 * Matched on `name`/`code` rather than by importing Prisma's error classes:
 * the P0.3.4 lint rule bans importing the Prisma client outside lib/db, and
 * this file is not lib/db.
 */
function isDatabaseUnavailable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if ((err as { name?: string }).name === "PrismaClientInitializationError") return true;

  const code = (err as { code?: string }).code;
  // P1001 cannot reach server · P1002 timed out · P1008 operation timed out
  // P1017 server closed the connection
  return typeof code === "string" && /^(P1001|P1002|P1008|P1017)$/.test(code);
}

/** Parse + validate a JSON request body, throwing a friendly 400 on failure. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new BadRequestError("Invalid JSON body.");
  }
}

export class BadRequestError extends Error {
  readonly details?: unknown;
  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "BadRequestError";
    this.details = details;
  }
}
