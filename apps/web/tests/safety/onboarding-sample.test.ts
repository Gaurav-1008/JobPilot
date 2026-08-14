/**
 * Onboarding sample data — EC-P7-03, EC-P7-04, P7.1.4.
 *
 * Two traps, both of which look like helpfulness:
 *
 *   EC-P7-03  seeding a sample SEARCH multiplies scraping load by the signup
 *             rate, on behalf of users who have asked for nothing.
 *   EC-P7-04  the sample resume becomes the default and P4 scores the user's
 *             real jobs against a fabricated career — producing numbers that
 *             are meaningless and look exactly like numbers.
 *
 * The second is the sharper one, because `createResume()` sets
 * `isDefault: isFirst` (EC-P1-21), which is correct for a real upload. Seeding
 * through it would set the trap automatically.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const db = vi.hoisted(() => ({
  resumes: [] as Record<string, unknown>[],
  jobs: [] as Record<string, unknown>[],
  runs: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    resume: {
      count: async ({ where }: { where: Record<string, unknown> }) => {
        const notSample = (where.kind as { not?: string } | undefined)?.not;
        return db.resumes.filter((r) =>
          notSample ? r.kind !== notSample : true,
        ).length;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        db.resumes.push(data);
        return data;
      },
      deleteMany: async () => {
        db.resumes = db.resumes.filter((r) => r.kind !== "sample");
        return { count: 0 };
      },
    },
    job: {
      count: async ({ where }: { where: Record<string, unknown> }) => {
        const src = where.source as string | { not?: string } | undefined;
        if (typeof src === "string") return db.jobs.filter((j) => j.source === src).length;
        if (src?.not) return db.jobs.filter((j) => j.source !== src.not).length;
        return db.jobs.length;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        db.jobs.push(data);
        return data;
      },
    },
    harvestRun: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: "run-sample", ...data };
        db.runs.push(row);
        return row;
      },
      deleteMany: async () => {
        db.runs = [];
        db.jobs = db.jobs.filter((j) => j.source !== "sample");
        return { count: 0 };
      },
    },
    // The fake executes the promises it is handed, which is what the store
    // builds — the ordering guarantees under test are not transactional ones.
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}));

beforeEach(() => {
  db.resumes = [];
  db.jobs = [];
  db.runs = [];
});

describe("EC-P7-04 — the sample resume must never become the default", () => {
  it("writes the sample resume with isDefault false", async () => {
    // The trap: this is the account's FIRST resume, and createResume() would
    // therefore mark it default (EC-P1-21). Every real job the user later
    // harvests would be scored against Jordan Lee's fabricated career.
    const { seedSampleData } = await import("@/lib/db/stores/onboarding");
    await seedSampleData(ALICE);

    const resume = db.resumes[0];
    expect(resume).toBeDefined();
    expect(resume.isDefault).toBe(false);
  });

  it("labels the sample resume so it is distinguishable from real work", async () => {
    const { seedSampleData, SAMPLE_MARKER } = await import("@/lib/db/stores/onboarding");
    await seedSampleData(ALICE);
    expect(db.resumes[0].kind).toBe(SAMPLE_MARKER);
  });

  it("does not route through createResume, where isDefault is set", async () => {
    // Structural: the behavioural test above passes today, and would keep
    // passing right up until somebody refactors this to reuse the shared
    // helper "for consistency" — at which point isDefault silently flips.
    const source = readFileSync(
      join(__dirname, "..", "..", "lib", "db", "stores", "onboarding.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(source).not.toMatch(/createResume/);
    // And it states the value explicitly rather than relying on a default.
    expect(source).toMatch(/isDefault:\s*false/);
  });

  it("clears every sample row on request", async () => {
    // Sample data must be as easy to delete as it was to create, or it becomes
    // clutter the user cannot tell apart from their own work.
    const { seedSampleData, clearSampleData } = await import("@/lib/db/stores/onboarding");
    await seedSampleData(ALICE);
    expect(db.jobs.length).toBeGreaterThan(0);

    await clearSampleData(ALICE);
    expect(db.jobs.filter((j) => j.source === "sample")).toHaveLength(0);
    expect(db.resumes.filter((r) => r.kind === "sample")).toHaveLength(0);
  });
});

describe("EC-P7-03 — seeding touches no job board", () => {
  it("uses fixtures rather than a harvest", async () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "lib", "db", "stores", "onboarding.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    // No queue, no worker call, no fetch. Onboarding must not multiply
    // scraping load by the signup rate.
    expect(source).not.toMatch(/enqueueHarvest|queue\/producer|worker-client|fetch\(/);
  });

  it("points sample links at example.com, not live postings", async () => {
    // A sample row deep-linking to a real posting sends onboarding traffic to a
    // live site — the same failure by a quieter route.
    const { SAMPLE_JOBS } = await import("@/lib/onboarding/fixtures");
    for (const job of SAMPLE_JOBS) {
      expect(job.link).toMatch(/^https:\/\/example\.com\//);
    }
  });

  it("offers a score spread, so the ranking demonstrates something", async () => {
    // A sample where everything scores the same shows neither ranking nor
    // explanation — the two things the product actually claims.
    const { SAMPLE_JOBS } = await import("@/lib/onboarding/fixtures");
    expect(SAMPLE_JOBS.length).toBeGreaterThanOrEqual(3);

    const skills = SAMPLE_JOBS.map((j) => (j.profile.requiredSkills as string[]) ?? []);
    // At least one job that shares little with the sample resume's stack.
    const resumeSkills = new Set(["Python", "Node.js", "TypeScript", "PostgreSQL", "Redis"]);
    const weak = skills.find((s) => s.filter((x) => resumeSkills.has(x)).length === 0);
    expect(weak, "expected one deliberately poor match").toBeDefined();
  });
});

describe("onboarding state", () => {
  it("still reports a user as new when they only loaded the sample", async () => {
    // Someone who loaded the sample and nothing else has not started; they
    // should still be offered the real first step.
    const { seedSampleData, onboardingState } = await import("@/lib/db/stores/onboarding");
    await seedSampleData(ALICE);

    const state = await onboardingState(ALICE);
    expect(state.isNew).toBe(true);
    expect(state.hasSampleData).toBe(true);
  });
});
