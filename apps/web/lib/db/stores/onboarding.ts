/**
 * Sample data for a first sign-in (P7.1.4).
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EC-P7-03 — SEEDED FROM FIXTURES, NEVER FROM A LIVE HARVEST.
 *
 * "Run a sample search so the new user sees results" is the obvious onboarding,
 * and it multiplies scraping load by the signup rate. Every account creation
 * becomes three requests to real job boards, made on behalf of somebody who has
 * not asked for anything yet — and it does that whether or not they ever come
 * back. §11.4's conduct controls exist to keep our traffic proportionate to
 * intent, and a per-signup scrape is the clearest possible violation of that.
 *
 * The jobs below are therefore FIXTURES. They are also, deliberately, not
 * pretending otherwise: every row is labelled in the UI as sample data.
 *
 * EC-P7-04 — THE SAMPLE RESUME MUST NEVER BECOME THE DEFAULT.
 *
 * `createResume()` sets `isDefault: isFirst` (EC-P1-21), which is right for a
 * real upload and catastrophic here: the sample would be the first resume, so
 * it becomes the default, and then P4 scores the user's real jobs against
 * Jordan Lee's fabricated career. The scores would be meaningless and would
 * look exactly like scores.
 *
 * So this file does NOT call `createResume()`. It writes the row directly with
 * `isDefault: false` and `kind: "sample"`, and `clearSampleData()` removes
 * everything in one call. Sample data has to be as easy to delete as it was to
 * create, or it stops being a demonstration and becomes clutter the user cannot
 * distinguish from their own work.
 * ═════════════════════════════════════════════════════════════════════════
 */

import { log } from "@/lib/obs/logger";
import { prisma } from "../client";
import { SAMPLE_JOBS, SAMPLE_RESUME_PROFILE, SAMPLE_RESUME_TEXT } from "@/lib/onboarding/fixtures";

/** The marker on every seeded row. One string, checked in one place. */
export const SAMPLE_MARKER = "sample";

export interface OnboardingState {
  /** True when the account has nothing of its own yet. */
  isNew: boolean;
  hasSampleData: boolean;
}

/**
 * Has this user done anything yet?
 *
 * `isNew` deliberately ignores sample rows — a user who loaded the sample and
 * nothing else is still new, and should still be offered the real first step.
 */
export async function onboardingState(userId: string): Promise<OnboardingState> {
  const [realResumes, realJobs, sampleJobs] = await Promise.all([
    prisma.resume.count({ where: { userId, kind: { not: SAMPLE_MARKER } } }),
    prisma.job.count({ where: { userId, source: { not: SAMPLE_MARKER } } }),
    prisma.job.count({ where: { userId, source: SAMPLE_MARKER } }),
  ]);

  return {
    isNew: realResumes === 0 && realJobs === 0,
    hasSampleData: sampleJobs > 0,
  };
}

/**
 * Seed the sample resume and a handful of sample jobs.
 *
 * Idempotent: called twice, it does nothing the second time. The button that
 * triggers this is on an empty state, which is exactly the kind of screen
 * people double-click.
 */
export async function seedSampleData(userId: string): Promise<{ jobs: number }> {
  const existing = await prisma.job.count({
    where: { userId, source: SAMPLE_MARKER },
  });
  if (existing > 0) return { jobs: existing };

  const run = await prisma.harvestRun.create({
    data: {
      userId,
      roleQuery: "Senior Backend Engineer (sample)",
      location: "Remote",
      boards: [SAMPLE_MARKER],
      status: "complete",
      startedAt: new Date(),
      finishedAt: new Date(),
      // Honest about what this was. A sample run that claims a board succeeded
      // would put a fabricated data point in the one record the user is meant
      // to be able to trust (§18's board_results).
      boardResults: { [SAMPLE_MARKER]: { status: "ok", count: SAMPLE_JOBS.length, reason: null } },
    },
  });

  await prisma.$transaction([
    // The resume, written directly rather than through createResume() so that
    // `isDefault` is FALSE. See the header — this is the EC-P7-04 line.
    prisma.resume.create({
      data: {
        userId,
        version: 0,                 // version 0: outside the user's own series
        kind: SAMPLE_MARKER,
        profile: SAMPLE_RESUME_PROFILE,
        rawText: SAMPLE_RESUME_TEXT,
        originalFilename: "sample-resume.txt",
        isDefault: false,           // ← EC-P7-04
      },
    }),
    ...SAMPLE_JOBS.map((job) =>
      prisma.job.create({
        data: {
          userId,
          harvestRunId: run.id,
          source: SAMPLE_MARKER,
          title: job.title,
          company: job.company,
          location: job.location,
          link: job.link,
          dedupeKey: `${SAMPLE_MARKER}|${job.company}|${job.title}`.toLowerCase(),
          hydrationStatus: "hydrated",
          jobDescription: {
            create: { rawText: job.description, extractionMethod: SAMPLE_MARKER, profile: job.profile },
          },
        },
      }),
    ),
  ]);

  log.info("onboarding.sample_seeded", { userId, outcome: "ok", count: SAMPLE_JOBS.length });
  return { jobs: SAMPLE_JOBS.length };
}

/**
 * Remove every sample row.
 *
 * The jobs go via their harvest run, so the cascade takes the descriptions,
 * applications, and any scores the user generated against them — leaving no
 * fragment that would keep appearing in a tracker after the user asked for the
 * sample to go away.
 */
export async function clearSampleData(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.harvestRun.deleteMany({ where: { userId, boards: { has: SAMPLE_MARKER } } }),
    prisma.resume.deleteMany({ where: { userId, kind: SAMPLE_MARKER } }),
  ]);
  log.info("onboarding.sample_cleared", { userId, outcome: "ok" });
}
