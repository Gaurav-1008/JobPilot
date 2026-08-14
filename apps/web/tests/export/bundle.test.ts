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
  runs: [] as Record<string, unknown>[],
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
    tailoringRun: {
      count: async () => db.counts.tailoring,
      findMany: async ({ take }: { take: number }) => db.runs.slice(0, take),
    },
    contact: { count: async () => db.counts.contact },
    outreachAttempt: { findMany: async () => db.attempts },
  },
}));

import { buildBundle, type BundleFile } from "@/lib/export/bundle";

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
  db.runs = [{ id: "run-1aaaaaaa", createdAt: new Date("2026-08-14T00:00:00Z"), application: { job: { company: "Acme", title: "AI Engineer" } } }];
});

const fileNamed = (files: BundleFile[], name: string) =>
  files.find((f) => f.name === name)!.content!;

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

describe("PDFs in the bundle (P6.3.1)", () => {
  const renderPdfs = async () => [
    { name: "tailored-resume.pdf", bytes: Buffer.from("%PDF-1.4 tailored") },
    { name: "side-by-side.pdf", bytes: Buffer.from("%PDF-1.4 proof") },
  ];

  it("omits them by default, and says so (EC-P6-26)", async () => {
    // Each PDF is a Chromium render; the common export must stay instant.
    const files = await buildBundle({ userId: USER });
    expect(files.some((f) => f.name.startsWith("pdfs/"))).toBe(false);
    expect(fileNamed(files, "README.md")).toMatch(/no PDFs in this bundle/i);
  });

  it("includes both documents per run when asked", async () => {
    const files = await buildBundle({ userId: USER, includePdfs: true, renderPdfs });
    const pdfs = files.filter((f) => f.name.startsWith("pdfs/"));

    expect(pdfs).toHaveLength(2);
    expect(pdfs.some((f) => f.name.endsWith("tailored-resume.pdf"))).toBe(true);
    expect(pdfs.some((f) => f.name.endsWith("side-by-side.pdf"))).toBe(true);
    // Binary, not text — the tar writer distinguishes them.
    expect(pdfs[0].bytes?.toString()).toContain("%PDF");
    expect(fileNamed(files, "README.md")).toMatch(/pdfs\//);
  });

  it("notes an unrenderable document instead of failing the bundle (EC-P6-27)", async () => {
    // Losing the whole export to one bad PDF makes the artifact unavailable
    // exactly when someone needs it.
    const files = await buildBundle({
      userId: USER,
      includePdfs: true,
      renderPdfs: async () => { throw new Error("missing from storage"); },
    });

    expect(files.some((f) => f.name === "outreach_log.csv")).toBe(true);
    expect(fileNamed(files, "README.md")).toMatch(/could not include PDFs/i);
    expect(fileNamed(files, "README.md")).toMatch(/missing from storage/);
  });

  it("gives every run a distinct filename", async () => {
    // Re-tailoring one job makes several `full` runs. Naming by company and
    // title alone collided, and tar resolves duplicates by silently letting
    // the last one win — so a bundle of five attempts unpacked to one.
    db.runs = Array.from({ length: 3 }, (_, i) => ({
      id: `run-${i}bbbbbbb`,
      createdAt: new Date(`2026-08-1${i + 1}T00:00:00Z`),
      application: { job: { company: "Acme", title: "AI Engineer" } },
    }));

    const files = await buildBundle({ userId: USER, includePdfs: true, renderPdfs });
    const names = files.filter((f) => f.name.startsWith("pdfs/")).map((f) => f.name);

    expect(names).toHaveLength(6);
    expect(new Set(names).size).toBe(6);
  });

  it("caps how many runs are rendered", async () => {
    db.runs = Array.from({ length: 5 }, (_, i) => ({
      id: `run-${i}aaaaaaa`,
      createdAt: new Date("2026-08-14T00:00:00Z"),
      application: { job: { company: "Acme", title: `Role ${i}` } },
    }));
    const files = await buildBundle({
      userId: USER, includePdfs: true, maxPdfRuns: 2, renderPdfs,
    });
    expect(files.filter((f) => f.name.startsWith("pdfs/"))).toHaveLength(4);   // 2 runs x 2 docs
    expect(fileNamed(files, "README.md")).toMatch(/Only the 2 most recent/);
  });
});
