/**
 * Generate an outreach draft (P5.2.7).
 *
 * This endpoint produces a DRAFT and nothing else. It writes an OutreachAttempt
 * in `generated` state, which is the furthest anything gets without a human
 * reading it: there is no path from here to a provider, and adding one would
 * mean deleting the review screen, the approval token, and the interlock chain
 * on the way.
 *
 * EC-P5-22: a weak payload is logged as a quality metric rather than silently
 * shipped. Per FR7 a generic hook where evidence should exist signals a bug in
 * the payload builder, not merely a bland email.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { BadRequestError, readJson, toErrorResponse } from "@/lib/api-errors";
import { scoped } from "@/lib/db/repository";
import { getProfile } from "@/lib/db/users";
import { getRun } from "@/lib/db/stores/tailoring-run";
import { createGeneratedAttempt } from "@/lib/db/stores/outreach";
import { countWords, normalizeAndHash } from "@/lib/outreach/body";
import {
  buildPayload,
  payloadIsWeak,
  toWirePersonalization,
} from "@/lib/outreach/personalization";
import { generateEmail, WorkerError } from "@/lib/outreach/worker-client";
import { checkGrounding } from "@/lib/outreach/grounding";
import { loadGroundingContext } from "@/lib/outreach/review-context";

export const runtime = "nodejs";

const GenerateSchema = z.object({
  contactId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const { userId } = await requireSession();
    const parsed = GenerateSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new BadRequestError("contactId is required.", parsed.error.flatten());
    }

    const db = scoped(userId);
    const contact = await db.contacts.byId(parsed.data.contactId);
    // EC-P1-26: not-yours and does-not-exist are the same answer.
    if (!contact) {
      return NextResponse.json(
        { error: "Contact not found.", code: "NOT_FOUND" },
        { status: 404 },
      );
    }

    const application = await db.applications.byId(contact.applicationId);
    if (!application) {
      return NextResponse.json(
        { error: "Application not found.", code: "NOT_FOUND" },
        { status: 404 },
      );
    }
    const job = await db.jobs.byId(application.jobId);
    const profile = await getProfile(userId);

    // EC-P5-27: only a `full` run carries bullet evidence — the accessor filters
    // on tier, so a cheap run cannot become a payload. EC-P5-20: null is fine.
    const runRow = await db.tailoringRuns.latestFullForApplication(application.id);
    const run = runRow ? await getRun(runRow.id, userId) : null;
    const payload = run ? buildPayload(run) : null;

    if (payloadIsWeak(payload)) {
      // FR7 quality metric, not a user-facing error. A generic hook where
      // evidence should exist means the builder found nothing to cite.
      console.warn(
        JSON.stringify({
          event: "outreach.payload_weak",
          applicationId: application.id,
          hasRun: run !== null,
          matchedSkills: payload?.topMatchedSkills.length ?? 0,
        }),
      );
    }

    const wordLimit = Number(process.env.EMAIL_WORD_LIMIT ?? 150);
    const request4 = (useLlm: boolean) => ({
      contact: {
        recipient_email: contact.recipientEmail,
        recipient_name: contact.recipientName,
        company: job?.company ?? "",
        role: job?.title ?? "",
        job_url: job?.link ?? null,
        personalization_note: contact.personalizationNote,
      },
      sender: {
        candidate_name: profile.candidateName ?? "",
        candidate_background: profile.candidateBackground ?? "",
        portfolio_url: profile.portfolioUrl ?? null,
        linkedin_url: profile.linkedinUrl ?? null,
      },
      personalization: payload ? toWirePersonalization(payload) : null,
      use_llm: useLlm,
      word_limit: wordLimit,
    });

    let generated;
    try {
      generated = await generateEmail(request4(true));
    } catch (err) {
      // EC-P5-29: never surface a raw provider error on the review screen. ④
      // already falls back to the template internally, so reaching here means
      // the service itself is unreachable.
      if (err instanceof WorkerError) {
        return NextResponse.json(
          {
            error: "Could not reach the email service. Try again in a moment.",
            code: "WORKER_UNAVAILABLE",
          },
          { status: 503 },
        );
      }
      throw err;
    }

    // ─── P5.3.1/P5.3.3 — grounding, then the template fallback ───────────
    //
    // §13.3 runs in ① AFTER ④ returns, and it does not trust ④'s own validator:
    // that one gates the LLM inside ④, this one gates whatever actually reaches
    // a human. Neither is sufficient alone.
    const ctx = await loadGroundingContext(userId, application.id);

    const ground = (text: string, source: "template" | "llm", warnings: string[]) =>
      ctx.resume
        ? checkGrounding({
            body: text,
            resume: ctx.resume,
            tailoredBullets: ctx.tailoredBullets,
            skillVocabulary: ctx.skillVocabulary,
            recipientName: contact.recipientName,
            senderName: profile.candidateName,
            wordLimit,
            wordCount: countWords(text),
            hasPayload: payload !== null,
            genericHook: warnings.includes("generic_hook"),
          })
        : // No resume anywhere means no verification corpus. Fail toward the
          // template rather than pretending an unverifiable LLM body passed.
          { blocked: source === "llm", findings: [] };

    let grounding = ground(generated.body, generated.source, generated.warnings);
    let fellBackToTemplate = false;

    if (grounding.blocked && generated.source === "llm") {
      // P5.3.3: a blocked LLM draft falls back to the deterministic template,
      // the same pattern ④'s validator already uses — same rule, new domain.
      const template = await generateEmail(request4(false));
      const templateGrounding = ground(template.body, "template", template.warnings);

      if (templateGrounding.blocked) {
        // EC-P5-36: the template tripped the check too. Surface it rather than
        // looping — a second regeneration would produce the same template and
        // the same block, forever.
        return NextResponse.json(
          {
            error:
              "The generated email could not be verified against your resume, " +
              "and neither could the plain template. This usually means a " +
              "grounding rule is matching your own wording — review the details.",
            code: "GROUNDING_BLOCKED",
            findings: templateGrounding.findings,
          },
          { status: 422 },
        );
      }

      generated = template;
      grounding = templateGrounding;
      fellBackToTemplate = true;
    }

    // EC-P5-48: normalize ONCE, here, and hash the normalized text. Everything
    // downstream — display, edit, approval, delivery — uses this exact string.
    const { body, hash } = normalizeAndHash(generated.body);

    const attempt = await createGeneratedAttempt({
      userId,
      applicationId: application.id,
      contactId: contact.id,
      subject: generated.subject_options[0] ?? "",
      body,
      bodyHash: hash,
      wordCount: countWords(body),
      generationSource: generated.source,
    });

    return NextResponse.json(
      {
        attemptId: attempt.id,
        subject: attempt.subject,
        subjectOptions: generated.subject_options,
        body,
        bodyHash: hash,
        wordCount: attempt.wordCount,
        source: generated.source,
        warnings: generated.warnings,
        // P5.3.5 — the evidence panel renders from this. A null payload is not
        // an empty panel; the screen says "no tailoring evidence" (EC-P5-40).
        payload,
        findings: grounding.findings,
        // Told plainly, because the user asked for a tailored email and got a
        // template. Silence here reads as the LLM simply writing blandly.
        fellBackToTemplate,
      },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
