/**
 * Account deletion removes every row and every stored object — P7.4.5.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A PHASE 7 ACCEPTANCE CRITERION, AND A COMPLIANCE PROPERTY.
 *
 * Exit checklist: "delete an account → zero remaining objects in storage for
 * that user". The interesting half is not the cascade — Postgres does that
 * correctly and has for decades — it is the object storage the cascade cannot
 * see, and the ORDER in which the two stores are touched.
 *
 * The specific trap (EC-P7-25) is `exported_documents`. That table has no
 * user_id; it hangs off tailoring_runs, which hangs off the user. A key
 * collector written by reading the ER diagram once finds `resumes.file_key` and
 * stops, and every tailored-resume PDF the user ever generated stays in the
 * bucket after their account is gone. Nothing looks wrong afterwards, because
 * the rows that would have named those keys were deleted perfectly.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** The world the fake Prisma reads from. */
const db = vi.hoisted(() => ({
  users: [] as { id: string }[],
  resumes: [] as { userId: string; fileKey: string | null }[],
  /** Reached only through tailoringRun.userId — the EC-P7-25 trap. */
  exports: [] as { userId: string; fileKey: string }[],
  pending: [] as { id: string; userId: string; objectKey: string; attempts: number }[],
  /** Set when the cascade ran, and with what. */
  deletedUsers: [] as string[],
  /** True while a transaction body is executing. */
  inTransaction: false,
  transactionOrder: [] as string[],
}));

let nextId = 0;

vi.mock("@/lib/db/client", () => ({
  prisma: {
    resume: {
      findMany: async ({ where }: { where: { userId: string } }) =>
        db.resumes.filter((r) => r.userId === where.userId && r.fileKey !== null),
    },
    exportedDocument: {
      findMany: async ({ where }: { where: { tailoringRun: { userId: string } } }) =>
        db.exports.filter((e) => e.userId === where.tailoringRun.userId),
    },
    user: {
      delete: async ({ where }: { where: { id: string } }) => {
        db.transactionOrder.push(`delete-user:${where.id}`);
        db.deletedUsers.push(where.id);
        db.users = db.users.filter((u) => u.id !== where.id);
        // The cascade, modelled: everything tenant-scoped goes with the user.
        db.resumes = db.resumes.filter((r) => r.userId !== where.id);
        db.exports = db.exports.filter((e) => e.userId !== where.id);
        return { id: where.id };
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        db.users.find((u) => u.id === where.id) ?? null,
    },
    pendingObjectDeletion: {
      createMany: async ({ data }: { data: { userId: string; objectKey: string }[] }) => {
        db.transactionOrder.push(`queue-keys:${data.length}`);
        for (const row of data) {
          if (db.pending.some((p) => p.objectKey === row.objectKey)) continue;
          db.pending.push({ id: `p${nextId++}`, attempts: 0, ...row });
        }
        return { count: data.length };
      },
      findMany: async ({ where }: { where?: { userId?: string } }) =>
        where?.userId ? db.pending.filter((p) => p.userId === where.userId) : db.pending,
      delete: async ({ where }: { where: { id: string } }) => {
        db.pending = db.pending.filter((p) => p.id !== where.id);
        return {};
      },
      update: async ({ where }: { where: { id: string } }) => {
        const row = db.pending.find((p) => p.id === where.id);
        if (row) row.attempts += 1;
        return {};
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      db.inTransaction = true;
      // Same object: the fake has no isolation to model, and the property under
      // test is ORDER, which the transactionOrder log captures.
      const { prisma } = await import("@/lib/db/client");
      const result = await fn(prisma);
      db.inTransaction = false;
      return result;
    },
  },
}));

/** Records what storage was asked to delete, and can be told to fail. */
const store = vi.hoisted(() => ({
  deleted: [] as string[],
  failOn: new Set<string>(),
}));

vi.mock("@/lib/storage/object-store", () => ({
  objectStore: () => ({
    put: async () => {},
    get: async () => Buffer.alloc(0),
    delete: async (key: string) => {
      if (store.failOn.has(key)) throw new Error("storage unavailable");
      store.deleted.push(key);
    },
  }),
}));

beforeEach(() => {
  nextId = 0;
  db.users = [{ id: ALICE }, { id: BOB }];
  db.resumes = [
    { userId: ALICE, fileKey: "resume/alice/one.pdf" },
    { userId: ALICE, fileKey: "resume/alice/two.docx" },
    // A resume with no uploaded file — pasted text only. Must not produce a
    // null key on the worklist.
    { userId: ALICE, fileKey: null },
    { userId: BOB, fileKey: "resume/bob/one.pdf" },
  ];
  db.exports = [
    { userId: ALICE, fileKey: "pdf/alice/tailored-v1.pdf" },
    { userId: ALICE, fileKey: "pdf/alice/tailored-v2.pdf" },
    { userId: BOB, fileKey: "pdf/bob/tailored-v1.pdf" },
  ];
  db.pending = [];
  db.deletedUsers = [];
  db.transactionOrder = [];
  store.deleted = [];
  store.failOn = new Set();
});

describe("EC-P7-25 — every key is found, including the ones with no user_id", () => {
  it("collects exported PDFs, which are reached only through tailoring runs", async () => {
    const { collectObjectKeys } = await import("@/lib/db/stores/account-deletion");
    const keys = await collectObjectKeys(ALICE);

    // The trap. A collector that reads the ER diagram once finds the resumes
    // and misses these two entirely.
    expect(keys).toContain("pdf/alice/tailored-v1.pdf");
    expect(keys).toContain("pdf/alice/tailored-v2.pdf");
    expect(keys).toContain("resume/alice/one.pdf");
    expect(keys).toContain("resume/alice/two.docx");
    expect(keys).toHaveLength(4);
  });

  it("does not collect another tenant's keys", async () => {
    const { collectObjectKeys } = await import("@/lib/db/stores/account-deletion");
    const keys = await collectObjectKeys(ALICE);
    expect(keys.some((k) => k.includes("bob"))).toBe(false);
  });

  it("skips resumes that have no stored file", async () => {
    const { collectObjectKeys } = await import("@/lib/db/stores/account-deletion");
    expect((await collectObjectKeys(ALICE)).every(Boolean)).toBe(true);
  });
});

describe("EC-P7-25 — the worklist is written before the cascade", () => {
  it("queues keys and deletes the user in one transaction, keys first", async () => {
    const { deleteAccount } = await import("@/lib/db/stores/account-deletion");
    await deleteAccount(ALICE);

    // Order is the property. Deleting rows first destroys the only record of
    // which keys existed — you cannot even enumerate the damage afterwards.
    expect(db.transactionOrder).toEqual(["queue-keys:4", `delete-user:${ALICE}`]);
  });

  it("removes every object for that user", async () => {
    const { deleteAccount } = await import("@/lib/db/stores/account-deletion");
    const result = await deleteAccount(ALICE);

    expect(result.objectsFound).toBe(4);
    expect(result.objectsDeleted).toBe(4);
    expect(result.objectsPending).toBe(0);
    expect(store.deleted.sort()).toEqual([
      "pdf/alice/tailored-v1.pdf",
      "pdf/alice/tailored-v2.pdf",
      "resume/alice/one.pdf",
      "resume/alice/two.docx",
    ]);
    // Exit checklist: zero remaining objects in storage for that user.
    expect(db.pending.filter((p) => p.userId === ALICE)).toHaveLength(0);
  });

  it("leaves the other tenant untouched", async () => {
    const { deleteAccount } = await import("@/lib/db/stores/account-deletion");
    await deleteAccount(ALICE);

    expect(db.users.map((u) => u.id)).toEqual([BOB]);
    expect(store.deleted.some((k) => k.includes("bob"))).toBe(false);
    expect(db.resumes.filter((r) => r.userId === BOB)).toHaveLength(1);
  });
});

describe("EC-P7-25 — a storage failure halfway leaves a replayable worklist", () => {
  it("keeps failed keys queued rather than losing them", async () => {
    store.failOn = new Set(["pdf/alice/tailored-v2.pdf"]);

    const { deleteAccount } = await import("@/lib/db/stores/account-deletion");
    const result = await deleteAccount(ALICE);

    // The rows are gone regardless — that is what the user asked for.
    expect(db.users.map((u) => u.id)).toEqual([BOB]);
    expect(result.objectsDeleted).toBe(3);
    expect(result.objectsPending).toBe(1);

    // And the orphan is still named, which is the whole point of the table.
    expect(db.pending.map((p) => p.objectKey)).toEqual(["pdf/alice/tailored-v2.pdf"]);
    expect(db.pending[0].attempts).toBe(1);
  });

  it("a reaper pass finishes the job once storage recovers", async () => {
    store.failOn = new Set(["pdf/alice/tailored-v2.pdf"]);
    const { deleteAccount, drainPendingDeletions } = await import(
      "@/lib/db/stores/account-deletion"
    );
    await deleteAccount(ALICE);

    store.failOn = new Set();
    const drained = await drainPendingDeletions();

    expect(drained).toBe(1);
    expect(db.pending).toHaveLength(0);
    expect(store.deleted).toContain("pdf/alice/tailored-v2.pdf");
  });
});

describe("EC-P7-24 — a job in flight can tell the account is gone", () => {
  it("reports the user as absent after deletion", async () => {
    const { deleteAccount, userExists } = await import("@/lib/db/stores/account-deletion");
    expect(await userExists(ALICE)).toBe(true);
    await deleteAccount(ALICE);
    expect(await userExists(ALICE)).toBe(false);
  });
});

describe("EC-P7-26 — the audit-trail trade is stated, not hidden", () => {
  it("names the outreach history as unrecoverable in the confirmation copy", async () => {
    const { DELETION_CONSEQUENCES } = await import("@/lib/db/stores/account-deletion");
    const text = DELETION_CONSEQUENCES.join(" ");
    // Deleting the audit trail is correct — it is the user's data and they
    // asked. The requirement is only that they know before they choose.
    expect(text).toMatch(/outreach/i);
    expect(text).toMatch(/audit trail/i);
    expect(text).toMatch(/cannot be recovered/i);
  });
});
