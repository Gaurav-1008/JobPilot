import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { analyze, tailor } from "@/lib/orchestrator";
import { getDefaultResume } from "@/lib/db/stores/resume";
import { getJobWithDescription } from "@/lib/db/stores/harvest";
import { finaliseTailoredScore } from "@/lib/db/stores/harvest";
import { toErrorResponse, BadRequestError, errorResponse } from "@/lib/api-errors";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({ jobId: z.string().uuid() });

/**
 * POST /api/tailor/job — Tier 2 for ONE job (P4.4.1/P4.4.3).
 *
 * Synchronous, not queued (ADR-005): the user is watching, it takes ~20s, and
 * queueing would add latency plus a polling UI for nothing.
 *
 * The only change from the Phase 1 flow is provenance — the JD arrives from the
 * `Job` record instead of a paste box.
 */
export async function POST(request: Request) {
  try {
    const { userId } = await requireSession();
    const parsed = Body.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new BadRequestError("A jobId is required.");

    const job = await getJobWithDescription(parsed.data.jobId, userId);
    if (!job) return errorResponse("Job not found.", "JOB_NOT_FOUND", 404);

    // EC-P4-28 — refuse rather than run the chain on a null JD. Tailoring an
    // unhydrated job produces a confident, meaningless run, which is worse
    // than an error because nothing downstream flags it.
    if (job.hydrationStatus !== "hydrated" || !job.jobDescription?.rawText) {
      return NextResponse.json(
        {
          error: "NOT_HYDRATED",
          message: "Fetch this job's description first — tailoring needs it.",
        },
        { status: 409 },
      );
    }

    const resume = await getDefaultResume(userId);
    if (!resume) {
      throw new BadRequestError("Upload a resume and set it as default first.");
    }

    // The existing chain, unchanged: analyze -> tailor -> guardrails -> persist.
    const analysis = await analyze(userId, resume.rawText, job.jobDescription.rawText);
    const tailored = await tailor(userId, analysis.runId);

    // EC-P4-30/31 — status and score are written only AFTER a successful,
    // guardrail-checked run. And a tailored score LOWER than the original is
    // reported honestly, never hidden or retried.
    await finaliseTailoredScore({
      userId,
      jobId: job.id,
      resumeId: resume.id,
      runId: analysis.runId,
      originalScore: analysis.originalMatch.overallScore,
      tailoredScore: tailored.tailoredMatch.overallScore,
    });

    return NextResponse.json({
      runId: analysis.runId,
      originalScore: analysis.originalMatch.overallScore,
      tailoredScore: tailored.tailoredMatch.overallScore,
      warnings: tailored.warnings,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
