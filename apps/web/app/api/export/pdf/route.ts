import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { getRun } from "@/lib/db/stores/tailoring-run";
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
 * Body: { runId, types? } → base64-encoded PDFs.
 *
 * Two things were wrong here until Phase 6, and they compounded:
 *
 * 1. It read from `lib/run-store` — the IN-MEMORY store Phase 1 replaced. A run
 *    loaded from the database was never in that map, so exporting a persisted
 *    run answered "Run not found or expired. Please analyze again." §16.6 asks
 *    for exactly this export, and it could not work for any run older than the
 *    current server process.
 *
 * 2. There was no session check. That map is process-global and keyed by run id
 *    alone, so any caller who knew or guessed an id could export somebody
 *    else's résumé — a cross-tenant read of the most personal artifact here.
 *    Invariant 5 says every tenant-scoped read is filtered by user_id; this one
 *    was not filtered at all.
 *
 * Now: session required, and the run is fetched through the tenant-scoped
 * store, so another user's valid id resolves to null and 404s (EC-P1-26).
 */
export async function POST(request: Request) {
  try {
    const { userId } = await requireSession();

    const rl = rateLimit(clientIp(request), "export", 20, 60_000);
    if (!rl.ok) return rateLimitedResponse(rl.retryAfterSec);

    const body = await readJson(request);
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestError("A runId is required.", parsed.error.flatten());
    }

    const run = await getRun(parsed.data.runId, userId);
    if (!run) {
      // EC-P1-26: "not yours" and "does not exist" are the same answer.
      return errorResponse("Run not found.", "RUN_NOT_FOUND", 404);
    }

    const pdfs = await generatePdfs(run, parsed.data.types);

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
