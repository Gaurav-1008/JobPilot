/**
 * The approve gate must be perceivable, not just reachable — EC-P7-07, P7.1.7.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY AN ACCESSIBILITY REQUIREMENT IS IN THE SAFETY SUITE.
 *
 * The review screen is the human gate (§14.1, "the structural upgrade"). The
 * whole outreach design rests on a person seeing what the system found and then
 * deciding. If the approve control is reachable by keyboard but the warnings
 * are never announced, then for that user the gate is decorative: they approve
 * an email whose problems were detected and withheld.
 *
 * That is a safety property, so it is tested next to the interlocks rather than
 * filed under polish — and it is tested structurally, because the failure mode
 * is a future edit that reorders the page or drops a role attribute, which no
 * amount of care at review time prevents.
 *
 * TESTED FROM SOURCE, deliberately. The project has no jsdom or testing-library
 * dependency and no component tests; adding a browser test stack to assert
 * static markup would be a large amount of machinery for a property that IS
 * static. The panels are not conditionally reordered — their position in the
 * file is their position in the DOM and therefore in the focus order — so
 * reading the source answers the question exactly. This is the same idiom
 * tests/safety/followup-cannot-send.test.ts uses for the same reason.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const REVIEW_PAGE = join(
  __dirname, "..", "..", "app", "(dashboard)", "outreach", "[appId]", "page.tsx",
);

const source = readFileSync(REVIEW_PAGE, "utf8");

/** Index of the first match, or -1. Used to compare document positions. */
function at(pattern: RegExp): number {
  return source.search(pattern);
}

describe("EC-P7-07 — warnings precede the approve control in DOM order", () => {
  it("renders every warning panel before the Approve button", () => {
    // The ordering property. It cannot be recovered with CSS, because CSS does
    // not move the focus order — a visually-repositioned warning is still
    // announced after the button that it is warning about.
    const approve = at(/onClick=\{approve\}/);
    expect(approve).toBeGreaterThan(-1);

    for (const panel of [/id="warn-length"/, /id="warn-grounding"/, /id="warn-flags"/]) {
      const position = at(panel);
      expect(position, `${panel} must exist`).toBeGreaterThan(-1);
      expect(position, `${panel} must precede the approve control`).toBeLessThan(approve);
    }
  });

  it("marks the blocking panels as alerts so late-arriving findings are announced", () => {
    // Findings arrive after generation returns, i.e. after page load. Without a
    // live region that content is silent for a screen-reader user while being
    // obvious to a sighted one — the exact asymmetry this edge case is about.
    expect(source).toMatch(/id="warn-length"[\s\S]{0,80}role="alert"/);
    expect(source).toMatch(/id="warn-grounding"[\s\S]{0,80}role="alert"/);
  });

  it("keeps advisory flags polite rather than assertive", () => {
    // If every soft flag interrupted, users would learn to tune out the region
    // that also carries the blocking ones. Severity has to mean something.
    expect(source).toMatch(/id="warn-flags"[\s\S]{0,80}role="status"/);
  });

  it("describes the approve control with the warnings", () => {
    // So tabbing to Approve restates the risk at the moment of decision, not
    // only when the panel first appeared.
    const describedBy = /aria-describedby="([^"]+)"/.exec(source);
    expect(describedBy, "the approve control needs aria-describedby").not.toBeNull();
    for (const id of ["warn-length", "warn-grounding", "warn-flags"]) {
      expect(describedBy![1]).toContain(id);
    }
  });

  it("states in text why approving is unavailable", () => {
    // A disabled control whose only signal is reduced opacity tells a
    // screen-reader user nothing and everyone else very little.
    expect(source).toContain('id="approve-hint"');
    expect(source).toMatch(/Approving is unavailable until/);
  });

  it("gives the gate controls a visible focus indicator", () => {
    // A keyboard user must be able to see which control they are about to
    // activate. This matters most on exactly these two buttons.
    const approveBlock = source.slice(at(/onClick=\{approve\}/), at(/onClick=\{approve\}/) + 700);
    expect(approveBlock).toMatch(/focus-visible:outline/);
  });
});

describe("EC-P7-08 — risk is visible at the action, not only above it", () => {
  it("summarises findings immediately before the button row", () => {
    // The warning panels are separated from the buttons by a 14-row textarea.
    // On a phone that means the reasons not to approve have scrolled away by
    // the time Approve is on screen.
    const summary = at(/details above/);
    const approve = at(/onClick=\{approve\}/);
    expect(summary).toBeGreaterThan(-1);
    expect(summary).toBeLessThan(approve);

    // And it must be close to the control — a summary that is itself a screen
    // away has not solved anything.
    expect(approve - summary).toBeLessThan(1_500);
  });
});

describe("EC-P7-23 — the platform's send policy is stated before the work", () => {
  it("renders the platform dry-run reason on the review screen", () => {
    expect(source).toContain("platformDryRunReason");
    const notice = at(/draft\.platformDryRunReason &&/);
    expect(notice).toBeGreaterThan(-1);
    expect(notice).toBeLessThan(at(/onClick=\{approve\}/));
  });
});
