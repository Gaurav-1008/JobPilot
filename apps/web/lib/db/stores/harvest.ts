/**
 * Harvest + job reads/writes, tenant-scoped (P2.3).
 *
 * The routes must not touch the Prisma client directly — invariant 5 says every
 * tenant-scoped read is filtered by user_id, and funnelling access through here
 * leaves one file to audit for that. The P0.3.4 lint rule enforces it, and it
 * caught all four Phase 2 routes.
 */

import { prisma } from "../client";

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

/** EC-P1-26: a foreign id resolves to null, so the route 404s rather than 403s. */
export async function getHarvestRun(id: string, userId: string) {
  const run = await prisma.harvestRun.findFirst({
    where: { id, userId },
    select: {
      id: true, roleQuery: true, location: true, boards: true,
      status: true, boardResults: true, startedAt: true, finishedAt: true,
    },
  });
  if (!run) return null;
  const jobCount = await prisma.job.count({ where: { userId, harvestRunId: id } });
  return { ...run, jobCount };
}

export async function listJobs(userId: string, runId?: string | null) {
  return prisma.job.findMany({
    where: { userId, ...(runId ? { harvestRunId: runId } : {}) },
    // EC-P4-27: unscored/undated rows sort LAST, never as zero.
    orderBy: [{ postedAtParsed: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: 200,
    select: {
      id: true, source: true, title: true, company: true, location: true,
      link: true, postedAt: true, hydrationStatus: true, createdAt: true,
    },
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
export async function saveManualJd(jobId: string, userId: string, rawText: string) {
  const job = await prisma.job.findFirst({ where: { id: jobId, userId }, select: { id: true } });
  if (!job) return null;

  return prisma.$transaction(async (tx) => {
    await tx.jobDescription.upsert({
      where: { jobId },
      update: { rawText, extractionMethod: "manual_paste", profile: {} },
      create: { jobId, rawText, extractionMethod: "manual_paste", profile: {} },
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
