import { NextResponse } from "next/server";

import { TailorRequestSchema } from "@/lib/schemas";
import { tailor } from "@/lib/orchestrator";
import { getRun } from "@/lib/run-store";
import {
  readJson,
  toErrorResponse,
  BadRequestError,
  errorResponse,
  rateLimitedResponse,
} from "@/lib/api-errors";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { requireSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/tailor
 * Body: { runId } → rewrite bullets, re-score, persist. Returns tailored resume,
 * tailored match, and warnings.
 */
export async function POST(request: Request) {
  try {
    const { userId } = await requireSession();
    const rl = rateLimit(clientIp(request), "tailor", 10, 60_000);
    if (!rl.ok) return rateLimitedResponse(rl.retryAfterSec);

    const body = await readJson(request);
    const parsed = TailorRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestError(
        "A runId is required. Run analyze first.",
        parsed.error.flatten(),
      );
    }

    if (!getRun(parsed.data.runId)) {
      return errorResponse(
        "Run not found or expired. Please analyze again.",
        "RUN_NOT_FOUND",
        404,
      );
    }

    const result = await tailor(userId, parsed.data.runId);
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
