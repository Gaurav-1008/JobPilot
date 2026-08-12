/**
 * Safety test 10 (architecture.md §19) — P1.5.2.
 *
 * "Cross-tenant read of another user's application → 404."
 *
 * Standing invariant 5: every tenant-scoped read is filtered by user_id, and a
 * miss is a DATA LEAK, not a bug. This suite asserts the filter is actually in
 * the query, so forgetting it fails the build rather than shipping.
 *
 * EC-P1-26: reads return null (-> 404), never throw a 403. For tenant-scoped
 * rows, "not yours" and "does not exist" must be indistinguishable — a 403
 * confirms the id exists, which is an enumeration oracle.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  lastWhere: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    tailoringRun: {
      findFirst: async ({ where, select: _select }: { where: Record<string, unknown>; select?: unknown }) => {
        db.lastWhere = where;
        return (
          db.rows.find(
            (r) => r.id === where.id && r.userId === where.userId,
          ) ?? null
        );
      },
      deleteMany: async () => ({ count: 0 }),
      findMany: async () => [],
      upsert: async () => ({}),
    },
  },
}));

import { getRun } from "@/lib/db/stores/tailoring-run";

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RUN_ID = "11111111-1111-4111-8111-111111111111";

describe("tenant isolation (safety test 10)", () => {
  beforeEach(() => {
    db.lastWhere = undefined;
    db.rows = [
      { id: RUN_ID, userId: ALICE, tailoredResume: { id: RUN_ID, owner: "alice" } },
    ];
  });

  it("the owner can read their own run", async () => {
    const run = await getRun(RUN_ID, ALICE);
    expect(run).not.toBeNull();
  });

  it("another user reading the SAME valid id gets null, not the row", async () => {
    const run = await getRun(RUN_ID, BOB);
    // null is what makes the route return 404 rather than 403.
    expect(run).toBeNull();
  });

  it("the query carries a user_id filter — the actual leak-preventing detail", async () => {
    await getRun(RUN_ID, BOB);
    // Asserting on the WHERE clause, not just the result: a future refactor
    // that drops the filter but still happens to return null for missing ids
    // would pass the test above and leak in production.
    expect(db.lastWhere).toMatchObject({ id: RUN_ID, userId: BOB });
  });

  it("never throws for a foreign id — a thrown 403 would confirm existence", async () => {
    await expect(getRun(RUN_ID, BOB)).resolves.toBeNull();
  });
});
