/**
 * Drains the object-deletion worklist (P7.4.5, EC-P7-25).
 *
 * `deleteAccount()` deletes the objects inline and only leaves rows behind when
 * storage was unreachable at that moment. This is the retry: run it on a
 * schedule so a transient S3 outage during a deletion does not become permanent
 * orphaned storage.
 *
 * Orphaned resume PDFs after a deletion request are a compliance problem, not a
 * cleanup task — which is why this is a scheduled job rather than something
 * somebody remembers to do.
 *
 *   node --env-file=.env scripts/reap-deletions.mjs
 *
 * Exits 0 even when items remain: those are retried on the next run, and a
 * non-zero exit would page someone for a condition the next tick resolves.
 * Exits 1 only when a key has failed enough times to need a human.
 */

import { PrismaClient } from "@prisma/client";

/** After this many attempts, a key is not going to succeed on its own. */
const STUCK_AFTER = 10;

const prisma = new PrismaClient();

const before = await prisma.pendingObjectDeletion.count();
if (before === 0) {
  console.log("Nothing pending.");
  await prisma.$disconnect();
  process.exit(0);
}

// Imported through the app's module graph so the driver selection
// (STORAGE_DRIVER) and the retry accounting stay in one implementation. A
// second copy of "delete an object and clear its row" is a second place for the
// two stores to disagree.
const { drainPendingDeletions } = await import(
  "../apps/web/lib/db/stores/account-deletion.ts"
);

const deleted = await drainPendingDeletions();
const remaining = await prisma.pendingObjectDeletion.count();

console.log(`Pending: ${before}   Deleted: ${deleted}   Remaining: ${remaining}`);

const stuck = await prisma.pendingObjectDeletion.findMany({
  where: { attempts: { gte: STUCK_AFTER } },
  select: { userId: true, attempts: true, lastError: true },
});

if (stuck.length > 0) {
  console.error(`\n${stuck.length} key(s) stuck after ${STUCK_AFTER}+ attempts:`);
  for (const row of stuck) {
    // The user id and the error. Never the key — an object key contains the
    // user id and a filename shape, and this output goes to a scheduler's log.
    console.error(`  user=${row.userId} attempts=${row.attempts} last=${row.lastError}`);
  }
  console.error("\nThese need a human: a deleted bucket, a permissions change, or a malformed key.");
}

await prisma.$disconnect();
process.exit(stuck.length > 0 ? 1 : 0);
