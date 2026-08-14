/**
 * The application status machine (P6.1.3, EC-P6-01/02/03).
 *
 * Written after the audit caught the bug live: a real application that had
 * reached `emailed` was showing as `tailored` again, because
 * `finaliseTailoredScore` wrote `status: "tailored"` unconditionally on its
 * UPDATE branch. Re-tailoring dragged the funnel backwards, and a manually set
 * `rejected` would have been erased outright.
 *
 * The rules are asymmetric on purpose, and that asymmetry is the whole point:
 * the PIPELINE may only advance; a HUMAN may set anything.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const APP = "11111111-1111-4111-8111-111111111111";

const db = vi.hoisted(() => ({ apps: [] as Record<string, unknown>[] }));

const RANK: Record<string, number> = {
  saved: 0, scored: 1, tailored: 2, contact_added: 3, emailed: 4,
};
const TERMINAL = ["replied", "interviewing", "rejected", "closed"];

vi.mock("@/lib/db/client", () => ({
  prisma: {
    application: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        db.apps.find((a) => a.id === where.id && a.userId === where.userId) ?? null,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const app = db.apps.find((a) => a.id === where.id && a.userId === where.userId);
        if (!app) return { count: 0 };
        Object.assign(app, data);
        return { count: 1 };
      },
    },
    /** Models the conditional UPDATE, including both guards in the real SQL. */
    $queryRaw: async (_s: TemplateStringsArray, ...values: unknown[]) => {
      const [target, id, userId, nextRank] = values as [string, string, string, number];
      const app = db.apps.find((a) => a.id === id && a.userId === userId);
      if (!app) return [];
      if (TERMINAL.includes(app.status as string)) return [];
      if ((RANK[app.status as string] ?? 99) >= nextRank) return [];
      app.status = target;
      return [{ status: target }];
    },
  },
}));

import {
  advanceApplicationStatus,
  setApplicationStatusManually,
} from "@/lib/db/stores/tracker";

const seed = (status: string) => {
  db.apps = [{ id: APP, userId: USER, status }];
};

beforeEach(() => seed("saved"));

describe("automatic transitions only advance (EC-P6-02)", () => {
  it("moves forward through the funnel", async () => {
    for (const [from, to] of [
      ["saved", "scored"], ["scored", "tailored"],
      ["tailored", "contact_added"], ["contact_added", "emailed"],
    ]) {
      seed(from);
      expect(await advanceApplicationStatus(APP, USER, to)).toBe(to);
    }
  });

  it("does NOT drag an emailed application back to tailored", async () => {
    // The exact bug found on live data: re-tailoring after a draft was created.
    seed("emailed");
    expect(await advanceApplicationStatus(APP, USER, "tailored")).toBe("emailed");
    expect(db.apps[0].status).toBe("emailed");
  });

  it("does NOT drag an emailed application back to scored on a re-harvest", async () => {
    seed("emailed");
    expect(await advanceApplicationStatus(APP, USER, "scored")).toBe("emailed");
  });

  it("is idempotent — advancing to the current status changes nothing", async () => {
    seed("tailored");
    expect(await advanceApplicationStatus(APP, USER, "tailored")).toBe("tailored");
  });
});

describe("manual terminal statuses are sticky (EC-P6-01)", () => {
  it.each(TERMINAL)("no pipeline event overwrites %s", async (status) => {
    // A user marks it rejected, then re-tailors out of curiosity. Their record
    // of the rejection must survive — erasing it is worse than any stale score.
    seed(status);
    for (const target of ["scored", "tailored", "contact_added", "emailed"]) {
      expect(await advanceApplicationStatus(APP, USER, target)).toBe(status);
    }
    expect(db.apps[0].status).toBe(status);
  });
});

describe("the user is not constrained by rank (EC-P6-04/05)", () => {
  it("may move an application backwards", async () => {
    seed("emailed");
    await setApplicationStatusManually(APP, USER, "saved");
    expect(db.apps[0].status).toBe("saved");
  });

  it("may mark emailed with no attempt on file", async () => {
    // People email outside the app. The timeline distinguishes it by showing
    // no attempts, rather than the status pretending it never happened.
    seed("tailored");
    await setApplicationStatusManually(APP, USER, "emailed");
    expect(db.apps[0].status).toBe("emailed");
  });

  it("may undo their own terminal status", async () => {
    seed("rejected");
    await setApplicationStatusManually(APP, USER, "interviewing");
    expect(db.apps[0].status).toBe("interviewing");
  });
});

describe("tenant scoping", () => {
  it("will not advance another user's application", async () => {
    seed("saved");
    expect(await advanceApplicationStatus(APP, "someone-else", "emailed")).toBeNull();
    expect(db.apps[0].status).toBe("saved");
  });
});
