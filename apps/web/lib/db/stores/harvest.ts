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
