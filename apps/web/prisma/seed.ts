/**
 * Development seed (P0.3.5).
 *
 * EC-P0-25: IDEMPOTENT. Seeds get re-run — assume it. Every write here is an
 * upsert on a natural key, so `db:seed` twice produces the same database as
 * once, not duplicates.
 *
 * EC-P0-26: every address is @example.com (RFC 2606 reserved). Never a real
 * domain, and never a real inbox — seed data must be inert even if someone
 * later runs it against a database whose user has DRY_RUN off.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * EC-P1-42 — Supabase Auth REJECTS @example.com (`email_address_invalid`), and
 * EC-P0-26 requires exactly that domain so seed data can never mail a real
 * person. Both rules are right; they simply cannot both be satisfied by one row.
 *
 * Resolution: this row is DATA-ONLY. It exercises queries and the UI, but has
 * no auth identity and cannot sign in — by design.
 *
 * To seed data against an account you can actually sign in as, create it
 * through the UI first, then re-run with its id:
 *
 *   SEED_USER_ID=<uuid from auth.users> SEED_USER_EMAIL=<you@real> npm run db:seed
 */
const SEED_EMAIL = process.env.SEED_USER_EMAIL ?? "demo@example.com";
const SEED_ID = process.env.SEED_USER_ID;

async function main() {
  const user = await prisma.user.upsert({
    where: { email: SEED_EMAIL },
    update: {},
    create: {
      ...(SEED_ID ? { id: SEED_ID } : {}),
      email: SEED_EMAIL,
      candidateName: "Demo Candidate",
      candidateBackground:
        "Python developer working on retrieval pipelines and evaluation tooling",
      portfolioUrl: "https://example.com/portfolio",
      // Explicit, even though these are the column defaults — a seed that
      // relies on defaults hides a regression if a default ever changes.
      dryRun: true,
      sendMode: "draft",
      maxOutreachPerDay: 5,
    },
  });

  // Resume version 1, master, default. Upsert on (userId, version).
  const resume = await prisma.resume.upsert({
    where: { userId_version: { userId: user.id, version: 1 } },
    update: {},
    create: {
      userId: user.id,
      version: 1,
      kind: "master",
      isDefault: true,
      rawText: [
        "DEMO CANDIDATE",
        "demo@example.com",
        "",
        "EXPERIENCE",
        "Backend Engineer, Example Corp (2023-2025)",
        "- Built a document retrieval pipeline serving 40k queries/month",
        "- Wrote an evaluation harness that cut regression triage time in half",
        "",
        "SKILLS",
        "Python, PostgreSQL, retrieval pipelines, evaluation harnesses",
      ].join("\n"),
      profile: {
        contact: { name: "Demo Candidate", email: SEED_EMAIL },
        summary: "Backend engineer focused on retrieval and evaluation.",
        skills: [
          "Python",
          "PostgreSQL",
          "retrieval pipelines",
          "evaluation harnesses",
        ],
        experience: [
          {
            company: "Example Corp",
            title: "Backend Engineer",
            startDate: "2023",
            endDate: "2025",
            bullets: [
              "Built a document retrieval pipeline serving 40k queries/month",
              "Wrote an evaluation harness that cut regression triage time in half",
            ],
          },
        ],
        projects: [],
        education: [],
        certifications: [],
      },
    },
  });

  // A synthetic harvest run to hang the sample jobs off.
  const RUN_QUERY = "seed:ai-engineer";
  let run = await prisma.harvestRun.findFirst({
    where: { userId: user.id, roleQuery: RUN_QUERY },
  });
  run ??= await prisma.harvestRun.create({
    data: {
      userId: user.id,
      roleQuery: RUN_QUERY,
      location: "Bengaluru",
      boards: ["naukri", "remoteok"],
      status: "complete",
      // Shape matches BoardResultsSchema. EC-P2-01: `ok` with count 0 is a
      // legitimately empty search, not a failure.
      boardResults: {
        naukri: { status: "ok", count: 3, reason: null, responseBytes: 41000 },
        remoteok: { status: "ok", count: 2, reason: null, responseBytes: 8800 },
        wellfound: null,
      },
      startedAt: new Date(),
      finishedAt: new Date(),
    },
  });

  const jobs = [
    { source: "naukri", title: "AI Engineer", company: "Acme AI", location: "Bengaluru" },
    { source: "naukri", title: "ML Engineer", company: "Bridgestone GCC", location: "Bengaluru" },
    { source: "naukri", title: "Senior AI Engineer", company: "Acme AI", location: "Hyderabad" },
    { source: "remoteok", title: "Backend Engineer, RAG", company: "Globex", location: null },
    { source: "remoteok", title: "Platform Engineer", company: "Initech", location: null },
  ];

  for (const [i, j] of jobs.entries()) {
    // Same normalisation the real dedupe uses: lowercase, collapse whitespace.
    const norm = (s: string | null) =>
      (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
    const dedupeKey = [norm(j.company), norm(j.title), norm(j.location)].join("|");

    await prisma.job.upsert({
      where: { userId_dedupeKey: { userId: user.id, dedupeKey } },
      update: { lastSeenRunId: run.id },   // EC-P2-19
      create: {
        userId: user.id,
        harvestRunId: run.id,
        lastSeenRunId: run.id,
        source: j.source,
        title: j.title,
        company: j.company,
        location: j.location,
        link: `https://example.com/jobs/seed-${i + 1}`,
        postedAt: i === 0 ? "Today" : `${i} days ago`,
        postedAtParsed: null,   // EC-P2-51: best-effort, nullable
        dedupeKey,
        hydrationStatus: "pending",
      },
    });
  }

  const counts = {
    users: await prisma.user.count(),
    resumes: await prisma.resume.count(),
    harvestRuns: await prisma.harvestRun.count(),
    jobs: await prisma.job.count(),
  };
  console.log("seeded (idempotent):", counts);
  if (!SEED_ID) {
    console.log(
      "  NOTE: this user has no auth identity and cannot sign in (EC-P1-42).\n" +
      "  For a signed-in account: SEED_USER_ID=<uuid> SEED_USER_EMAIL=<email> npm run db:seed",
    );
  }
  console.log(`  user=${user.email} resume=v${resume.version} run=${run.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
