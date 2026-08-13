/**
 * Assembles everything grounding and the review screen need (P5.3).
 *
 * Kept apart from `grounding.ts` so that module stays a pure function over its
 * inputs — testable with fixtures, no database. This is the impure half: it
 * resolves rows, and it is the only place that decides WHICH resume counts as
 * the verification corpus.
 *
 * That decision matters. EC-P5-34 says claims are verified against the full
 * resume, and there are two candidates: the resume captured on the tailoring
 * run, or the user's current default. The RUN's copy wins when one exists —
 * it is the resume the email's evidence was actually derived from, and a
 * resume edited after the run would verify claims against text that had no
 * part in producing them.
 */

import type { ResumeProfile, TailoringRun } from "@jobpilot/shared-schemas";

import { scoped } from "@/lib/db/repository";
import { getRun } from "@/lib/db/stores/tailoring-run";
import { getDefaultResume } from "@/lib/db/stores/resume";

export interface GroundingContext {
  /** Null only when the user has neither a tailoring run nor a default resume. */
  resume: ResumeProfile | null;
  tailoredBullets: string[];
  /** JD skills ∪ resume skills — the terms a claim is tested against. */
  skillVocabulary: string[];
  run: TailoringRun | null;
}

export async function loadGroundingContext(
  userId: string,
  applicationId: string,
): Promise<GroundingContext> {
  const db = scoped(userId);

  // EC-P5-27: `full` runs only — a cheap run has a score but no evidence.
  const runRow = await db.tailoringRuns.latestFullForApplication(applicationId);
  const run = runRow ? await getRun(runRow.id, userId) : null;

  let resume: ResumeProfile | null = run?.resume ?? null;
  if (!resume) {
    const fallback = await getDefaultResume(userId);
    resume = (fallback?.profile as ResumeProfile | undefined) ?? null;
  }

  const tailoredBullets = (run?.tailoredResume?.tailoredExperience ?? []).flatMap(
    (role) => role.bullets.map((b) => b.tailored),
  );

  // The vocabulary is what a claim is TESTED against; the corpus is what backs
  // it up. Both JD and resume terms belong here: a JD skill absent from the
  // resume is exactly the claim worth flagging, and a resume skill absent from
  // the JD still needs checking after a user edit.
  const skillVocabulary = Array.from(
    new Set([
      ...(run?.jobDescription.requiredSkills ?? []),
      ...(run?.jobDescription.preferredSkills ?? []),
      ...(run?.jobDescription.tools ?? []),
      ...(resume?.skills ?? []),
    ]),
  );

  return { resume, tailoredBullets, skillVocabulary, run };
}
