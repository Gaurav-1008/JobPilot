/**
 * The §18 failure matrix, one row at a time (P7.2.5, EC-P7-15).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * "EVERY ONE IS A HYPOTHESIS UNTIL P7.2.5 TESTS IT."
 *
 * §18 lists eleven rows of documented degradation. This file unplugs each one
 * and asserts what actually happens. Where reality disagreed with the table,
 * EC-P7-15 requires fixing the code OR the documentation in the same commit —
 * and both outcomes occurred:
 *
 *   Redis down     the CODE was wrong. §18 promised "unavailable"; the truth
 *                  was an indefinite hang. Fixed in lib/queue/producer.ts and
 *                  pinned in degradation.test.ts, which reproduces the original
 *                  bug under mutation.
 *
 *   Anthropic row  the DOCUMENTATION was wrong. §12.2 consolidated on Groq and
 *                  said so; §18, §3, and §21 still described a second provider
 *                  that this platform has never called. Fixed in the doc.
 *
 * WHAT THESE TESTS ARE. Handler-level injection: the real handler, with a
 * dependency replaced by one that fails the way the row describes. That is the
 * level where degradation is actually decided — a unit test of a helper cannot
 * tell you whether a run survives a board timeout, and an end-to-end test needs
 * the very infrastructure the row is about removing.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it, vi } from "vitest";

import { handleHarvestBoard, type Deps } from "../../../../services/orchestrator/handlers/harvest";

/* ------------------------------------------------------------------ */
/* Test doubles                                                        */
/* ------------------------------------------------------------------ */

const RUN = "11111111-1111-4111-8111-111111111111";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

interface Recorded {
  board: string;
  status: string;
  count: number;
  reason: string | null;
}

/** Captures what the handler wrote to board_results, which is the §18 claim. */
function makeDeps(
  callBoard: Deps["callBoard"],
  opts: { userExists?: boolean } = {},
): { deps: Deps; written: Recorded[] } {
  const written: Recorded[] = [];
  const results: Record<string, unknown> = {};

  const deps = {
    prisma: {
      harvestRun: {
        findUnique: async () => ({ boardResults: results }),
        update: async ({ data }: { data: { boardResults: Record<string, Omit<Recorded, "board">> } }) => {
          for (const [board, r] of Object.entries(data.boardResults)) {
            const idx = written.findIndex((w) => w.board === board);
            const row: Recorded = { ...r, board };
            if (idx >= 0) written[idx] = row; else written.push(row);
            results[board] = r;
          }
          return {};
        },
      },
      user: {
        findUnique: async () => ((opts.userExists ?? true) ? { id: USER } : null),
      },
      // `upsert`, not `create` — the handler upserts on (userId, dedupeKey) so
      // a redelivery cannot duplicate rows (EC-P2-29). A mock missing it sends
      // every row into the per-row catch, which looks exactly like a board
      // returning nothing.
      job: {
        findFirst: async () => null,
        upsert: async () => ({}),
        update: async () => ({}),
      },
    },
    redis: { publish: async () => 0 },
    queue: { add: async () => ({}) },
    limiter: { acquire: async () => true },
    breaker: {
      state: async () => "closed",
      tryProbe: async () => true,
      recordFailure: async () => {},
      recordSuccess: async () => {},
    },
    callBoard,
  } as unknown as Deps;

  return { deps, written };
}

const job = (title: string) => ({
  source: "remoteok", title, company: "Acme",
  location: "Remote", link: `https://example.com/${title}`, posted_at: null,
});

const boardJob = (board: string) => ({
  runId: RUN, userId: USER, board, role: "engineer", location: null, limit: 10,
});

/* ------------------------------------------------------------------ */
/* §18 row 1 — One board down                                          */
/* ------------------------------------------------------------------ */

describe("§18 — One board down: the run continues and records why", () => {
  it("records failed + a reason when the board throws, without throwing itself", async () => {
    // P2.2.10's rule, which §18's first row depends on: a board failure is
    // DATA, not an exception. A throw here would fail a run that other boards
    // are succeeding in — turning a one-board outage into a total one.
    const { deps, written } = makeDeps(async () => {
      throw new Error("connect ETIMEDOUT");
    });

    await expect(handleHarvestBoard(deps, boardJob("naukri"))).resolves.toBeUndefined();

    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ board: "naukri", status: "failed", count: 0 });
    // "a reason", per the table — not just a failed flag.
    expect(written[0].reason).toContain("ETIMEDOUT");
  });

  it("records a board-level error response as data too", async () => {
    const { deps, written } = makeDeps(async () => ({
      jobs: [], partial: false, error: "403 Forbidden", response_bytes: 120,
    }));

    await handleHarvestBoard(deps, boardJob("wellfound"));
    expect(written[0]).toMatchObject({ status: "failed", reason: "403 Forbidden" });
  });

  it("a healthy board still delivers alongside a failed one", async () => {
    // The actual promise of row 1 — "other boards deliver". Both handlers run
    // against the same run, and the failure of one must not touch the other.
    const { deps, written } = makeDeps(async (board) => {
      if (board === "naukri") throw new Error("down");
      return { jobs: [job("a"), job("b")], partial: false, error: null, response_bytes: 900 };
    });

    await handleHarvestBoard(deps, boardJob("naukri"));
    await handleHarvestBoard(deps, boardJob("remoteok"));

    expect(written.find((w) => w.board === "naukri")).toMatchObject({ status: "failed" });
    expect(written.find((w) => w.board === "remoteok")).toMatchObject({ status: "ok", count: 2 });
  });
});

/* ------------------------------------------------------------------ */
/* §18 row 2 — All boards down                                         */
/* ------------------------------------------------------------------ */

describe("§18 — All boards down: the manual path stays open", () => {
  it("keeps POST /api/jobs/manual free of any board or queue dependency", async () => {
    // The row's claim is that discovery survives via "add a job by URL". That
    // is only true if the manual route does not itself depend on the machinery
    // that is down — which is a property of its imports, not of its logic.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(__dirname, "..", "..", "app", "api", "jobs", "route.ts"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    expect(source).not.toMatch(/callBoard|harvester|boards\//);
  });

  it("every board failing still leaves a complete, readable record", async () => {
    const { deps, written } = makeDeps(async () => {
      throw new Error("no route to host");
    });

    for (const board of ["naukri", "remoteok", "wellfound"]) {
      await handleHarvestBoard(deps, boardJob(board));
    }

    // Three rows, each with its own reason. A total outage must still be
    // legible — "everything failed" with no detail is where users give up.
    expect(written).toHaveLength(3);
    expect(written.every((w) => w.status === "failed" && w.reason)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* §18 rows 5-6 — Groq degradation                                     */
/* ------------------------------------------------------------------ */

describe("§18 — Groq down: Tier-0 still ranks every job", () => {
  it("scores without an LLM at all", async () => {
    // The row: "Tier-0 heuristic still ranks jobs". Tier 0 is deterministic and
    // costs zero tokens, so an LLM outage degrades ranking QUALITY without
    // removing ranking — which is the difference between a worse product and no
    // product.
    const { scoreTier0 } = await import("@/lib/scoring/tier0");

    const result = scoreTier0(
      {
        contact: { name: "Jordan", email: "j@example.com" },
        summary: "Backend engineer",
        skills: ["Python", "PostgreSQL", "Redis"],
        experience: [
          {
            company: "Brightwave",
            title: "Senior Software Engineer",
            startDate: "2021",
            endDate: "Present",
            bullets: ["Built Python services backed by PostgreSQL and Redis."],
          },
        ],
        // `buildResumeCorpus` iterates all three unconditionally, so a partial
        // fixture throws rather than scoring low. Present-and-empty is the
        // shape a parsed resume actually has.
        projects: [],
        education: [],
        certifications: [],
      } as never,
      {
        jobTitle: "Senior Backend Engineer",
        company: "Northstar",
        requiredSkills: ["Python", "Redis"],
        preferredSkills: [],
        responsibilities: [],
        qualifications: [],
      } as never,
    );

    expect(result.score).toBeGreaterThan(0);
    expect(Number.isFinite(result.score)).toBe(true);
    // And it explains itself without a model — the row promises ranking
    // survives, and an unexplained number is not what P4 calls a ranking.
    expect(result.matchedRequired).toContain("Python");
  });
});

/* ------------------------------------------------------------------ */
/* §18 row 7 — email rewrite falls back to the template                */
/* ------------------------------------------------------------------ */

describe("§18 — no LLM key: outreach falls back to the template", () => {
  it("the row now names Groq, the provider this platform actually calls", async () => {
    // EC-P7-15, resolved in the DOCUMENTATION rather than the code. §12.2
    // consolidated on Groq and explicitly said this collapses two provider rows
    // into one; §18 kept describing Anthropic, which nothing here has ever
    // called. This test pins the correction so the stale row cannot come back.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const arch = readFileSync(
      join(__dirname, "..", "..", "..", "..", "docs", "architecture.md"),
      "utf8",
    );

    // Scoped to the TABLE, not to §18 as a whole — §18.1 discusses the
    // correction by name, and a section-wide ban would fail on the prose
    // explaining the very fix it is checking for.
    const section = arch.slice(
      arch.indexOf("## 18. Failure Modes"),
      arch.indexOf("## 19."),
    );
    const table = section
      .split("\n")
      .filter((line) => line.startsWith("|"))
      .join("\n");

    expect(table).not.toMatch(/Anthropic/);
    expect(table).toMatch(/Groq down or no key \| email rewrite/);
  });
});

/* ------------------------------------------------------------------ */
/* §18 row 11 — ④ unreachable                                          */
/* ------------------------------------------------------------------ */

describe("§18 — ④ unreachable: tailoring and PDF export are unaffected", () => {
  it("the PDF renderer does not call the worker", async () => {
    // "they live in ①" is the claim, and it is an import-graph property.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(__dirname, "..", "..", "lib", "pdf", "renderer.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/worker-client|WORKER_SERVICE_URL/);
  });

  it("a worker transport failure is recorded per board, not thrown", async () => {
    // EC-P2-32/33 — ④ being unreachable looks exactly like a board being
    // unreachable from the run's point of view, which is what keeps the blast
    // radius at "harvest" rather than "the whole run".
    const { deps, written } = makeDeps(async () => {
      throw new Error("fetch failed: ECONNREFUSED");
    });

    await expect(handleHarvestBoard(deps, boardJob("remoteok"))).resolves.toBeUndefined();
    expect(written[0]).toMatchObject({ status: "failed" });
  });
});

/* ------------------------------------------------------------------ */
/* EC-P7-24 — deletion mid-flight                                      */
/* ------------------------------------------------------------------ */

describe("EC-P7-24 — an account deleted mid-harvest writes nothing", () => {
  it("returns without writing when the user vanished during the board call", async () => {
    // Not a §18 row, but the same class: state changed underneath a job that
    // was already in flight. Without the check, every insert fails on a missing
    // foreign key and BullMQ retries — re-scraping a live board for somebody
    // who deleted their account.
    const upsert = vi.fn(async () => ({}));
    const { deps, written } = makeDeps(
      async () => ({ jobs: [job("a")], partial: false, error: null, response_bytes: 100 }),
      { userExists: false },
    );
    (deps.prisma as unknown as { job: { upsert: unknown } }).job.upsert = upsert;

    await expect(handleHarvestBoard(deps, boardJob("remoteok"))).resolves.toBeUndefined();

    expect(upsert).not.toHaveBeenCalled();
    // And it did not record a bogus success for a user who no longer exists.
    expect(written.find((w) => w.status === "ok")).toBeUndefined();
  });
});
