import { NextResponse } from "next/server";

import { LlmError, llmErrorMessage, type LlmErrorCode } from "@/lib/llm/errors";
import { PdfError } from "@/lib/pdf/errors";

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

  console.error(
    JSON.stringify({
      event: "api.error",
      code: "INTERNAL_ERROR",
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  return errorResponse("Unexpected server error.", "INTERNAL_ERROR", 500);
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
