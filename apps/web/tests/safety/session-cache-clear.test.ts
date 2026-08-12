/**
 * EC-P1-01 — signing out must not leave the previous user's data in the browser.
 *
 * This is the leak that looks like it cannot happen: the server is correct
 * throughout, every query is tenant-scoped, and no request is ever mis-scoped.
 * The data is simply still sitting in client caches.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import { setRun, getSnapshot, clearRun } from "@/lib/run-view-store";
import type { TailoringRun } from "@/lib/schemas";

describe("sign-out clears client state (EC-P1-01)", () => {
  beforeEach(() => clearRun());

  it("the view store holds a run while signed in", () => {
    setRun({ id: "run-a" } as unknown as TailoringRun);
    expect(getSnapshot()).not.toBeNull();
  });

  it("clearRun() empties it, so the next user sees nothing", () => {
    setRun({ id: "run-a" } as unknown as TailoringRun);
    clearRun();
    expect(getSnapshot()).toBeNull();
  });

  it("queryClient.clear() drops cached data — invalidate would refetch it", () => {
    const qc = new QueryClient();
    qc.setQueryData(["resumes"], [{ id: "alice-resume" }]);
    expect(qc.getQueryData(["resumes"])).toBeDefined();

    qc.clear();
    // invalidateQueries() would mark it stale and REFETCH, briefly rendering
    // the previous user's data and issuing requests as the wrong identity.
    expect(qc.getQueryData(["resumes"])).toBeUndefined();
  });
});
