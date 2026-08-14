/**
 * Harvest + job reads/writes, tenant-scoped (P2.3).
 *
 * The routes must not touch the Prisma client directly — invariant 5 says every
 * tenant-scoped read is filtered by user_id, and funnelling access through here
 * leaves one file to audit for that. The P0.3.4 lint rule enforces it, and it
 * caught all four Phase 2 routes.
 */

import type { Prisma } from "@prisma/client";

import { prisma } from "../client";
import { advanceApplicationStatus } from "./tracker";

export async function createHarvestRun(input: {
  userId: string; role: string; location: string | null; boards: string[];
}) {
  return prisma.harvestRun.create({
    data: {
      userId: input.userId,
      roleQuery: input.role,
      location: input.location,
      boards: input.boards,
      status: "queued",
    },
  });
}

/**
 * Close out a run that was recorded but never queued (P7.2.4, EC-P7-12).
 *
 * The route writes the run row first, then enqueues. If the enqueue fails —
 * Redis unreachable — the row is left `queued` with nothing in existence that
 * will ever pick it up. To the tracker that is a job in progress, so the retry
 * UI correctly refuses to offer a retry for a non-terminal run, and the user
 * watches a spinner for a run that cannot advance.
 *
 * Moving it to `failed` with a stated reason makes it terminal, which is what
 * makes it retryable. The ordering (row first, then queue) stays as it was: it
 * is the EC-P1-25 pattern, and a row with no job is recoverable, while a job
 * with no row is not.
 */
export async function failUnqueuedRun(id: string, reason: string) {
  return prisma.harvestRun.updateMany({
    where: { id, status: "queued" },
    data: {
      status: "failed",
      finishedAt: new Date(),
      boardResults: [{ board: "all", status: "failed", reason }],
    },
  });
}

/**
 * Re-open a finished run for a retry of specific boards (P7.2.1, EC-P7-13).
 *
 * The failed boards' entries are CLEARED rather than left in place, so the UI
 * shows them as "waiting" again instead of displaying a stale failure next to a
 * spinner. Successful boards keep their results untouched — that is the whole
 * point of retrying a subset.
 *
 * `finishedAt` is nulled because the run is live again; leaving it set would
 * make a running job look terminal to EC-P7-12's check, which would let a
 * second retry start on top of this one.
 */
export async function reopenRunForRetry(
  id: string,
  userId: string,
  boards: string[],
  attempt: number,
) {
  const run = await prisma.harvestRun.findFirst({
    where: { id, userId },
    select: { boardResults: true },
  });
  if (!run) return null;

  const results = {
    ...((run.boardResults as Record<string, Prisma.InputJsonValue>) ?? {}),
  };
  for (const board of boards) delete results[board];

  return prisma.harvestRun.update({
    where: { id },
    data: {
      status: "running",
      finishedAt: null,
      retryCount: attempt,
      boardResults: results,
    },
  });
}

/** EC-P1-26: a foreign id resolves to null, so the route 404s rather than 403s. */
export async function getHarvestRun(id: string, userId: string) {
  const run = await prisma.harvestRun.findFirst({
    where: { id, userId },
    select: {
      id: true, roleQuery: true, location: true, boards: true,
      status: true, boardResults: true, startedAt: true, finishedAt: true,
      retryCount: true,
    },
  });
  if (!run) return null;
  const jobCount = await prisma.job.count({ where: { userId, harvestRunId: id } });
  return { ...run, jobCount };
}

/**
 * The ranked board (P4.3.2).
 *
 * EC-P4-27 — unscored jobs sort LAST, never as zero. Treating "not evaluated"
 * as a zero score buries a job the user simply has not scored yet.
 *
 * EC-P4-20 — `scoredResumeId` comes back so the UI can say "scored against v2,
 * current is v3". A stale score that looks current makes the ranking a lie.
 */
export async function listJobs(userId: string, runId?: string | null) {
  const jobs = await prisma.job.findMany({
    where: { userId, ...(runId ? { harvestRunId: runId } : {}) },
    take: 200,
    select: {
      id: true, source: true, title: true, company: true, location: true,
      link: true, postedAt: true, postedAtParsed: true,
      hydrationStatus: true, createdAt: true,
      applications: {
        where: { userId },
        select: {
          originalScore: true, tailoredScore: true, status: true, resumeId: true,
          tailoringRuns: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { tier: true, matchScore: true },
          },
        },
        take: 1,
      },
    },
  });

  const defaultResume = await prisma.resume.findFirst({
    where: { userId, isDefault: true }, select: { id: true, version: true },
  });

  return jobs
    .map((j) => {
      const app = j.applications[0];
      const run = app?.tailoringRuns[0];
      const ms = run?.matchScore as Record<string, unknown> | undefined;
      return {
        id: j.id, source: j.source, title: j.title, company: j.company,
        location: j.location, link: j.link, postedAt: j.postedAt,
        hydrationStatus: j.hydrationStatus,
        score: app?.originalScore ?? null,
        tailoredScore: app?.tailoredScore ?? null,
        tier: run?.tier ?? null,
        explanation: typeof ms?.explanation === "string" ? ms.explanation : null,
        skillCoverage: typeof ms?.skillCoverageScore === "number"
          ? ms.skillCoverageScore
          : typeof ms?.skillCoveragePct === "number" ? ms.skillCoveragePct : null,
        // EC-P4-20: true when the score predates the current default resume.
        scoreIsStale: Boolean(
          app?.resumeId && defaultResume && app.resumeId !== defaultResume.id,
        ),
      };
    })
    .sort((a, b) => {
      // Scored first, by score desc. Unscored keep recency order, last.
      if (a.score === null && b.score === null) return 0;
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      return b.score - a.score;
    });
}

/**
 * Mark selected jobs as queued for hydration and return the ids that are
 * actually the caller's (P3.3.1).
 *
 * Tenant-scoped by construction: ids belonging to another user are simply not
 * returned, so a crafted request cannot queue work against someone else's rows.
 * Already-hydrated jobs are skipped — re-fetching a page we already have is
 * exactly what FR2's "fetched once, ever" forbids.
 */
export async function markJobsQueued(jobIds: string[], userId: string): Promise<string[]> {
  const owned = await prisma.job.findMany({
    where: { id: { in: jobIds }, userId, hydrationStatus: { not: "hydrated" } },
    select: { id: true },
  });
  return owned.map((j) => j.id);
}

/**
 * Persist a manually pasted job description (P3.3.4).
 *
 * EC-P3-37 — this sets `hydrated`, and the hydrate handler checks that status
 * before doing anything. That is what makes the paste WIN a race against an
 * in-flight background fetch: losing text a human typed to a scraper is the
 * worst outcome this fallback can produce.
 *
 * EC-P3-05 — deliberately does NOT write jd_cache.
 */
export async function saveManualJd(
  jobId: string,
  userId: string,
  rawText: string,
  /**
   * The structured profile extracted from `rawText`.
   *
   * This used to always write `{}`, which made a pasted description a
   * SECOND-CLASS JobDescription: the row existed and the job flipped to
   * `hydrated`, but nothing downstream could read it. Requirements never
   * rendered; `coverage()` over an empty `requiredSkills` returns 100% by its
   * own empty-input rule, so scores were inflated; and `topMatchedSkills` came
   * out empty, which silently degraded every outreach email built from a
   * pasted job to the generic template.
   *
   * FR2's promise is that a paste is EQUIVALENT to a fetch, not a consolation
   * prize — and equivalent means the same shape. The caller extracts a profile
   * the same way the hydrate handler does and passes it here.
   *
   * Optional because extraction can fail (no LLM key, a rate limit), and a
   * failed extraction must still keep the user's text. An empty profile is
   * then honestly empty rather than silently wrong: the raw text survives and
   * can be re-parsed later.
   */
  profile?: unknown,
) {
  const job = await prisma.job.findFirst({ where: { id: jobId, userId }, select: { id: true } });
  if (!job) return null;

  const stored = JSON.parse(JSON.stringify(profile ?? {}));

  return prisma.$transaction(async (tx) => {
    await tx.jobDescription.upsert({
      where: { jobId },
      update: {
        rawText,
        extractionMethod: "manual_paste",
        profile: stored,
        extractedAt: new Date(),
      },
      create: {
        jobId,
        rawText,
        extractionMethod: "manual_paste",
        profile: stored,
        extractedAt: new Date(),
      },
    });
    return tx.job.update({
      where: { id: jobId },
      data: { hydrationStatus: "hydrated" },
    });
  });
}

/** Job detail with its hydrated description, tenant-scoped (P3.3.3). */
export async function getJobWithDescription(id: string, userId: string) {
  return prisma.job.findFirst({
    where: { id, userId },
    select: {
      id: true, source: true, title: true, company: true, location: true,
      link: true, postedAt: true, hydrationStatus: true, createdAt: true,
      jobDescription: {
        select: { rawText: true, extractionMethod: true, profile: true, extractedAt: true },
      },
    },
  });
}

/** EC-P4-22 — scoring needs hydrated JDs; count before queueing a run. */
export async function countHydratedJobs(userId: string, runId?: string | null) {
  return prisma.job.count({
    where: { userId, hydrationStatus: "hydrated", ...(runId ? { harvestRunId: runId } : {}) },
  });
}

/**
 * Record a completed Tier-2 run against its application (P4.4.3).
 *
 * EC-P4-31 — called only after the chain succeeded AND guardrails ran. Setting
 * `tailored` optimistically before the run completes leaves a status claiming
 * work that never happened.
 *
 * EC-P4-30 — `tailoredScore` is stored as-is even when it is LOWER than the
 * original. An honest regression is information; a hidden one is a broken
 * promise about explainability.
 */
export async function finaliseTailoredScore(input: {
  userId: string; jobId: string; resumeId: string; runId: string;
  originalScore: number; tailoredScore: number;
}) {
  const app = await prisma.application.upsert({
    where: { userId_jobId: { userId: input.userId, jobId: input.jobId } },
    /**
     * EC-P6-02 — the UPDATE branch must NOT set status.
     *
     * It used to write `status: "tailored"` unconditionally, so re-tailoring an
     * application that had already reached `emailed` dragged it backwards, and
     * a manual `rejected` was erased outright (EC-P6-01). The edge case names
     * this exact scenario, and it happened on real data during the Phase 6
     * audit: an emailed application showed as `tailored` again after a second
     * tailoring run.
     *
     * Re-tailoring updates the scores and the active run — which is the point
     * of doing it — and leaves the funnel position to
     * `advanceApplicationStatus` below, which only ever moves forward.
     */
    update: {
      originalScore: input.originalScore,
      tailoredScore: input.tailoredScore,
      resumeId: input.resumeId,
      activeTailoringRunId: input.runId,
    },
    create: {
      userId: input.userId, jobId: input.jobId,
      status: "tailored",
      originalScore: input.originalScore,
      tailoredScore: input.tailoredScore,
      resumeId: input.resumeId,
      activeTailoringRunId: input.runId,
    },
  });

  // Advance the funnel through the one writer that knows the rules: forward
  // only, and never over a status a human set deliberately (EC-P6-01/02).
  await advanceApplicationStatus(app.id, input.userId, "tailored");

  // The run was created by the orchestrator store without an application (a
  // Phase 1 standalone run); attach it now that one exists.
  await prisma.tailoringRun.updateMany({
    where: { id: input.runId, userId: input.userId },
    data: { applicationId: app.id, resumeId: input.resumeId, tier: "full" },
  });

  return app;
}
