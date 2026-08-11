import { NextResponse } from "next/server";
import { z } from "zod";

import { getRun, saveRun } from "@/lib/run-store";
import { generatePdfs } from "@/services/pdf-generator";
import {
  readJson,
  toErrorResponse,
  BadRequestError,
  errorResponse,
  rateLimitedResponse,
} from "@/lib/api-errors";
import { rateLimit, clientIp } from "@/lib/rate-limit";

// Chromium needs the Node runtime and headroom for launch + render.
export const runtime = "nodejs";
export const maxDuration = 120;

const BodySchema = z.object({
  runId: z.string().min(1),
  types: z
    .array(z.enum(["tailored", "comparison"]))
    .nonempty()
    .default(["tailored", "comparison"]),
});

/**
 * POST /api/export/pdf
 * Body: { runId, types? } → base64-encoded PDFs. Sets run status to "exported".
 */
export async function POST(request: Request) {
  try {
    const rl = rateLimit(clientIp(request), "export", 20, 60_000);
    if (!rl.ok) return rateLimitedResponse(rl.retryAfterSec);

    const body = await readJson(request);
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestError("A runId is required.", parsed.error.flatten());
    }

    const run = getRun(parsed.data.runId);
    if (!run) {
      return errorResponse(
        "Run not found or expired. Please analyze again.",
        "RUN_NOT_FOUND",
        404,
      );
    }

    const pdfs = await generatePdfs(run, parsed.data.types);

    if (run.status !== "exported") {
      saveRun({ ...run, status: "exported" });
    }

    return NextResponse.json({
      runId: run.id,
      files: pdfs.map((p) => ({
        type: p.type,
        filename: p.filename,
        mimeType: "application/pdf",
        base64: p.buffer.toString("base64"),
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
