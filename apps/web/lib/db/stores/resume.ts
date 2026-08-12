/**
 * Resume library persistence (P1.2, FR3).
 *
 * Everything the single-user app could not get wrong is now a race, because two
 * browser tabs are enough to trigger it. EC-P1-19, -20, -21 and -25 are all the
 * same shape: "read current state, then write" without a transaction.
 */

import type { Prisma } from "@prisma/client";

import { prisma } from "../client";
import { objectStore, newObjectKey } from "@/lib/storage/object-store";

export interface CreateResumeInput {
  userId: string;
  profile: unknown;
  /** EC-P1-08 / P1.2.3 — never discarded. Every re-parse depends on it. */
  rawText: string;
  originalFilename?: string | null;
  /** Present only for uploads; a pasted resume has no file. */
  file?: { buffer: Buffer; contentType: string; ext: string } | null;
}

function toJson(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}

/**
 * Create the next resume version.
 *
 * EC-P1-19 — `MAX(version) + 1` computed outside a transaction lets two
 * concurrent uploads pick the same number and collide on (user_id, version).
 * The whole read-then-write happens inside one transaction, and the caller
 * retries on the unique violation.
 *
 * EC-P1-21 — the FIRST resume becomes the default automatically. Otherwise a
 * user has resumes but no default, and batch scoring (P4) has nothing to score.
 *
 * EC-P1-25 — DB row FIRST, then the object. A failed upload leaves a row whose
 * fileKey is null, which a reaper can find. The reverse order leaks storage
 * forever with nothing pointing at it.
 */
export async function createResume(input: CreateResumeInput) {
  const { userId, profile, rawText, originalFilename = null, file = null } = input;

  const created = await prisma.$transaction(async (tx) => {
    const last = await tx.resume.findFirst({
      where: { userId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = (last?.version ?? 0) + 1;
    const isFirst = last === undefined || last === null;

    return tx.resume.create({
      data: {
        userId,
        version,
        kind: "master",
        profile: toJson(profile),
        rawText,
        originalFilename,
        isDefault: isFirst,   // EC-P1-21
      },
    });
  });

  // Object AFTER the row (EC-P1-25). If this throws, the row survives with a
  // null fileKey rather than an orphaned object surviving with no row.
  if (file) {
    const key = newObjectKey(userId, "resume", file.ext);
    await objectStore().put(key, file.buffer, file.contentType);
    return prisma.resume.update({ where: { id: created.id }, data: { fileKey: key } });
  }

  return created;
}

/**
 * EC-P1-20 — unset-then-set in ONE transaction. Two tabs doing this at once
 * must not both land on is_default = true; the partial unique index
 * `one_default_resume_per_user` turns that into a violation, and the
 * transaction turns the violation into a retry rather than a corrupt state.
 *
 * Tenant-scoped: another user's id resolves to null, so the route 404s.
 */
export async function setDefaultResume(id: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const target = await tx.resume.findFirst({ where: { id, userId } });
    if (!target) return null;

    await tx.resume.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });
    return tx.resume.update({ where: { id }, data: { isDefault: true } });
  });
}

export async function listResumes(userId: string) {
  return prisma.resume.findMany({
    where: { userId },
    orderBy: { version: "desc" },
    select: {
      id: true, version: true, kind: true, isDefault: true,
      originalFilename: true, fileKey: true, createdAt: true,
    },
  });
}

export async function getResume(id: string, userId: string) {
  return prisma.resume.findFirst({ where: { id, userId } });
}

export async function getDefaultResume(userId: string) {
  return prisma.resume.findFirst({ where: { userId, isDefault: true } });
}

export interface DeleteResult {
  ok: boolean;
  reason?: "not_found" | "referenced" | "would_leave_no_default";
}

/**
 * EC-P1-22 — refuse to delete the default while others exist, rather than
 * leaving a user with resumes and no default.
 *
 * EC-P1-23 — a resume referenced by an application is protected by ON DELETE
 * RESTRICT at the database level. FR3's whole point is answering "which resume
 * did I actually send to this company?", so this is reported as a refusal with
 * a reason rather than surfacing a raw FK error.
 */
export async function deleteResume(id: string, userId: string): Promise<DeleteResult> {
  const target = await prisma.resume.findFirst({ where: { id, userId } });
  if (!target) return { ok: false, reason: "not_found" };

  if (target.isDefault) {
    const others = await prisma.resume.count({ where: { userId, id: { not: id } } });
    if (others > 0) return { ok: false, reason: "would_leave_no_default" };
  }

  try {
    await prisma.resume.delete({ where: { id } });
  } catch {
    // RESTRICT from applications.resume_id.
    return { ok: false, reason: "referenced" };
  }

  // EC-P1-24 — drop the object too, or deletion leaks storage. Best-effort:
  // a failure here must not resurrect the row.
  if (target.fileKey) {
    await objectStore().delete(target.fileKey).catch(() => {});
  }
  return { ok: true };
}
