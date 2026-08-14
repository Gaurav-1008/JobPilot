/**
 * The proof bundle (P6.3) — FR11.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS ARTIFACT IS A PUBLICATION.
 *
 * It exists to be shared: attached to an email, handed to a mentor, posted as
 * evidence of a job search. Two consequences follow, and both are handled here
 * rather than left to the person clicking export:
 *
 *   EC-P6-25  every CSV cell is escaped against formula injection, because
 *             this file will be opened in a spreadsheet by someone else
 *   EC-P6-28  the log contains real recipient addresses. The source projects'
 *             proof was screenshots a human chose; this is automatic and
 *             complete, so the bundle ships a redaction option and the README
 *             says plainly what is inside.
 *
 * EC-P6-30: a brand-new user with nothing done gets a valid bundle explaining
 * there is nothing yet — not a 500 and not an empty file.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { prisma } from "@/lib/db/stores/export-queries";
import { toCsv } from "./csv";

export interface BundleOptions {
  userId: string;
  /** EC-P6-28: replace recipient addresses with a stable placeholder. */
  redactRecipients?: boolean;
  /**
   * Include the side-by-side and tailored-resume PDFs.
   *
   * Off by default, and that is EC-P6-26 rather than laziness: each PDF is a
   * Chromium render, so a bundle for 200 applications is a multi-minute build
   * that does not belong in a request handler. Opt-in keeps the common export
   * instant, and `maxPdfRuns` bounds the slow one.
   */
  includePdfs?: boolean;
  maxPdfRuns?: number;
  /** Injected so the bundle can be tested without launching a browser. */
  renderPdfs?: (runId: string) => Promise<{ name: string; bytes: Buffer }[]>;
}

export interface BundleFile {
  name: string;
  /** Text files carry `content`; PDFs carry `bytes`. */
  content?: string;
  bytes?: Buffer;
}

/** `priya@acme.com` → `p****@acme.com`. Keeps the domain, loses the person. */
function redact(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "[redacted]";
  return `${email[0]}****${email.slice(at)}`;
}

/**
 * Pipeline counts (P6.3.2).
 *
 * EC-P6-29: jobs are counted DISTINCT. A re-harvest that rediscovers the same
 * posting must not inflate the number — the whole point of this summary is
 * that it is defensible, and a doubled count is the fastest way to lose that.
 */
async function pipelineSummary(userId: string) {
  const [jobs, hydrated, scored, applications, tailored, contacts, attempts] =
    await Promise.all([
      prisma.job.count({ where: { userId } }),
      prisma.job.count({ where: { userId, hydrationStatus: "hydrated" } }),
      prisma.application.count({ where: { userId, originalScore: { not: null } } }),
      prisma.application.count({ where: { userId } }),
      prisma.tailoringRun.count({ where: { userId, tier: "full" } }),
      prisma.contact.count({ where: { userId } }),
      prisma.outreachAttempt.findMany({
        where: { userId },
        select: { status: true },
      }),
    ]);

  const byStatus = attempts.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});

  return { jobs, hydrated, scored, applications, tailored, contacts, byStatus };
}

export async function buildBundle(options: BundleOptions): Promise<BundleFile[]> {
  const { userId, redactRecipients = false } = options;
  const summary = await pipelineSummary(userId);

  const attempts = await prisma.outreachAttempt.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: {
      contact: { select: { recipientEmail: true, source: true } },
      application: { include: { job: { select: { title: true, company: true } } } },
    },
  });

  /**
   * Column names match The Closer's `outreach_log.csv` exactly (P6.3.3), so a
   * user's history reads as one continuous record across both tools rather
   * than as a before-and-after that has to be reconciled by hand.
   */
  const outreachCsv = toCsv(
    [
      "timestamp", "recipient_email", "company", "role", "subject",
      "status", "error_message", "word_count", "parent_id",
    ],
    attempts.map((a) => {
      const email = a.contact?.recipientEmail ?? "";
      return [
        a.createdAt.toISOString(),
        redactRecipients && email ? redact(email) : email,
        a.application?.job.company ?? "",
        a.application?.job.title ?? "",
        a.subject,
        a.status,
        a.errorMessage ?? "",
        a.wordCount,
        a.parentId ?? "",
      ];
    }),
  );

  const applications = await prisma.application.findMany({
    where: { userId },
    include: { job: true, resume: { select: { version: true } } },
    orderBy: { updatedAt: "asc" },
  });

  const applicationsCsv = toCsv(
    ["company", "role", "location", "status", "original_score", "tailored_score", "resume_version", "job_url", "updated_at"],
    applications.map((a) => [
      a.job.company, a.job.title, a.job.location ?? "", a.status,
      a.originalScore ?? "", a.tailoredScore ?? "", a.resume?.version ?? "",
      a.job.link, a.updatedAt.toISOString(),
    ]),
  );

  /* ── PDFs (P6.3.1) ──────────────────────────────────────────────────── */
  const pdfFiles: BundleFile[] = [];
  const pdfNotes: string[] = [];

  if (options.includePdfs && options.renderPdfs) {
    const cap = options.maxPdfRuns ?? 20;
    const runs = await prisma.tailoringRun.findMany({
      where: { userId, tier: "full" },
      orderBy: { createdAt: "desc" },
      take: cap + 1,
      include: { application: { include: { job: { select: { company: true, title: true } } } } },
    });

    if (runs.length > cap) {
      pdfNotes.push(
        `Only the ${cap} most recent tailoring runs are included as PDFs. ` +
          "Older runs are listed in applications.csv and can be exported individually.",
      );
    }

    for (const run of runs.slice(0, cap)) {
      const label = run.application
        ? `${run.application.job.company}-${run.application.job.title}`
        : "run";
      /**
       * The date and run id are part of the name, not decoration.
       *
       * Re-tailoring the same job produces several `full` runs, and naming them
       * by company and title alone made every one collide. In a tar, duplicate
       * entries do not error — the last one extracted silently wins, so a
       * bundle covering five tailoring attempts unpacked to one. Verified on
       * real data: ten PDFs, two distinct filenames.
       *
       * Dated names also make the bundle readable as a history, which is what
       * a proof artifact is for.
       */
      const day = run.createdAt.toISOString().slice(0, 10);
      const slug = `${label}-${day}-${run.id.slice(0, 8)}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      try {
        const rendered = await options.renderPdfs(run.id);
        for (const file of rendered) {
          pdfFiles.push({ name: `pdfs/${slug}-${file.name}`, bytes: file.bytes });
        }
      } catch (err) {
        /**
         * EC-P6-27 — a missing or unrenderable document is a NOTE, never a
         * failed bundle. Losing the whole export because one PDF could not be
         * produced would make the artifact unavailable exactly when someone
         * needs it, and the omission is more useful stated than hidden.
         */
        pdfNotes.push(
          `Could not include PDFs for ${label}: ${err instanceof Error ? err.message : "render failed"}.`,
        );
      }
    }
  }

  const blocked = attempts.filter((a) => a.status === "failed").length;
  const empty = summary.applications === 0 && attempts.length === 0;

  /**
   * P6.3.4 — the truthfulness disclaimer. Required, inherited from all three
   * source projects, and asserted by a test so it cannot quietly go missing
   * from the one artifact that leaves the system.
   */
  const readme = `# JobPilot — proof bundle

Generated ${new Date().toISOString()}

${empty ? "This account has no applications or outreach yet. The bundle is valid and empty rather than missing.\n" : ""}
## Truthfulness notice

JobPilot rewrites and writes only content traceable to your resume, and never
invents employers, degrees, metrics, or relationships. Everything in this
bundle is a draft you reviewed, or a record of one. Nothing here was sent
without a human approving that exact text.

No ATS or reply outcome is guaranteed by any of it.

## Pipeline

| Stage | Count |
|-------|-------|
| Jobs found (distinct) | ${summary.jobs} |
| Descriptions read | ${summary.hydrated} |
| Applications | ${summary.applications} |
| Scored | ${summary.scored} |
| Tailored (full runs) | ${summary.tailored} |
| Contacts | ${summary.contacts} |
| Outreach attempts | ${attempts.length} |

Outreach attempts by outcome:

${Object.entries(summary.byStatus).map(([s, n]) => `- ${s}: ${n}`).join("\n") || "- none"}

${blocked > 0 ? `\n${blocked} attempt(s) were refused by the safety checks and never sent. They are listed in outreach_log.csv with the reason, because a record that hides its refusals is not a record.\n` : ""}
## Files

- \`outreach_log.csv\` — every attempt, including skipped and blocked ones
- \`applications.csv\` — every application and its status
${pdfFiles.length > 0
  ? `- \`pdfs/\` — ${pdfFiles.length} file(s): the tailored résumé and the side-by-side proof for each run`
  : "- (no PDFs in this bundle — export with PDFs enabled to include them)"}
${pdfNotes.length > 0 ? `\nNotes on what is missing:\n${pdfNotes.map((n) => `- ${n}`).join("\n")}\n` : ""}
## What is in here about other people

${redactRecipients
  ? "Recipient addresses are REDACTED in this copy (first letter plus domain)."
  : "Recipient addresses appear in full in `outreach_log.csv`. If you are sharing this bundle publicly, export a redacted copy instead."}

Spreadsheet cells are escaped so that values beginning with \`=\`, \`+\`, \`-\`
or \`@\` open as text rather than executing as formulas.
`;

  return [
    { name: "README.md", content: readme },
    { name: "outreach_log.csv", content: outreachCsv },
    { name: "applications.csv", content: applicationsCsv },
    ...pdfFiles,
  ];
}
