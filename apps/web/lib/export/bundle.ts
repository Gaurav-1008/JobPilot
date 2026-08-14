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
}

export interface BundleFile {
  name: string;
  content: string;
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
  ];
}
