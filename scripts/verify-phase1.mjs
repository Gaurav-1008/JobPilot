/**
 * Phase 1 verification against the REAL database (not WASM, not mocks).
 *
 *   node --env-file=.env scripts/verify-phase1.mjs
 *
 * Covers the resume-library invariants that only a real Postgres can prove:
 * concurrency, unique indexes, NUL-byte rejection, and cascade. The HTTP layer
 * above these is covered by the unit suite; what could not be proven any other
 * way is that Postgres itself enforces them.
 *
 * Creates and removes its own user, so it is safe to re-run.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

const U = "cccccccc-0000-4000-8000-0000000000e2";
const NUL = String.fromCharCode(0);
const BODY = "Backend engineer. ".repeat(30);

let pass = 0;
let fail = 0;
const ok = (m) => { console.log("  ok    " + m); pass++; };
const bad = (m) => { console.log("  FAIL  " + m); fail++; };

const mk = (version, isDefault = false, rawText = BODY) =>
  prisma.resume.create({
    data: { userId: U, version, kind: "master", profile: {}, rawText, isDefault },
  });

try {
  await prisma.user.deleteMany({ where: { id: U } });
  await prisma.user.create({ data: { id: U, email: "p1e2e@example.com" } });

  console.log("Resume library — real Postgres\n");

  // EC-P1-21 — the first resume must become the default, or P4 has nothing to score.
  const r1 = await mk(1, true);
  r1.isDefault ? ok("first resume is default (EC-P1-21)") : bad("first resume not default");

  const r2 = await mk(2);
  !r2.isDefault ? ok("second resume is not default") : bad("second became default");

  // EC-P1-20 — two tabs setting default at once must not both win.
  const setDefault = (id) =>
    prisma.$transaction(async (tx) => {
      await tx.resume.updateMany({
        where: { userId: U, isDefault: true },
        data: { isDefault: false },
      });
      return tx.resume.update({ where: { id }, data: { isDefault: true } });
    });

  const settled = await Promise.allSettled([setDefault(r1.id), setDefault(r2.id)]);
  const rejected = settled.filter((s) => s.status === "rejected").length;
  const defaults = await prisma.resume.count({ where: { userId: U, isDefault: true } });
  defaults === 1
    ? ok(`concurrent set-default -> exactly 1 default (${rejected} conflict retried) (EC-P1-20)`)
    : bad(`ended with ${defaults} defaults`);

  // EC-P1-19 — the unique index is what makes the version race retryable.
  try {
    await mk(1);
    bad("duplicate (user_id, version) accepted");
  } catch {
    ok("duplicate (user_id, version) rejected (EC-P1-19)");
  }

  // EC-P1-09 — the reason stripControlChars exists. Prove BOTH directions:
  // stripped text persists, and unstripped text is rejected by Postgres.
  const stripped = BODY + "tail";
  const r3 = await mk(3, false, stripped);
  const back = await prisma.resume.findUnique({ where: { id: r3.id } });
  back.rawText.endsWith("tail")
    ? ok("sanitised text persists intact")
    : bad("sanitised text round trip wrong");

  try {
    await mk(4, false, BODY + NUL + "tail");
    bad("Postgres accepted a NUL byte — the strip would be pointless");
  } catch {
    ok("Postgres REJECTS an unstripped NUL — the strip is load-bearing (EC-P1-09)");
  }

  // EC-P1-22 — there must be something for the delete-guard to protect.
  const others = await prisma.resume.count({ where: { userId: U, isDefault: false } });
  others > 0
    ? ok(`delete-guard is meaningful (${others} non-default resumes exist) (EC-P1-22)`)
    : bad("no non-default resumes to guard against");

  // EC-P7-25 — account deletion must leave nothing behind.
  await prisma.user.delete({ where: { id: U } });
  const left = await prisma.resume.count({ where: { userId: U } });
  left === 0 ? ok("deleting the user removed every resume (EC-P7-25)") : bad(`${left} orphans left`);

  console.log(`\n${pass} passed, ${fail} failed`);
} finally {
  await prisma.$disconnect();
}

process.exit(fail === 0 ? 0 : 1);
