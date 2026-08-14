/**
 * Run the follow-up sweep (P6.2.1, P6.2.3).
 *
 * User-triggered here rather than cron-only, because a sweep that runs while
 * you sleep and leaves drafts nobody knows about is a queue nobody clears
 * (EC-P6-23). The same function is what a scheduled runner would call.
 *
 * THIS ROUTE CANNOT SEND. It generates drafts in `generated` state, exactly as
 * if you had pressed "Write draft" yourself, and they traverse the identical
 * interlock chain when you later approve one. There is deliberately no import
 * of the delivery path anywhere in this file or in followup-sweep.ts.
 */

import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { toErrorResponse } from "@/lib/api-errors";
import { getProfile } from "@/lib/db/users";
import { scoped } from "@/lib/db/repository";
import { countWords, normalizeAndHash } from "@/lib/outreach/body";
import {
  DEFAULT_FOLLOWUP_DAYS,
  findSweepCandidates,
  recordFollowUp,
} from "@/lib/outreach/followup-sweep";
import { generateEmail, WorkerError } from "@/lib/outreach/worker-client";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const { userId } = await requireSession();
    const days = Number(
      new URL(request.url).searchParams.get("days") ?? DEFAULT_FOLLOWUP_DAYS,
    );

    const profile = await getProfile(userId);
    // EC-P6-21: never generate more than roughly a day's sending allowance.
    const candidates = await findSweepCandidates({
      userId,
      days: Number.isFinite(days) && days > 0 ? days : DEFAULT_FOLLOWUP_DAYS,
      limit: profile.maxOutreachPerDay,
    });

    const created: string[] = [];
    for (const candidate of candidates) {
      let generated;
      try {
        generated = await generateEmail({
          contact: {
            recipient_email: candidate.recipientEmail,
            recipient_name: candidate.recipientName,
            company: candidate.company,
            role: candidate.role,
            job_url: null,
            // EC-P6-17: the previous email is the context, quoted from the
            // stored snapshot rather than reconstructed.
            personalization_note:
              `Following up on an earlier note about the ${candidate.role} role. ` +
              `The original said: ${candidate.parentBody.slice(0, 300)}`,
          },
          sender: {
            candidate_name: profile.candidateName ?? "",
            candidate_background: profile.candidateBackground ?? "",
            portfolio_url: profile.portfolioUrl ?? null,
            linkedin_url: profile.linkedinUrl ?? null,
          },
          personalization: null,
          use_llm: true,
          word_limit: Number(process.env.EMAIL_WORD_LIMIT ?? 150),
        });
      } catch (err) {
        // One unreachable generation must not abandon the rest of the sweep.
        if (err instanceof WorkerError) continue;
        throw err;
      }

      const { body, hash } = normalizeAndHash(generated.body);
      const attempt = await recordFollowUp({
        userId,
        candidate,
        subject: `Re: ${candidate.parentSubject}`,
        body,
        bodyHash: hash,
        wordCount: countWords(body),
        generationSource: generated.source,
      });
      created.push(attempt.id);
    }

    const db = scoped(userId);
    void db;   // reserved: per-application routing lands with the review queue UI

    return NextResponse.json({
      generated: created.length,
      candidates: candidates.length,
      // Named for what it actually measures. EC-P6-12: nothing here reads an
      // inbox, so this is silence on OUR side of the record, not theirs.
      basis: "no response recorded by you",
      message:
        created.length === 0
          ? "No follow-ups needed. Nothing has been sent long enough ago without a recorded response."
          : `${created.length} follow-up draft(s) waiting for your review. Nothing was sent.`,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
