/**
 * The proof bundle (P6.3).
 *
 * This artifact is the one thing that LEAVES the system on purpose — attached
 * to an email, handed to a mentor, posted as evidence. So the assertions here
 * are about what a stranger opening it will see, not about internal shape.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const db = vi.hoisted(() => ({
  attempts: [] as Record<string, unknown>[],
  applications: [] as Record<string, unknown>[],
  counts: { job: 0, hydrated: 0, scored: 0, application: 0, tailoring: 0, contact: 0 },
}));

vi.mock("@/lib/db/stores/export-queries", () => ({
  prisma: {
    job: {
      count: async ({ where }: { where: Record<string, unknown> }) =>
        where.hydrationStatus ? db.counts.hydrated : db.counts.job,
    },
    application: {
      count: async ({ where }: { where: Record<string, unknown> }) =>
        where.originalScore ? db.counts.scored : db.counts.application,
      findMany: async () => db.applications,
    },
    tailoringRun: { count: async () => db.counts.tailoring },
    contact: { count: async () => db.counts.contact },
    outreachAttempt: { findMany: async () => db.attempts },
  },
}));

import { buildBundle } from "@/lib/export/bundle";

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: new Date("2026-08-14T00:48:17.638Z"),
    subject: "Quick note on the AI Engineer role",
    status: "drafted",
    errorMessage: null,
    wordCount: 63,
    parentId: null,
    contact: { recipientEmail: "priya@acme.com", source: "user_entered" },
    application: { job: { company: "Acme", title: "AI Engineer" } },
    ...overrides,
  };
}

beforeEach(() => {
  db.attempts = [attempt()];
  db.applications = [
    {
      job: { company: "Acme", title: "AI Engineer", location: "Bengaluru", link: "https://x" },
      status: "emailed",
      originalScore: 61,
      tailoredScore: 90,
      resume: { version: 1 },
      updatedAt: new Date("2026-08-14T00:48:00.000Z"),
    },
  ];
  db.counts = { job: 5, hydrated: 1, scored: 1, application: 1, tailoring: 2, contact: 1 };
});

const fileNamed = (files: { name: string; content: string }[], name: string) =>
  files.find((f) => f.name === name)!.content;

describe("the bundle's contents", () => {
  it("contains a README, the outreach log, and the applications list", async () => {
    const files = await buildBundle({ userId: USER });
    expect(files.map((f) => f.name).sort()).toEqual([
      "README.md", "applications.csv", "outreach_log.csv",
    ]);
  });

  it("carries the truthfulness disclaimer (EC-P6-31, P6.3.4)", async () => {
    // Required and inherited from all three source projects. Asserted rather
    // than trusted, because it is the one artifact that leaves the system and
    // the easiest line to lose in a refactor.
    const readme = fileNamed(await buildBundle({ userId: USER }), "README.md");
    // `\s+` rather than a literal space: the README is hard-wrapped prose, so
    // a line break can fall anywhere inside a phrase. Asserting the exact
    // whitespace would make this fail on a reflow that changed nothing about
    // what the disclaimer says.
    expect(readme).toMatch(/truthfulness\s+notice/i);
    expect(readme).toMatch(/never\s+invents/i);
    expect(readme).toMatch(/no\s+ATS\s+or\s+reply\s+outcome\s+is\s+guaranteed/i);
  });

  it("uses The Closer's outreach_log.csv column names (P6.3.3)", async () => {
    // So a user's history reads as one continuous record across both tools
    // rather than as a before-and-after to reconcile by hand.
    const log = fileNamed(await buildBundle({ userId: USER }), "outreach_log.csv");
    expect(log.split("\r\n")[0]).toBe(
      '"timestamp","recipient_email","company","role","subject","status","error_message","word_count","parent_id"',
    );
  });

  it("includes blocked attempts with their reasons", async () => {
    // A record that hides its refusals is not a record.
    db.attempts = [
      attempt({ status: "failed", errorMessage: "opt_out: This person is on your opt-out list." }),
    ];
    const log = fileNamed(await buildBundle({ userId: USER }), "outreach_log.csv");
    expect(log).toContain("failed");
    expect(log).toContain("opt_out");
  });

  it("reports the pipeline summary (P6.3.2)", async () => {
    const readme = fileNamed(await buildBundle({ userId: USER }), "README.md");
    expect(readme).toMatch(/Jobs found \(distinct\) \| 5/);
    expect(readme).toMatch(/Tailored \(full runs\) \| 2/);
  });
});

describe("it is a publication, not an internal dump", () => {
  it("escapes formula-shaped cells (EC-P6-25)", async () => {
    db.attempts = [attempt({ subject: "=cmd()|'/c calc'!A1" })];
    const log = fileNamed(await buildBundle({ userId: USER }), "outreach_log.csv");
    // Opens as text in a spreadsheet rather than executing.
    expect(log).toContain(`"'=cmd()`);
  });

  it("redacts recipient addresses on request (EC-P6-28)", async () => {
    const files = await buildBundle({ userId: USER, redactRecipients: true });
    const log = fileNamed(files, "outreach_log.csv");

    expect(log).not.toContain("priya@acme.com");
    expect(log).toContain("p****@acme.com");   // domain kept, person lost
    expect(fileNamed(files, "README.md")).toMatch(/REDACTED/);
  });

  it("says plainly when addresses are NOT redacted", async () => {
    // The default is a full copy, and the user needs to know that before
    // attaching it to something public.
    const readme = fileNamed(await buildBundle({ userId: USER }), "README.md");
    expect(readme).toMatch(/appear in full/i);
    expect(readme).toMatch(/redacted copy/i);
  });
});

describe("an empty account (EC-P6-30)", () => {
  it("produces a valid bundle explaining there is nothing yet", async () => {
    db.attempts = [];
    db.applications = [];
    db.counts = { job: 0, hydrated: 0, scored: 0, application: 0, tailoring: 0, contact: 0 };

    const files = await buildBundle({ userId: USER });
    expect(files).toHaveLength(3);

    const readme = fileNamed(files, "README.md");
    expect(readme).toMatch(/no applications or outreach yet/i);
    // Still carries the disclaimer — an empty bundle is still a publication.
    expect(readme).toMatch(/truthfulness notice/i);

    // Headers survive so the files open as valid CSVs rather than blank.
    expect(fileNamed(files, "outreach_log.csv")).toContain("timestamp");
  });
});
