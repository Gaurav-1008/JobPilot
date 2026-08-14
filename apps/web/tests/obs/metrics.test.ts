/**
 * P7.3.3 — bounded label cardinality, asserted (EC-P7-20, EC-P7-21).
 *
 * Exit checklist: "no metric label carries an ID". The test that matters is the
 * adversarial one — pass an id where a board name belongs and confirm the
 * registry does not grow a series per id.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  guardrailBlock,
  harvestBoardOutcome,
  interlockBlock,
  llmTokens,
  renderPrometheus,
  __counter,
  __resetMetrics,
} from "@/lib/obs/metrics";

beforeEach(() => __resetMetrics());

describe("EC-P7-20 — label values are bounded", () => {
  it("collapses an id passed where a board name belongs", () => {
    // The accident: `{ board: job.id }`. One series per job, forever.
    harvestBoardOutcome("3f7c2a10-9b41-4d2e-8a55-0c1d2e3f4a5b", "failed");
    harvestBoardOutcome("9a1b2c30-1111-2222-3333-444455556666", "failed");

    expect(__counter("harvest_board_outcome_total", { board: "other", status: "failed" }))
      .toBe(2);
    // Two calls with different ids produced ONE series, not two.
    expect(renderPrometheus().split("\n").filter((l) => l.startsWith("harvest_board_outcome_total")))
      .toHaveLength(1);
  });

  it("keeps declared board names", () => {
    harvestBoardOutcome("remoteok", "ok");
    expect(__counter("harvest_board_outcome_total", { board: "remoteok", status: "ok" })).toBe(1);
  });

  it("collapses an email address used as a label", () => {
    guardrailBlock("dana@example.com");
    expect(__counter("guardrail_block_total", { type: "other" })).toBe(1);
    expect(renderPrometheus()).not.toContain("dana@example.com");
  });

  it("never lets an id reach the rendered exposition", () => {
    const id = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
    harvestBoardOutcome(id, id);
    guardrailBlock(id);
    interlockBlock(id);
    llmTokens(id, id, 10);
    expect(renderPrometheus()).not.toContain(id);
  });

  it("normalizes a model id rather than trusting it whole", () => {
    llmTokens("full", "llama-3.3-70b-versatile", 500);
    expect(__counter("llm_tokens_total", { tier: "full", model: "llama-3.3-70b-versatile" }))
      .toBe(500);
  });
});

describe("EC-P7-21 — routine blocks are separable from faults", () => {
  it("classes opt-out and dedup as the system working", () => {
    interlockBlock("opt_out");
    interlockBlock("dedup");
    expect(__counter("interlock_block_total", { check: "opt_out", class: "expected" })).toBe(1);
    expect(__counter("interlock_block_total", { check: "dedup", class: "expected" })).toBe(1);
  });

  it("classes token and body-hash failures as faults worth paging on", () => {
    // These mean a bug or an attack. If they shared a series with the noisy
    // expected blocks, muting the noise would mute the attack signal too.
    interlockBlock("approval_token");
    interlockBlock("body_integrity");
    expect(__counter("interlock_block_total", { check: "approval_token", class: "fault" })).toBe(1);
    expect(__counter("interlock_block_total", { check: "body_integrity", class: "fault" })).toBe(1);
  });

  it("defaults an unrecognised check to fault, not to expected", () => {
    // Fail toward paging. An unknown block is more likely a new bug than a new
    // routine outcome, and the cost of a spurious page is lower than the cost
    // of a silent one.
    interlockBlock("something_new");
    expect(__counter("interlock_block_total", { check: "other", class: "fault" })).toBe(1);
  });
});

describe("exposition", () => {
  it("renders Prometheus text with sorted, quoted labels", () => {
    harvestBoardOutcome("remoteok", "ok");
    const text = renderPrometheus();
    expect(text).toContain("# TYPE harvest_board_outcome_total counter");
    expect(text).toContain('harvest_board_outcome_total{board="remoteok",status="ok"} 1');
  });

  it("renders empty when nothing has been counted", () => {
    expect(renderPrometheus()).toBe("");
  });
});
