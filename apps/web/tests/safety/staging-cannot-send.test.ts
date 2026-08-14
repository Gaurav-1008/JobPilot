/**
 * Staging physically cannot email a real person — EC-P7-23, P7.4.3.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A PHASE 7 ACCEPTANCE CRITERION, AND A SAFETY TEST.
 *
 * The edge case prescribes the exact experiment: "Test it by setting
 * `dry_run=false` on a staging user and confirming nothing sends." That
 * instruction is precise for a reason — it is the test that distinguishes a
 * platform-level OVERRIDE from a per-user DEFAULT, and only the first one is
 * worth anything.
 *
 * A default is what a staging bug edits. Any code path that writes a user row
 * re-arms real delivery, silently, and the system looks identical afterward.
 * So this suite sets the user row to the most dangerous configuration it can —
 * `dry_run: false`, `send_mode: "send"`, credentials present and preflighted —
 * and asserts that the resolved mode is still `dry_run`.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ATTEMPT = "11111111-1111-4111-8111-111111111111";
const CONTACT = "22222222-2222-4222-8222-222222222222";
const APPLICATION = "33333333-3333-4333-8333-333333333333";
const BODY = "Hi Priya, I saw the platform role and my Kafka work lines up with it.";

/**
 * The most dangerous user row the settings page can produce: every per-user
 * safeguard switched off, a verified credential, and send mode escalated.
 */
const DANGEROUS_USER = {
  id: ALICE,
  email: "alice@example.com",
  candidateName: "Alice",
  candidateBackground: "platform engineer",
  portfolioUrl: null,
  linkedinUrl: null,
  dryRun: false,
  sendMode: "send",
  maxOutreachPerDay: 50,
};

const db = vi.hoisted(() => ({
  attempts: [] as Record<string, unknown>[],
  contacts: [] as Record<string, unknown>[],
  users: [] as Record<string, unknown>[],
  credentials: [] as Record<string, unknown>[],
  reviews: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    outreachAttempt: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        if (where.status) return null;   // dedup lookup: nobody contacted yet
        return db.attempts.find((a) => a.id === where.id && a.userId === where.userId) ?? null;
      },
      count: async () => 0,
    },
    contact: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        db.contacts.find((c) => c.id === where.id) ?? null,
    },
    optOutEntry: { findFirst: async () => null },
    senderCredential: { findUnique: async () => db.credentials[0] ?? null },
    user: { findUniqueOrThrow: async () => db.users[0] },
    resume: { findFirst: async () => null },
    tailoringRun: { findFirst: async () => null },
    application: { findFirst: async () => ({ id: APPLICATION, userId: ALICE }) },
  },
}));

/** Approval is not what is under test here — grant a valid one. */
vi.mock("@/lib/db/stores/review", () => ({
  findValidReview: async () => ({
    attemptId: ATTEMPT,
    bodyHash: require("node:crypto").createHash("sha256").update(BODY).digest("hex"),
  }),
  reserveCapSlot: async () => ({ ok: true }),
}));

vi.mock("@/lib/outreach/review-context", () => ({
  loadGroundingContext: async () => ({
    resume: null, tailoredBullets: [], skillVocabulary: [], run: null,
  }),
}));

const ENV = process.env.JOBPILOT_ENV;

beforeEach(() => {
  db.users = [{ ...DANGEROUS_USER }];
  db.attempts = [{
    id: ATTEMPT, userId: ALICE, status: "generated", contactId: CONTACT,
    applicationId: APPLICATION, subject: "Platform role", bodySnapshot: BODY,
    wordCount: 14,
  }];
  db.contacts = [{
    id: CONTACT, userId: ALICE, recipientEmail: "priya@acme.com",
    recipientName: "Priya", applicationId: APPLICATION,
  }];
  db.credentials = [{
    userId: ALICE, provider: "smtp", preflightOkAt: new Date(), grantedScopes: null,
  }];
});

afterEach(() => {
  if (ENV === undefined) delete process.env.JOBPILOT_ENV;
  else process.env.JOBPILOT_ENV = ENV;
  vi.resetModules();
});

async function resolveMode(): Promise<string> {
  vi.resetModules();
  const { runInterlocks } = await import("@/lib/outreach/interlocks");
  const result = await runInterlocks({ userId: ALICE, attemptId: ATTEMPT, token: "t" });
  if (!result.ok) throw new Error(`blocked at ${result.check}: ${result.message}`);
  return result.mode;
}

describe("EC-P7-23 — the staging override ignores the user row", () => {
  it("forces dry-run for a staging user with dry_run=false and send_mode=send", async () => {
    // The exact experiment the edge case prescribes.
    process.env.JOBPILOT_ENV = "staging";
    expect(await resolveMode()).toBe("dry_run");
  });

  it("forces dry-run locally too (§17: local is hard-forced)", async () => {
    process.env.JOBPILOT_ENV = "local";
    expect(await resolveMode()).toBe("dry_run");
  });

  it("forces dry-run when JOBPILOT_ENV is unset", async () => {
    // Invariant 3 — a safe default survives misconfiguration. An env var that
    // failed to propagate must cost sends, not cost someone their inbox.
    delete process.env.JOBPILOT_ENV;
    expect(await resolveMode()).toBe("dry_run");
  });

  it("forces dry-run on a near-miss value like 'prod'", async () => {
    // No aliases, no case folding. The helpful interpretation is the one that
    // sends email, so a near-miss must fail toward simulation.
    process.env.JOBPILOT_ENV = "prod";
    expect(await resolveMode()).toBe("dry_run");

    process.env.JOBPILOT_ENV = "Production";
    expect(await resolveMode()).toBe("dry_run");
  });

  it("honours the user's choice ONLY in production", async () => {
    // The control: without this passing, the tests above would also pass on a
    // build where sending is broken outright, and prove nothing.
    process.env.JOBPILOT_ENV = "production";
    expect(await resolveMode()).toBe("send");
  });

  it("still lets a production user opt into dry-run", async () => {
    // The user row may be MORE conservative than the platform, never less.
    process.env.JOBPILOT_ENV = "production";
    db.users = [{ ...DANGEROUS_USER, dryRun: true }];
    expect(await resolveMode()).toBe("dry_run");
  });
});

describe("the policy module reads the environment, not the database", () => {
  it("never imports the repository or the Prisma client", async () => {
    // The structural half of the guarantee. If this module ever grows a user
    // lookup, the override becomes a default again and every test above keeps
    // passing while the property is gone.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(__dirname, "..", "..", "lib", "outreach", "send-policy.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    // No database access of any kind. Not "does not read dry_run" — the module
    // is ABOUT dry-run and says so in its own function names — but that it has
    // no way to reach a user row at all, which is the property that makes this
    // an override rather than a default.
    expect(source).not.toMatch(/db\/repository|db\/client|prisma|scoped\(/);
    expect(source).not.toMatch(/\bprofile\b|findUnique|findFirst/);

    // The only inputs are environment variables.
    const reads = source.match(/process\.env\.\w+/g) ?? [];
    expect(reads).toEqual(["process.env.JOBPILOT_ENV"]);
  });
});
