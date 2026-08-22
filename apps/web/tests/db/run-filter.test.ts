/**
 * "Jobs from this run" means SURFACED, not first-discovered.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * REGRESSION: a search reporting 20 jobs per board, and a board showing none.
 *
 * `harvestRunId` is first-seen and never changes (EC-P2-19); `lastSeenRunId`
 * updates on every sighting. Filtering reads on `harvestRunId` therefore asks
 * "what did this run discover for the FIRST time" — which, for a repeated
 * search, is nothing at all.
 *
 * Observed on live data: board_results recorded naukri 20 / remoteok 20 /
 * wellfound 20, the run finished `partial`, and /jobs?runId= returned 0 while
 * 55 rows carried `lastSeenRunId` for that run.
 *
 * The nastier half is the overlapping-search case, pinned below: it degrades to
 * PARTIAL results that look entirely plausible, so nobody reports it.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { jobsSurfacedByRun, scopeToRun } from "@/lib/db/run-filter";

/** Does this where-fragment match a row with these run references? */
function matches(
  filter: ReturnType<typeof scopeToRun>,
  row: { harvestRunId: string; lastSeenRunId: string | null },
): boolean {
  if (!("OR" in filter)) return true; // unscoped: everything matches
  return filter.OR.some((clause) =>
    "harvestRunId" in clause
      ? clause.harvestRunId === row.harvestRunId
      : clause.lastSeenRunId === row.lastSeenRunId,
  );
}

const RUN_1 = "run-one";
const RUN_2 = "run-two";

describe("a run surfaces a job it discovered OR saw again", () => {
  it("matches a job this run discovered", () => {
    expect(matches(scopeToRun(RUN_1), { harvestRunId: RUN_1, lastSeenRunId: RUN_1 })).toBe(true);
  });

  it("matches a job an EARLIER run discovered and this run saw again", () => {
    // The regression. Before the fix this was false, so a repeated search
    // returned an empty board while reporting 20 jobs per board.
    expect(matches(scopeToRun(RUN_2), { harvestRunId: RUN_1, lastSeenRunId: RUN_2 })).toBe(true);
  });

  it("does not match a job this run never saw", () => {
    expect(matches(scopeToRun(RUN_2), { harvestRunId: RUN_1, lastSeenRunId: RUN_1 })).toBe(false);
  });

  it("still matches by harvestRunId when lastSeenRunId was never set", () => {
    // Rows written before lastSeenRunId existed, plus the legacy and onboarding
    // importers, which set only harvestRunId.
    expect(matches(scopeToRun(RUN_1), { harvestRunId: RUN_1, lastSeenRunId: null })).toBe(true);
  });
});

describe("the unscoped board is unaffected", () => {
  it("collapses to an empty filter with no run id", () => {
    // Must be `{}` — "every job this user has" — not a clause matching nothing.
    expect(scopeToRun(null)).toEqual({});
    expect(scopeToRun(undefined)).toEqual({});
    expect(scopeToRun("")).toEqual({});
  });

  it("matches every row when unscoped", () => {
    expect(matches(scopeToRun(null), { harvestRunId: RUN_1, lastSeenRunId: RUN_2 })).toBe(true);
  });
});

describe("the shape Prisma receives", () => {
  it("is a single OR over both run columns", () => {
    expect(jobsSurfacedByRun(RUN_1)).toEqual({
      OR: [{ harvestRunId: RUN_1 }, { lastSeenRunId: RUN_1 }],
    });
  });

  it("carries no imports, so ③ can share it without a second Prisma client", () => {
    // The orchestrator imports this helper. If it ever pulls in lib/db/client,
    // ③ gains a second connection pool against a 60-connection instance.
    const source = readFileSync(
      join(__dirname, "..", "..", "lib", "db", "run-filter.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/^\s*import\s/m);
  });
});
