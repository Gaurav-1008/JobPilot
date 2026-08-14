/**
 * Sample data for a first sign-in (P7.1.4).
 *
 * Explicitly requested rather than seeded automatically on signup. EC-P7-03's
 * concern is onboarding that does work per account creation; making this a
 * button means the cost is paid only by users who want the demonstration, and
 * users who know what they are doing never pay it at all.
 *
 * DELETE is a first-class operation, not an afterthought — sample data must be
 * as easy to remove as it was to create (EC-P7-04), or it stops being a
 * demonstration and becomes clutter indistinguishable from the user's own work.
 */

import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { toErrorResponse } from "@/lib/api-errors";
import {
  clearSampleData,
  onboardingState,
  seedSampleData,
} from "@/lib/db/stores/onboarding";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { userId } = await requireSession();
    return NextResponse.json(await onboardingState(userId));
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST() {
  try {
    const { userId } = await requireSession();
    const { jobs } = await seedSampleData(userId);
    return NextResponse.json({
      jobs,
      // Stated in the response, not only in the UI, so any client that grows
      // around this endpoint inherits the caveat rather than reinventing it.
      note: "Sample data is labelled and is never used as your default resume.",
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const { userId } = await requireSession();
    await clearSampleData(userId);
    return NextResponse.json({ cleared: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
