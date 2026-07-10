import { NextResponse } from "next/server";

import { AnalyzeRequestSchema } from "@/lib/schemas";
import { analyze } from "@/lib/orchestrator";
import {
  readJson,
  toErrorResponse,
  BadRequestError,
  rateLimitedResponse,
} from "@/lib/api-errors";
import { rateLimit, clientIp } from "@/lib/rate-limit";

// LLM work needs the Node runtime and can exceed the default function budget.
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/analyze
 * Body: { resumeText, jdText } → parse both, score original, gaps. Persists the
 * run so /api/tailor can retrieve it by runId.
 */
export async function POST(request: Request) {
  try {
    const rl = rateLimit(clientIp(request), "analyze", 10, 60_000);
    if (!rl.ok) return rateLimitedResponse(rl.retryAfterSec);

    const body = await readJson(request);
    const parsed = AnalyzeRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestError(
        "Resume and job description are both required.",
        parsed.error.flatten(),
      );
    }

    const result = await analyze(parsed.data.resumeText, parsed.data.jdText);
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
