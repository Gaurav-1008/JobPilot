/**
 * The audit trail cannot stay silent — P5.4.8 / EC-P5-57.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS SEPARATELY FROM outreach-interlocks.test.ts
 *
 * That suite proves the CHAIN refuses. This one proves the REFUSAL IS
 * RECORDED, which is a different claim and a genuinely separate failure mode:
 * `runInterlocks` can return a perfect block while the route forgets to write
 * the row, and every interlock test would still pass.
 *
 * EC-P5-57 is explicit that a block leaving no trace is unauditable and
 * indistinguishable from a bug. FR11's proof artifact is only as honest as this
 * table, so "it was blocked" must be a fact on disk, naming the check that
 * refused — not a 422 that vanishes when the tab closes.
 *
 * These tests drive the real route handler, so they also pin the ORDER that
 * matters: interlocks → burn → provider. A route that burned the token first,
 * or called ④ before the chain, would fail here.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ATTEMPT = "11111111-1111-4111-8111-111111111111";
const CONTACT = "22222222-2222-4222-8222-222222222222";
const APPLICATION = "33333333-3333-4333-8333-333333333333";

const db = vi.hoisted(() => ({
  attempts: [] as Record<string, unknown>[],
  contacts: [] as Record<string, unknown>[],
  optOuts: [] as Record<string, unknown>[],
  reviews: [] as Record<string, unknown>[],
  users: [] as Record<string, unknown>[],
  credentials: [] as Record<string, unknown>[],
  applications: [] as Record<string, unknown>[],
  lock: Promise.resolve() as Promise<unknown>,
}));

vi.mock("@/lib/auth/session", () => ({
  requireSession: async () => ({ userId: ALICE, email: "me@example.com" }),
}));

/** Records every ④ call so "no network happened" is checkable, not asserted. */
const worker = vi.hoisted(() => ({ deliverCalls: [] as unknown[] }));

vi.mock("@/lib/outreach/worker-client", () => ({
  deliver: async (body: unknown) => {
    worker.deliverCalls.push(body);
    return { status: "drafted", provider_message_id: "msg-1", error: null };
  },
  preflight: async () => ({ ok: true, reason: null }),
  generateEmail: async () => ({}),
  WorkerError: class extends Error {},
}));

vi.mock("@/lib/db/client", () => {
  const match = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      if (value && typeof value === "object" && "in" in (value as object)) {
        return (value as { in: unknown[] }).in.includes(row[key]);
      }
      if (key === "contact" && value && typeof value === "object") {
        const contact = db.contacts.find((c) => c.id === row.contactId);
        const inner = value as Record<string, unknown>;
        return contact ? inner.recipientEmail === contact.recipientEmail : false;
      }
      if (key === "createdAt") return true;
      return row[key] === value;
    });

  const table = (rows: () => Record<string, unknown>[]) => ({
    findFirst: async ({ where }: { where: Record<string, unknown> }) =>
      rows().find((r) => match(r, where)) ?? null,
    findUnique: async ({ where }: { where: Record<string, unknown> }) =>
      rows().find((r) => match(r, where)) ?? null,
    findUniqueOrThrow: async ({ where }: { where: Record<string, unknown> }) => {
      const hit = rows().find((r) => match(r, where));
      if (!hit) throw new Error("not found");
      return hit;
    },
    findMany: async () => rows(),
    count: async () => rows().length,
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      let count = 0;
      for (const row of rows()) {
        if (match(row, where)) { Object.assign(row, data); count += 1; }
      }
      return { count };
    },
    update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = rows().find((r) => match(r, where));
      if (row) Object.assign(row, data);
      return row;
    },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      const keep = rows().filter((r) => !match(r, where));
      const removed = rows().length - keep.length;
      rows().splice(0, rows().length, ...keep);
      return { count: removed };
    },
  });

  function raw(strings: TemplateStringsArray, ...values: unknown[]) {
    const sql = strings.join("?");
    if (sql.includes("pg_advisory_xact_lock")) return [];

    if (sql.includes("INSERT INTO review_events")) {
      db.reviews.push({
        id: `rev-${db.reviews.length + 1}`,
        attempt_id: values[0], user_id: values[1],
        subject_chosen: values[2], body_hash: values[3],
        token_hash: values[4], token_used_at: null,
      });
      return [];
    }
    if (sql.includes("SELECT id, attempt_id")) {
      const hit = db.reviews.find(
        (r) => r.token_hash === values[0] && r.user_id === values[1] && r.token_used_at === null,
      );
      return hit ? [hit] : [];
    }
    if (sql.includes("UPDATE review_events")) {
      const hit = db.reviews.find(
        (r) => r.token_hash === values[0] && r.user_id === values[1] && r.token_used_at === null,
      );
      if (!hit) return [];
      hit.token_used_at = new Date();
      return [{ id: hit.id }];
    }
    if (sql.includes("count(*)")) {
      const used = db.attempts.filter(
        (a) => a.userId === values[0] && (a.status === "sent" || a.status === "drafted"),
      ).length;
      return [{ count: BigInt(used) }];
    }
    if (sql.includes("UPDATE outreach_attempts")) {
      const hit = db.attempts.find((a) => a.id === values[0]);
      if (hit) hit.status = "drafted";
      return [];
    }

    /**
     * The status machine's conditional advance (P6.1.3).
     *
     * Modelled rather than stubbed: the rank comparison and the
     * manual-terminal guard both live in the real SQL, so a fake that just set
     * the status would let a regression in either rule pass. `rejected` must
     * still be sticky here, exactly as in Postgres.
     */
    if (sql.includes("UPDATE applications")) {
      const [target, id] = values as [string, string];
      const app = db.applications.find((a) => a.id === id);
      if (!app) return [];

      const RANK: Record<string, number> = {
        saved: 0, scored: 1, tailored: 2, contact_added: 3, emailed: 4,
      };
      const terminal = ["replied", "interviewing", "rejected", "closed"];
      if (terminal.includes(app.status as string)) return [];

      const current = RANK[app.status as string] ?? 99;
      if (current >= (RANK[target] ?? 0)) return [];

      app.status = target;
      return [{ status: target }];
    }

    return [];
  }

  return {
    prisma: {
      outreachAttempt: table(() => db.attempts),
      contact: table(() => db.contacts),
      optOutEntry: table(() => db.optOuts),
      reviewEvent: table(() => db.reviews),
      user: table(() => db.users),
      senderCredential: table(() => db.credentials),
      application: table(() => db.applications),
      resume: table(() => []),
      tailoringRun: table(() => []),
      $queryRaw: async (s: TemplateStringsArray, ...v: unknown[]) => raw(s, ...v),
      $executeRaw: async (s: TemplateStringsArray, ...v: unknown[]) => raw(s, ...v),
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const run = db.lock.then(() =>
          fn({
            $queryRaw: async (s: TemplateStringsArray, ...v: unknown[]) => raw(s, ...v),
            $executeRaw: async (s: TemplateStringsArray, ...v: unknown[]) => raw(s, ...v),
            reviewEvent: table(() => db.reviews),
            outreachAttempt: table(() => db.attempts),
            application: table(() => db.applications),
          }),
        );
        db.lock = run.catch(() => undefined);
        return run;
      },
    },
  };
});

import { POST as deliverRoute } from "@/app/api/outreach/[id]/deliver/route";
import { hashBody, normalizeBody } from "@/lib/outreach/body";
import { mintApprovalToken } from "@/lib/db/stores/review";

const BODY = normalizeBody("Hi Priya,\n\nI build payment systems.\n\nBest,\nGaurav K");

function seed() {
  db.attempts = [
    {
      id: ATTEMPT, userId: ALICE, applicationId: APPLICATION, contactId: CONTACT,
      status: "generated", subject: "Quick note",
      bodySnapshot: BODY, bodyHash: hashBody(BODY), wordCount: 9,
      errorMessage: null, provider: "dry_run",
    },
  ];
  db.contacts = [
    {
      id: CONTACT, userId: ALICE, applicationId: APPLICATION,
      recipientEmail: "priya@acme.com", recipientName: "Priya",
    },
  ];
  db.applications = [{ id: APPLICATION, userId: ALICE, status: "contact_added" }];
  db.optOuts = [];
  db.reviews = [];
  db.lock = Promise.resolve();
  db.users = [
    {
      id: ALICE, email: "me@example.com", candidateName: "Gaurav K",
      candidateBackground: "backend", portfolioUrl: null, linkedinUrl: null,
      dryRun: true, sendMode: "draft", maxOutreachPerDay: 5,
    },
  ];
  db.credentials = [
    { userId: ALICE, provider: "smtp", preflightOkAt: new Date(), grantedScopes: null },
  ];
  worker.deliverCalls = [];
}

/** Drive the real handler the way Next does. */
function call(token?: string) {
  return deliverRoute(
    new Request("http://localhost/api/outreach/x/deliver", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(token ? { token } : {}),
    }),
    { params: Promise.resolve({ id: ATTEMPT }) },
  );
}

const row = () => db.attempts.find((a) => a.id === ATTEMPT)!;

async function approve(): Promise<string> {
  const { token } = await mintApprovalToken(ALICE, ATTEMPT, "Quick note", hashBody(BODY));
  return token;
}

beforeEach(() => seed());

describe("every block writes an auditable row (EC-P5-57)", () => {
  it("records a missing token as failed, naming the check", async () => {
    const response = await call();
    expect(response.status).toBe(422);

    // The 422 is not the record — this is.
    expect(row().status).toBe("failed");
    expect(String(row().errorMessage)).toContain("approval_token");
  });

  it("records an opt-out block with the opt_out reason", async () => {
    // The acceptance criterion is "blocked, `failed` row with reason opt_out" —
    // both halves, not just the refusal.
    db.optOuts = [{ userId: ALICE, email: "priya@acme.com" }];
    const token = await approve();

    const response = await call(token);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ check: "opt_out" });

    expect(row().status).toBe("failed");
    expect(String(row().errorMessage)).toContain("opt_out");
  });

  it("records a body-integrity block after a post-approval edit", async () => {
    const token = await approve();
    db.attempts[0].bodySnapshot = `${BODY}\n\nPS: I also have a PhD.`;

    await call(token);
    expect(row().status).toBe("failed");
    expect(String(row().errorMessage)).toContain("body_integrity");
  });

  it("records a dedup block naming the check", async () => {
    const token = await approve();
    db.attempts.push({
      id: "dupe", userId: ALICE, applicationId: APPLICATION, contactId: CONTACT,
      status: "sent", subject: "s", bodySnapshot: "b", bodyHash: "h", wordCount: 1,
    });

    await call(token);
    expect(row().status).toBe("failed");
    expect(String(row().errorMessage)).toContain("dedup");
  });

  it("never reaches the provider on any block", async () => {
    db.optOuts = [{ userId: ALICE, email: "priya@acme.com" }];
    const token = await approve();
    await call(token);
    // A block that still called ④ would be a gate in name only.
    expect(worker.deliverCalls).toHaveLength(0);
  });
});

describe("the token is burned between the chain and the provider", () => {
  it("does not consume the approval when a check refuses", async () => {
    // Burning first would spend the user's approval on a request that was
    // never going to be delivered, forcing a pointless re-approval.
    db.optOuts = [{ userId: ALICE, email: "priya@acme.com" }];
    const token = await approve();
    await call(token);
    expect(db.reviews[0].token_used_at).toBeNull();
  });

  it("burns the approval on a successful dry run", async () => {
    const token = await approve();
    const response = await call(token);
    expect(response.status).toBe(200);
    expect(db.reviews[0].token_used_at).not.toBeNull();
  });

  it("refuses a replayed token and records that too", async () => {
    const token = await approve();
    await call(token);

    // Re-open the attempt so the replay reaches check 2 rather than dying at
    // the status guard — the token itself must be what stops it.
    db.attempts[0].status = "generated";
    const response = await call(token);

    expect(response.status).toBe(422);
    expect(row().status).toBe("failed");
    expect(String(row().errorMessage)).toContain("approval_token");
  });
});

describe("dry run is a real outcome, not a no-op (P5.5.7)", () => {
  it("writes a drafted row against the dry_run provider and opens no socket", async () => {
    const token = await approve();
    const response = await call(token);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mode: "dry_run" });

    // EC-P5-60: ④ is never called at all, so there is no socket to assert on.
    expect(worker.deliverCalls).toHaveLength(0);
    expect(row().status).toBe("drafted");
    expect(row().provider).toBe("dry_run");
  });

  it("advances the application, so a dry run exercises the real bookkeeping", async () => {
    const token = await approve();
    await call(token);
    expect(db.applications[0].status).toBe("emailed");
  });
});
