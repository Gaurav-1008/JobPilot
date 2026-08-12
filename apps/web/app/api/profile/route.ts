import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { getProfile, updateProfile } from "@/lib/db/users";
import { toErrorResponse, BadRequestError } from "@/lib/api-errors";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { userId } = await requireSession();
    return NextResponse.json(await getProfile(userId));
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * PATCH /api/profile — sender identity only (P1.1.4).
 *
 * EC-P1-07 / P1.1.5: dry_run, send_mode and max_outreach_per_day are
 * DELIBERATELY not writable here. They are displayed read-only until P5.5.10,
 * and "read-only in the UI" has to mean "not writable on the server" or it
 * means nothing — a devtools request would otherwise flip the outreach safety
 * settings before any of the interlocks that depend on them exist.
 */
const PatchSchema = z.object({
  candidateName: z.string().max(200).nullable().optional(),
  candidateBackground: z.string().max(2000).nullable().optional(),
  portfolioUrl: z.string().url().max(500).nullable().optional(),
  linkedinUrl: z.string().url().max(500).nullable().optional(),
});

export async function PATCH(request: Request) {
  try {
    const { userId } = await requireSession();
    const parsed = PatchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      throw new BadRequestError("Invalid profile fields.", parsed.error.flatten());
    }
    return NextResponse.json(await updateProfile(userId, parsed.data));
  } catch (err) {
    return toErrorResponse(err);
  }
}
