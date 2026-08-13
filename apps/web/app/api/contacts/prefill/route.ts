/**
 * Contact-form prefill (P5.1.2).
 *
 * Company, role, and job URL come from the `Job` the application points at, so
 * the user retypes nothing the platform already knows — and, more importantly,
 * so the company/role that end up in the email are the ones actually on the
 * job record rather than whatever a human retyped from memory.
 */

import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { BadRequestError, toErrorResponse } from "@/lib/api-errors";
import { scoped } from "@/lib/db/repository";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { userId } = await requireSession();
    const applicationId = new URL(request.url).searchParams.get("applicationId");
    if (!applicationId) throw new BadRequestError("applicationId is required.");

    const db = scoped(userId);
    const application = await db.applications.byId(applicationId);
    // EC-P1-26: not-yours and does-not-exist are indistinguishable.
    if (!application) {
      return NextResponse.json(
        { error: "Application not found.", code: "NOT_FOUND" },
        { status: 404 },
      );
    }

    const job = await db.jobs.byId(application.jobId);
    return NextResponse.json({
      company: job?.company ?? null,
      role: job?.title ?? null,
      jobUrl: job?.link ?? null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
