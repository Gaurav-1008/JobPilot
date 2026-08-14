/**
 * Follow-up selection rules (P6.2.1, P6.2.3).
 *
 * The companion to `safety/followup-cannot-send.test.ts`. That file proves the
 * sweep CANNOT send; this one proves it picks the right things to draft — a
 * separate claim, and the one that decides whether the review queue is useful
 * or is forty identical drafts nobody reads.
 *
 * Every case here is an edge case that produces a plausible-looking follow-up
 * to the wrong person, or the same person too often.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const APP = "11111111-1111-4111-8111-111111111111";
const CONTACT = "22222222-2222-4222-8222-222222222222";

const db = vi.hoisted(() => ({
  attempts: [] as Record<string, unknown>[],
  optOuts: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    outreachAttempt: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        // The parent query: sent, older than the cutoff, with both FKs set.
        if (where.status === "sent") {
          const cutoff = (where.createdAt as { lt: Date })?.lt;
          return db.attempts.filter(
            (a) =>
              a.userId === where.userId &&
              a.status === "sent" &&
              a.applicationId !== null &&
              a.contactId !== null &&
              (!cutoff || (a.createdAt as Date) < cutoff),
          );
        }
        // The sibling query, used for the pending / already-followed / depth rules.
        return db.attempts.filter(
          (a) => a.userId === where.userId && a.contactId === where.contactId,
        );
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        db.attempts.push({ ...data, id: `new-${db.attempts.length}` });
        return data;
      },
    },
    optOutEntry: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const wanted = (where.email as { in: string[] })?.in ?? [];
        return db.optOuts.find((o) => wanted.includes(o.email as string)) ?? null;
      },
    },
  },
}));

import { findSweepCandidates, MAX_FOLLOWUP_DEPTH } from "@/lib/db/stores/followups";

const NOW = new Date("2026-08-20T00:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function parent(overrides: Record<string, unknown> = {}) {
  return {
    id: "parent-1",
    userId: USER,
    applicationId: APP,
    contactId: CONTACT,
    status: "sent",
    subject: "Quick note on the AI Engineer role",
    bodySnapshot: "Hi Priya,\n\nI build retrieval systems.\n\nBest,\nGaurav",
    parentId: null,
    createdAt: daysAgo(10),
    contact: { recipientEmail: "priya@acme.com", recipientName: "Priya" },
    application: { status: "emailed", job: { company: "Acme", title: "AI Engineer" } },
    ...overrides,
  };
}

beforeEach(() => {
  db.attempts = [parent()];
  db.optOuts = [];
});

const sweep = () => findSweepCandidates({ userId: USER, days: 7, now: NOW });

describe("what gets a follow-up", () => {
  it("picks a sent attempt older than the window", async () => {
    const found = await sweep();
    expect(found).toHaveLength(1);
    expect(found[0].recipientEmail).toBe("priya@acme.com");
    expect(found[0].parentAttemptId).toBe("parent-1");
  });

  it("leaves a recent attempt alone", async () => {
    db.attempts = [parent({ createdAt: daysAgo(2) })];
    expect(await sweep()).toHaveLength(0);
  });
});

describe("what must NOT get a follow-up", () => {
  it("skips a DRAFTED attempt — a draft is not a sent email (EC-P6-11)", async () => {
    // The whole point: applications.status='emailed' is set when a Gmail draft
    // is created, and the user may never have sent it. Following up on that is
    // the most embarrassing thing this feature could do.
    db.attempts = [parent({ status: "drafted" })];
    expect(await sweep()).toHaveLength(0);
  });

  it("skips a failed or skipped attempt", async () => {
    for (const status of ["failed", "skipped", "generated"]) {
      db.attempts = [parent({ status })];
      expect(await sweep(), status).toHaveLength(0);
    }
  });

  it("skips a contact added to the opt-out list after the send (EC-P6-16)", async () => {
    // Checked at GENERATION, not only at the interlock: a draft addressed to
    // someone who opted out is a mis-click waiting to happen and should never
    // reach the review queue.
    db.optOuts = [{ email: "priya@acme.com" }];
    expect(await sweep()).toHaveLength(0);
  });

  it("skips a whole-domain opt-out", async () => {
    db.optOuts = [{ email: "@acme.com" }];
    expect(await sweep()).toHaveLength(0);
  });

  it("skips when a follow-up is already awaiting review (EC-P6-15)", async () => {
    // Without this, a daily sweep fills the queue with identical drafts until
    // the user clears them carelessly — worse than generating none.
    db.attempts.push({
      ...parent({ id: "pending", status: "generated", parentId: "parent-1" }),
    });
    expect(await sweep()).toHaveLength(0);
  });

  it("never follows up twice on the same parent (EC-P6-14)", async () => {
    // Cron overlap, or simply running the sweep twice in one day.
    //
    // The guarantee is narrower than "produces nothing": a follow-up that was
    // itself SENT is a legitimate parent for one more follow-up, up to the
    // depth cap. What must never happen is a SECOND follow-up to the same
    // parent — which is what a duplicate sweep would produce.
    db.attempts.push({
      ...parent({ id: "already", status: "sent", parentId: "parent-1" }),
    });

    const found = await sweep();
    expect(found.map((c) => c.parentAttemptId)).not.toContain("parent-1");
  });

  it("produces nothing at all when the existing follow-up is unsent", async () => {
    // The ordinary duplicate-sweep case: the earlier follow-up is still
    // awaiting review, so there is no new parent and nothing to add.
    db.attempts.push({
      ...parent({ id: "already", status: "generated", parentId: "parent-1" }),
    });
    expect(await sweep()).toHaveLength(0);
  });

  it("caps the chain depth (EC-P6-19)", async () => {
    for (let i = 0; i < MAX_FOLLOWUP_DEPTH; i += 1) {
      db.attempts.push({
        ...parent({ id: `chain-${i}`, status: "sent", parentId: `earlier-${i}` }),
      });
    }
    // Unbounded chains are indistinguishable from pestering.
    expect(await sweep()).toHaveLength(0);
  });

  it("stops once the user records an outcome", async () => {
    for (const status of ["replied", "interviewing", "rejected", "closed"]) {
      db.attempts = [parent({ application: { status, job: { company: "Acme", title: "AI Engineer" } } })];
      expect(await sweep(), status).toHaveLength(0);
    }
  });

  it("skips a legacy-imported parent with no body to quote (EC-P6-17)", async () => {
    // Rendering `null` into a follow-up is worse than not sending one.
    db.attempts = [parent({ bodySnapshot: null })];
    expect(await sweep()).toHaveLength(0);
  });

  it("skips orphans whose application or contact is gone (EC-P6-18)", async () => {
    db.attempts = [parent({ application: null })];
    expect(await sweep()).toHaveLength(0);
    db.attempts = [parent({ contact: null })];
    expect(await sweep()).toHaveLength(0);
  });
});

describe("volume", () => {
  it("never generates more than the caller's limit (EC-P6-21)", async () => {
    // Generating far more than can plausibly be sent creates a queue the user
    // clears carelessly, which defeats the review step.
    db.attempts = Array.from({ length: 20 }, (_, i) =>
      parent({ id: `p-${i}`, contactId: `c-${i}`, contact: { recipientEmail: `x${i}@acme.com`, recipientName: null } }),
    );
    const found = await findSweepCandidates({ userId: USER, days: 7, now: NOW, limit: 3 });
    expect(found).toHaveLength(3);
  });
});
