/**
 * Account deletion (P7.4.5, EC-P7-24/25/26).
 *
 * ═════════════════════════════════════════════════════════════════════════
 * DELETION IS A DISTRIBUTED TRANSACTION NOBODY PLANNED FOR.
 *
 * The user's data lives in Postgres, in object storage, and — while a job is in
 * flight — in a Redis payload. `ON DELETE CASCADE` covers one of those three.
 * The other two have to be enumerated deliberately, which is what this file is.
 *
 * ORDERING (EC-P7-25). Three options, and only one is defensible:
 *
 *   cascade → delete objects   orphans every file if storage cleanup fails
 *                              partway, AND destroys the only record of which
 *                              keys existed. You cannot even enumerate the
 *                              damage afterwards.
 *   delete objects → cascade   a failure after the objects are gone leaves a
 *                              LIVE user with no resume files.
 *   record keys + cascade      → then drain. A crash anywhere leaves a durable
 *                              worklist. This is the one we take.
 *
 * The insert and the cascade share a transaction, so either both happened or
 * neither did. Storage deletion afterwards is idempotent and retryable, and
 * whatever fails stays on the worklist for the reaper.
 *
 * WHERE THE KEYS ACTUALLY ARE. Two places, and the second is the trap:
 *
 *   resumes.file_key             directly on the user. Obvious.
 *   exported_documents.file_key  NO user_id column. It hangs off
 *                                tailoring_runs, which hangs off the user.
 *
 * A collector written from the ER diagram at a glance finds the first and
 * misses the second, and every tailored-resume PDF the user ever exported stays
 * in the bucket. The cascade removes the rows perfectly, so nothing looks
 * wrong. That is EC-P7-25 in one sentence.
 * ═════════════════════════════════════════════════════════════════════════
 */

import { log } from "@/lib/obs/logger";
import { objectStore } from "@/lib/storage/object-store";
import { prisma } from "../client";

export interface DeletionResult {
  /** Object keys found and recorded before the cascade. */
  objectsFound: number;
  /** Objects successfully removed from storage during this call. */
  objectsDeleted: number;
  /** Left on the worklist for the reaper. Non-zero is not a failure. */
  objectsPending: number;
}

/**
 * Every object-storage key belonging to a user.
 *
 * Exported so a test can assert the enumeration directly. If a future model
 * grows a `file_key`, this function is the one place that has to learn about
 * it — and the test that counts keys is what fails when it does not.
 */
export async function collectObjectKeys(userId: string): Promise<string[]> {
  const [resumes, exports] = await Promise.all([
    prisma.resume.findMany({
      where: { userId, fileKey: { not: null } },
      select: { fileKey: true },
    }),
    // The one that is easy to miss: reached through the tailoring run, because
    // exported_documents has no user_id of its own.
    prisma.exportedDocument.findMany({
      where: { tailoringRun: { userId } },
      select: { fileKey: true },
    }),
  ]);

  const keys = [
    ...resumes.map((r) => r.fileKey),
    ...exports.map((e) => e.fileKey),
  ].filter((k): k is string => Boolean(k));

  // The same key can legitimately appear twice — a resume file reused across
  // rows — and the worklist has a unique index on object_key.
  return [...new Set(keys)];
}

/**
 * Delete the account. Rows go via cascade; objects go via the worklist.
 *
 * Returns counts rather than throwing on partial storage failure: the ROW
 * deletion is what the user asked for and it has succeeded by the time this
 * returns. Reporting "deletion failed" because one S3 call timed out would
 * invite a retry of an operation that is already done, against a user that no
 * longer exists.
 */
export async function deleteAccount(userId: string): Promise<DeletionResult> {
  const keys = await collectObjectKeys(userId);

  // ── Atomic half: record the worklist and drop every row. ──
  await prisma.$transaction(async (tx) => {
    if (keys.length > 0) {
      await tx.pendingObjectDeletion.createMany({
        data: keys.map((objectKey) => ({ userId, objectKey })),
        // A key already queued by an earlier, half-finished attempt is fine.
        skipDuplicates: true,
      });
    }
    // Everything else cascades from here: resumes, runs, jobs, applications,
    // contacts, outreach attempts, credentials, opt-outs, review events.
    await tx.user.delete({ where: { id: userId } });
  });

  log.info("account.deleted", {
    userId,
    outcome: "ok",
    count: keys.length,
  });

  // ── Best-effort half: drain the worklist now, retry later if needed. ──
  const deleted = await drainPendingDeletions(userId);

  return {
    objectsFound: keys.length,
    objectsDeleted: deleted,
    objectsPending: keys.length - deleted,
  };
}

/**
 * Delete queued objects and clear their rows.
 *
 * Also the reaper: called with no `userId` it drains everything outstanding,
 * which is what a scheduled job wants.
 *
 * A failure per key is recorded and left on the list rather than thrown,
 * because one unreachable key must not stop the other ninety-nine.
 */
export async function drainPendingDeletions(
  userId?: string,
  limit = 500,
): Promise<number> {
  const pending = await prisma.pendingObjectDeletion.findMany({
    where: userId ? { userId } : {},
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const store = objectStore();
  let deleted = 0;

  for (const item of pending) {
    try {
      // Idempotent by contract — the fs driver swallows ENOENT, and S3 returns
      // success for a key that is already gone. Deleting twice is not an error,
      // which is what makes the whole retry design safe.
      await store.delete(item.objectKey);
      await prisma.pendingObjectDeletion.delete({ where: { id: item.id } });
      deleted += 1;
    } catch (err) {
      await prisma.pendingObjectDeletion.update({
        where: { id: item.id },
        data: {
          attempts: { increment: 1 },
          lastTriedAt: new Date(),
          lastError: err instanceof Error ? err.message.slice(0, 500) : String(err),
        },
      });
      log.warn("account.object_delete_failed", {
        outcome: "error",
        attempt: item.attempts + 1,
        name: err instanceof Error ? err.name : "Unknown",
      });
    }
  }

  return deleted;
}

/**
 * Does this user still exist? (EC-P7-24)
 *
 * Background jobs call this before writing. An account deleted mid-harvest is
 * not exotic — it is exactly what an angry user does, and the harvest they
 * started is still running with their id in a Redis payload. Without this the
 * job either writes rows for a user who no longer exists or dies on a missing
 * foreign key, and a crashed worker retries the same doomed job.
 *
 * A cheap existence check with no data, so it is safe to call between steps of
 * a long job rather than only at the start — which matters, because a harvest
 * takes minutes and the deletion can land at any point inside that window.
 */
export async function userExists(userId: string): Promise<boolean> {
  const hit = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  return hit !== null;
}

/**
 * What deletion destroys, for the confirmation screen (EC-P7-26).
 *
 * The outreach audit trail goes with everything else. That is correct — it is
 * the user's data and they asked — but it is worth stating, because the audit
 * trail is the record of who they contacted and when, and it is the thing
 * people wish they still had. Making it an informed choice is the whole
 * requirement; the deletion behaviour itself does not change.
 */
export const DELETION_CONSEQUENCES = [
  "Every resume version, tailoring run, and exported PDF.",
  "Every harvested job, score, and application in your tracker.",
  "Your outreach history — who you contacted, what you sent, and when. This is your audit trail, and it cannot be recovered afterwards.",
  "Your saved sending account and your opt-out list.",
] as const;
