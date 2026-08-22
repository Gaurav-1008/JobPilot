/**
 * P7.3.3 — bounded label cardinality, asserted (EC-P7-20, EC-P7-21).
 *
 * Exit checklist: "no metric label carries an ID". The test that matters is the
 * adversarial one — pass an id where a board name belongs and confirm the
 * registry does not grow a series per id.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  dependencyState,
  guardrailBlock,
  harvestBoardOutcome,
  hydrationOutcome,
  interlockBlock,
  jdCacheLookup,
  llmTokens,
  llmValidationRetry,
  outreachOutcome,
  renderPrometheus,
  __counter,
  __resetMetrics,
} from "@/lib/obs/metrics";
import { __safeKeys } from "@/lib/obs/redact";

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

describe("every metric label survives the log serializer", () => {
  /**
   * The coupling nothing enforced, and it broke in production.
   *
   * `increment()` spreads its label map into a structured log line, and that
   * line goes through the allow-list serializer (EC-P7-17). A label name that
   * is not on the allow-list is emitted as "[redacted]" — so the counter is
   * still correct in the registry and in /api/metrics, while the LOG transport
   * ships a sample with no dimensions at all.
   *
   * It showed up in a real dev log as:
   *   {"event":"dependency_state_total","dependency":"[redacted]",
   *    "state":"[redacted]","count":1}
   *
   * Six of the twelve label names were missing. Until a TSDB is provisioned
   * (§22.3) these log lines ARE the collector path, so half the §16.2 set was
   * shipping nothing usable.
   *
   * This test derives the label names from what the metrics module ACTUALLY
   * emits rather than from a hand-maintained list, so adding a metric with a
   * new label fails here until the allow-list learns about it.
   */
  it("allow-lists every label name emitted by the §16.2 set", () => {
    __resetMetrics();

    // One sample of every metric, so the registry holds the full label surface.
    harvestBoardOutcome("remoteok", "ok");
    hydrationOutcome("firecrawl", "ok");
    jdCacheLookup("hit");
    llmValidationRetry("score_cheap");
    guardrailBlock("word_limit");
    interlockBlock("opt_out");
    outreachOutcome("smtp", "ok");
    llmTokens("cheap", "llama-3.1-8b-instant", 100);
    dependencyState("redis", "up");

    const labelNames = new Set<string>();
    for (const line of renderPrometheus().split("\n")) {
      const inner = /\{([^}]*)\}/.exec(line);
      if (!inner) continue;
      for (const pair of inner[1].split(",")) {
        const name = pair.split("=")[0]?.trim();
        if (name) labelNames.add(name);
      }
    }

    expect(labelNames.size).toBeGreaterThan(0);
    const safe = __safeKeys();
    const missing = [...labelNames].filter((n) => !safe.has(n)).sort();

    expect(
      missing,
      `these metric labels would log as "[redacted]": ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("uses promptName, never prompt, as a label", () => {
    // `prompt` is forbidden by the allow-list on purpose: as a label it means
    // WHICH prompt, but as a log key it reads as the prompt TEXT. Renaming the
    // label was the fix; weakening the forbidden list was not.
    __resetMetrics();
    llmValidationRetry("score_cheap");

    const text = renderPrometheus();
    expect(text).toContain('promptName="score_cheap"');
    expect(text).not.toMatch(/[{,]prompt=/);
  });
});
