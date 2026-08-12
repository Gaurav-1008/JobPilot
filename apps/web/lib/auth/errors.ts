/**
 * Maps auth/domain errors to HTTP responses (P1.1.2).
 *
 * EC-P1-26: unauthorized and not-found are the SAME response for tenant-scoped
 * resources — a 403 confirms the id exists, which is an enumeration oracle.
 */
import { NextResponse } from "next/server";

import { UnauthorizedError } from "./session";

export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: err.message },
      { status: 401 },
    );
  }
  const message = err instanceof Error ? err.message : "Unexpected error.";
  return NextResponse.json({ error: "INTERNAL", message }, { status: 500 });
}
