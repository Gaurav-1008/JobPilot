/**
 * Safety suite — P5.6 (architecture.md §19, tests 1-7 and 9).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THESE TESTS SHOULD FAIL THE BUILD.
 *
 * Each one corresponds to a guarantee the original projects made. Regressions
 * here are the failure mode that matters most, because they are SILENT: an
 * interlock that stops firing looks exactly like an interlock that never had
 * anything to stop.
 *
 * A note on the fake below. `$queryRaw` handlers are SYNCHRONOUS after their
 * dispatch point, which is how Postgres statement atomicity is modelled: a
 * conditional `UPDATE ... WHERE token_used_at IS NULL RETURNING` either wins or
 * returns nothing, and no interleaving is possible mid-statement. If the
 * implementation were changed to read-then-write across an `await`, the
 * concurrency tests below would start failing — which is the entire point of
 * writing them with real `Promise.all` rather than sequentially (EC-P5-45).
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { __counter, __resetMetrics } from "@/lib/obs/metrics";

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ATTEMPT = "11111111-1111-4111-8111-111111111111";
const CONTACT = "22222222-2222-4222-8222-222222222222";
const APPLICATION = "33333333-3333-4333-8333-333333333333";

/** Mutable world the fake prisma reads from; reset in beforeEach. */
const db = vi.hoisted(() => ({
  attempts: [] as Record<string, unknown>[],
  contacts: [] as Record<string, unknown>[],
  optOuts: [] as Record<string, unknown>[],
  reviews: [] as Record<string, unknown>[],
  users: [] as Record<string, unknown>[],
  credentials: [] as Record<string, unknown>[],
  resumes: [] as Record<string, unknown>[],
  sqlSeen: [] as string[],
  /** Serializes $transaction bodies — models pg_advisory_xact_lock. */
  lock: Promise.resolve() as Promise<unknown>,
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
      if (key === "createdAt") return true;   // window filters handled in raw SQL
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
    updateMany: async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      let count = 0;
      for (const row of rows()) {
        if (match(row, where)) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    },
    update: async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
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

  /** Reassemble a tagged template into inspectable SQL. */
  const sqlText = (strings: TemplateStringsArray) => strings.join("?");

  function raw(strings: TemplateStringsArray, ...values: unknown[]) {
    const sql = sqlText(strings);
    db.sqlSeen.push(sql);

    if (sql.includes("pg_advisory_xact_lock")) return [];

    if (sql.includes("INSERT INTO review_events")) {
      db.reviews.push({
        id: `rev-${db.reviews.length + 1}`,
        attempt_id: values[0],
        user_id: values[1],
        subject_chosen: values[2],
        body_hash: values[3],
        token_hash: values[4],
        token_used_at: null,
        expired: false,
      });
      return [];
    }

    if (sql.includes("SELECT id, attempt_id")) {
      const hit = db.reviews.find(
        (r) =>
          r.token_hash === values[0] &&
          r.user_id === values[1] &&
          r.token_used_at === null &&
          r.expired !== true,
      );
      return hit ? [hit] : [];
    }

    // The atomic burn. Synchronous find-and-set == one SQL statement.
    if (sql.includes("UPDATE review_events")) {
      const hit = db.reviews.find(
        (r) =>
          r.token_hash === values[0] &&
          r.user_id === values[1] &&
          r.token_used_at === null &&
          r.expired !== true,
      );
      if (!hit) return [];
      hit.token_used_at = new Date();
      return [{ id: hit.id }];
    }

    if (sql.includes("count(*)")) {
      const used = db.attempts.filter(
        (a) =>
          a.userId === values[0] &&
          (a.status === "sent" || a.status === "drafted"),
      ).length;
      return [{ count: BigInt(used) }];
    }

    if (sql.includes("UPDATE outreach_attempts")) {
      const hit = db.attempts.find((a) => a.id === values[0]);
      if (hit) hit.status = "drafted";
      return [];
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
      resume: table(() => db.resumes),
      tailoringRun: table(() => []),
      application: table(() => []),
      $queryRaw: async (strings: TemplateStringsArray, ...v: unknown[]) =>
        raw(strings, ...v),
      $executeRaw: async (strings: TemplateStringsArray, ...v: unknown[]) =>
        raw(strings, ...v),
      // Serialized, like a transaction holding an advisory lock on the user.
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const run = db.lock.then(() =>
          fn({
            $queryRaw: async (s: TemplateStringsArray, ...v: unknown[]) => raw(s, ...v),
            $executeRaw: async (s: TemplateStringsArray, ...v: unknown[]) => raw(s, ...v),
            reviewEvent: table(() => db.reviews),
            outreachAttempt: table(() => db.attempts),
            application: table(() => []),
          }),
        );
        db.lock = run.catch(() => undefined);
        return run;
      },
    },
  };
});

import { hashBody, normalizeBody } from "@/lib/outreach/body";
import { runInterlocks } from "@/lib/outreach/interlocks";
import { burnToken, mintApprovalToken } from "@/lib/db/stores/review";

const BODY = normalizeBody("Hi Priya,\n\nI build payment systems.\n\nBest,\nGaurav K");

function seed(overrides: { user?: Record<string, unknown> } = {}) {
  db.attempts = [
    {
      id: ATTEMPT,
      userId: ALICE,
      applicationId: APPLICATION,
      contactId: CONTACT,
      status: "generated",
      subject: "Quick note",
      bodySnapshot: BODY,
      bodyHash: hashBody(BODY),
      wordCount: 9,
    },
  ];
  db.contacts = [
    {
      id: CONTACT,
      userId: ALICE,
      applicationId: APPLICATION,
      recipientEmail: "priya@acme.com",
      recipientName: "Priya",
    },
  ];
  db.optOuts = [];
  db.reviews = [];
  db.resumes = [];
  db.sqlSeen = [];
  db.lock = Promise.resolve();
  db.users = [
    {
      id: ALICE,
      email: "me@example.com",
      candidateName: "Gaurav K",
      candidateBackground: "backend",
      portfolioUrl: null,
      linkedinUrl: null,
      dryRun: true,
      sendMode: "draft",
      maxOutreachPerDay: 5,
      ...overrides.user,
    },
  ];
  db.credentials = [
    { userId: ALICE, provider: "smtp", preflightOkAt: new Date(), grantedScopes: null },
  ];
}

async function approve(): Promise<string> {
  const { token } = await mintApprovalToken(ALICE, ATTEMPT, "Quick note", hashBody(BODY));
  return token;
}

beforeEach(() => seed());

/* ══════════════════════════════════════════════════════════════════════ */

describe("safety test 1 — delivery without an approval token is blocked", () => {
  it("blocks a hand-crafted request carrying no token (EC-P5-42)", async () => {
    const result = await runInterlocks({ userId: ALICE, attemptId: ATTEMPT, token: null });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.check).toBe("approval_token");
  });

  it("blocks an unknown token", async () => {
    const result = await runInterlocks({
      userId: ALICE, attemptId: ATTEMPT, token: "not-a-real-token",
    });
    expect(result.ok).toBe(false);
  });

  it("is not satisfied merely by an approval existing in the database", async () => {
    // The token is a capability held by the client. If the server accepted
    // "an approval row exists", a curl would pass while the user was reading.
    await approve();
    const result = await runInterlocks({ userId: ALICE, attemptId: ATTEMPT, token: null });
    expect(result.ok).toBe(false);
  });
});

describe("safety test 2 — a token minted for different content is blocked", () => {
  it("blocks when the body changed after approval (EC-P5-43)", async () => {
    const token = await approve();
    // The user edits after approving; the stored body no longer hashes to the
    // approved value.
    db.attempts[0].bodySnapshot = `${BODY}\n\nPS: I also have a PhD.`;

    const result = await runInterlocks({ userId: ALICE, attemptId: ATTEMPT, token });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.check).toBe("body_integrity");
  });

  it("blocks when a token from another attempt is presented", async () => {
    const { token } = await mintApprovalToken(
      ALICE, "99999999-9999-4999-8999-999999999999", "s", hashBody(BODY),
    );
    const result = await runInterlocks({ userId: ALICE, attemptId: ATTEMPT, token });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.check).toBe("approval_token");
  });
});

describe("safety test 3 — token replay is blocked", () => {
  it("refuses the second use of a burned token (EC-P5-44)", async () => {
    const token = await approve();
    expect(await burnToken(ALICE, token)).toBe(true);
    expect(await burnToken(ALICE, token)).toBe(false);

    const result = await runInterlocks({ userId: ALICE, attemptId: ATTEMPT, token });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.check).toBe("approval_token");
  });

  it("lets exactly ONE of two concurrent burns win (EC-P5-45)", async () => {
    const token = await approve();
    // Real parallelism, not two sequential calls — the race is invisible
    // sequentially, and two browser tabs are the whole reproduction.
    const results = await Promise.all([
      burnToken(ALICE, token),
      burnToken(ALICE, token),
      burnToken(ALICE, token),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("compares expiry against the database clock, not the app's (EC-P5-47)", async () => {
    const token = await approve();
    db.reviews[0].expired = true;   // as the DB would see it
    const result = await runInterlocks({ userId: ALICE, attemptId: ATTEMPT, token });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.check).toBe("approval_token");
  });
});

describe("safety test 4 — a suppressed recipient is blocked and logged", () => {
  it("blocks an opted-out address (EC-P5-49)", async () => {
    const token = await approve();
    db.optOuts = [{ userId: ALICE, email: "priya@acme.com" }];

    const result = await runInterlocks({ userId: ALICE, attemptId: ATTEMPT, token });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.check).toBe("opt_out");
  });

  it("blocks a contact created BEFORE the opt-out was added (EC-P5-17)", async () => {
    // Suppression is evaluated at send time, never at contact-creation time.
    const token = await approve();
    db.optOuts = [{ userId: ALICE, email: "priya@acme.com" }];
    const result = await runInterlocks({ userId: ALICE, attemptId: ATTEMPT, token });
    expect(result.ok === false && result.check).toBe("opt_out");
  });

  it("blocks via a whole-domain opt-out entry (EC-P5-16)", async () => {
    const token = await approve();
    db.optOuts = [{ userId: ALICE, email: "@acme.com" }];
    const result = await runInterlocks({ userId: ALICE, attemptId: ATTEMPT, token });
    expect(result.ok === false && result.check).toBe("opt_out");
  });

  it("counts the block against interlock_block_total{check} (P5.4.9, P7.3.3)", async () => {
    // P5.4.9 emitted a log line shaped like a counter because no counter
    // existed yet. P7.3.3 made it a real one, so this asserts the counter
    // rather than the text of a log line — the same property, checked where it
    // now actually lives.
    __resetMetrics();
    const token = await approve();
    db.optOuts = [{ userId: ALICE, email: "priya@acme.com" }];
    await runInterlocks({ userId: ALICE, attemptId: ATTEMPT, token });

    // EC-P7-21: an opt-out block is the system working, and carries the class
    // that keeps it off the same dashboard as a token failure.
    expect(__counter("interlock_block_total", { check: "opt_out", class: "expected" }))
      .toBe(1);
  });
});

describe("dedup keys on the person, not the contact row (EC-P5-50)", () => {
  it("blocks a second email to the same address on a different application", async () => {
    const token = await approve();
    // Same human, second application, second contact row.
    db.contacts.push({
      id: "44444444-4444-4444-8444-444444444444",
      userId: ALICE,
      applicationId: "55555555-5555-4555-8555-555555555555",
      recipientEmail: "priya@acme.com",
      recipientName: "Priya",
    });
    db.attempts.push({
      id: "66666666-6666-4666-8666-666666666666",
      userId: ALICE,
      applicationId: "55555555-5555-4555-8555-555555555555",
      contactId: "44444444-4444-4444-8444-444444444444",
      status: "sent",
      subject: "s",
      bodySnapshot: "b",
      bodyHash: "h",
      wordCount: 1,
    });

    const result = await runInterlocks({ userId: ALICE, attemptId: ATTEMPT, token });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.check).toBe("dedup");
  });

  it("does NOT lock a contact out after a failed or skipped attempt (EC-P5-51)", async () => {
    const token = await approve();
    db.attempts.push({
      id: "77777777-7777-4777-8777-777777777777",
      userId: ALICE,
      applicationId: APPLICATION,
      contactId: CONTACT,
      status: "failed",
      subject: "s", bodySnapshot: "b", bodyHash: "h", wordCount: 1,
    });
    const result = await runInterlocks({ userId: ALICE, attemptId: ATTEMPT, token });
    expect(result.ok).toBe(true);
  });
});

describe("safety test 5 — the volume cap blocks at N+1", () => {
  /** Fill the rolling window with `n` already-delivered attempts. */
  function fillWindow(n: number) {
    for (let i = 0; i < n; i += 1) {
      db.attempts.push({
        id: `filler-${i}`,
        userId: ALICE,
        applicationId: APPLICATION,
        contactId: `other-${i}`,
        status: "sent",
        subject: "s", bodySnapshot: "b", bodyHash: "h", wordCount: 1,
      });
    }
  }

  it("allows the Nth email (EC-P5-53, lower side of the boundary)", async () => {
    db.users[0].maxOutreachPerDay = 3;
    fillWindow(2);   // this attempt would be the 3rd — exactly at the cap

    const token = await approve();
    const result = await runInterlocks({ userId: ALICE, attemptId: ATTEMPT, token });
    expect(result.ok).toBe(true);
  });

  it("blocks the N+1th email (EC-P5-53, upper side of the boundary)", async () => {
    db.users[0].maxOutreachPerDay = 3;
    fillWindow(3);   // the window is already full

    const token = await approve();
    const result = await runInterlocks({ userId: ALICE, attemptId: ATTEMPT, token });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.check).toBe("volume_cap");
  });

  it("counts a reservation immediately, so a second tab sees the slot taken", async () => {
    // The reservation IS the status flip to `drafted`. Without it, two tabs
    // both read N-1 and both proceed (EC-P5-52).
    db.users[0].maxOutreachPerDay = 3;
    fillWindow(2);

    const token = await approve();
    await runInterlocks({ userId: ALICE, attemptId: ATTEMPT, token });
    expect(db.attempts[0].status).toBe("drafted");

    const used = db.attempts.filter(
      (a) => a.status === "sent" || a.status === "drafted",
    ).length;
    expect(used).toBe(3);   // the window is now full, not still at 2
  });

  it("takes the advisory lock so two tabs cannot both pass (EC-P5-52)", async () => {
    const token = await approve();
    await runInterlocks({ userId: ALICE, attemptId: ATTEMPT, token });
    // A plain count-then-update is TOCTOU; the lock is what makes it safe.
    expect(db.sqlSeen.some((s) => s.includes("pg_advisory_xact_lock"))).toBe(true);
  });

  it("uses a rolling 24h window rather than a calendar day (EC-P5-54)", async () => {
    const token = await approve();
    await runInterlocks({ userId: ALICE, attemptId: ATTEMPT, token });
    const capQuery = db.sqlSeen.find((s) => s.includes("count(*)"));
    // "today" in server-local time lets a user send 2N across midnight.
    expect(capQuery).toContain("interval '24 hours'");
    expect(capQuery).not.toMatch(/current_date|date_trunc/i);
  });
});

describe("safety test 7 — missing config defaults to dry-run and draft", () => {
  it("resolves to dry_run when the user's defaults are untouched", async () => {
    const token = await approve();
    const result = await runInterlocks({ userId: ALICE, attemptId: ATTEMPT, token });
    expect(result.ok && result.mode).toBe("dry_run");
  });

  it("never resolves to 'send' from an unrecognized send_mode", async () => {
    db.users[0].dryRun = false;
    db.users[0].sendMode = "something-else";
    const token = await approve();
    const result = await runInterlocks({ userId: ALICE, attemptId: ATTEMPT, token });
    // Invariant 3: misconfiguration must never escalate to sending.
    expect(result.ok && result.mode).toBe("draft");
  });

  it("blocks when no sending account is connected", async () => {
    db.users[0].dryRun = false;
    db.credentials = [];
    const token = await approve();
    const result = await runInterlocks({ userId: ALICE, attemptId: ATTEMPT, token });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.check).toBe("credentials");
  });

  it("blocks when the account never passed preflight (EC-P5-63)", async () => {
    db.users[0].dryRun = false;
    db.credentials[0].preflightOkAt = null;
    const token = await approve();
    const result = await runInterlocks({ userId: ALICE, attemptId: ATTEMPT, token });
    expect(result.ok === false && result.check).toBe("credentials");
  });

  it("blocks 'send' on a drafts-only Google grant (EC-P5-65)", async () => {
    db.users[0].dryRun = false;
    db.users[0].sendMode = "send";
    db.credentials[0] = {
      userId: ALICE, provider: "gmail_api",
      preflightOkAt: new Date(),
      grantedScopes: "https://www.googleapis.com/auth/gmail.compose",
    };
    const token = await approve();
    const result = await runInterlocks({ userId: ALICE, attemptId: ATTEMPT, token });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.check).toBe("send_mode");
  });
});

describe("the chain fails closed (EC-P5-56)", () => {
  it("treats an unexpected error as a block, never a fall-through", async () => {
    const token = await approve();
    // A check throws for a reason nobody predicted.
    db.contacts = [];
    Object.defineProperty(db, "contacts", {
      get() {
        throw new Error("database exploded");
      },
      configurable: true,
    });

    const result = await runInterlocks({ userId: ALICE, attemptId: ATTEMPT, token });
    expect(result.ok).toBe(false);

    // Restore for later tests.
    delete (db as unknown as Record<string, unknown>).contacts;
    (db as unknown as Record<string, unknown>).contacts = [];
  });

  it("refuses an attempt that is not in `generated` state", async () => {
    const token = await approve();
    db.attempts[0].status = "sent";
    const result = await runInterlocks({ userId: ALICE, attemptId: ATTEMPT, token });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.check).toBe("authz");
  });

  it("refuses another tenant's attempt without revealing it exists", async () => {
    const token = await approve();
    const result = await runInterlocks({
      userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      attemptId: ATTEMPT,
      token,
    });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.check).toBe("authz");
  });
});
