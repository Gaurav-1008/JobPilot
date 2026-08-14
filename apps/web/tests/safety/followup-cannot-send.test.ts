/**
 * The follow-up sweep must never be able to send — EC-P6-13.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS IS PHASE 6'S DEFINING CONSTRAINT.
 *
 * The sweep is the only scheduled, unattended thing in the product that touches
 * the outreach path. If it can ever deliver, JobPilot stops being a tool that
 * helps someone write an email and becomes an automated cold-email engine —
 * exactly what problemStatement.md §12.3 was written to prevent.
 *
 * The exit checklist asks for this "asserted in a test, not by inspection",
 * because a reviewer's promise decays and an import graph does not. So this
 * reads the actual source of the sweep and its route and fails on any path to
 * delivery, whatever a future edit intends.
 *
 * A convenience feature — "auto-send follow-ups when the user opts in" — is the
 * realistic way this gets broken. It would look reasonable in review. It fails
 * here.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
// BOTH halves. The sweep was split during Phase 6 — the P0.3.4 lint rule
// confines the Prisma client to lib/db — so the selection logic now lives in a
// store while lib/outreach keeps the orchestration. The guarantee has to hold
// wherever the code sits, and a test pinned to one path would have gone quietly
// green against a file that no longer contained anything.
const SWEEP_STORE = join(ROOT, "lib", "db", "stores", "followups.ts");
const SWEEP = join(ROOT, "lib", "outreach", "followup-sweep.ts");
const ROUTE = join(ROOT, "app", "api", "outreach", "followups", "route.ts");

/**
 * Source with comments removed.
 *
 * These files DOCUMENT the constraint at length — "must never import the
 * delivery module", "there is no IMAP connection anywhere" — so a naive grep
 * matches the prose explaining the rule and fails on files that obey it. The
 * first version of this test did exactly that.
 *
 * Stripping comments makes the assertions about CODE, which is the only thing
 * that can actually send an email.
 */
const source = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments, including the headers
    .replace(/^\s*\/\/.*$/gm, "");      // line comments

/** Just the object literal handed to `prisma.*.create({ data: … })`. */
function createdRow(code: string): string {
  const at = code.indexOf("data: {");
  return at === -1 ? "" : code.slice(at, code.indexOf("},", at));
}

describe("the sweep cannot reach the provider (EC-P6-13)", () => {
  it("does not import the interlock chain or the delivery client", () => {
    const sweep = source(SWEEP) + source(SWEEP_STORE);

    // runInterlocks + burnToken + deliver are the three steps of a send. The
    // sweep needs none of them; it writes a `generated` row and stops.
    expect(sweep).not.toMatch(/from\s+["'].*interlocks["']/);
    expect(sweep).not.toMatch(/burnToken/);
    expect(sweep).not.toMatch(/\bdeliver\b/);
    expect(sweep).not.toMatch(/worker-client/);
  });

  it("never writes a status other than `generated`", () => {
    // Scoped to the CREATE payload, not the whole file: the sweep legitimately
    // FILTERS on status 'sent' when selecting parents (EC-P6-11), and a
    // file-wide regex cannot tell a query predicate from a write.
    const written = createdRow(source(SWEEP_STORE));

    expect(written).toMatch(/status:\s*["']generated["']/);
    expect(written).not.toMatch(/status:\s*["'](sent|drafted)["']/);
    // provider 'dry_run' on a row nothing will deliver is not a placeholder;
    // it is the guarantee stated in data.
    expect(written).toMatch(/provider:\s*["']dry_run["']/);
  });

  it("the route that runs it does not call the delivery endpoint", () => {
    const route = source(ROUTE);

    expect(route).not.toMatch(/\/deliver/);
    expect(route).not.toMatch(/runInterlocks/);
    expect(route).not.toMatch(/burnToken/);
    // It may call ④ to GENERATE — that is the point — but not to deliver.
    expect(route).toMatch(/generateEmail/);
    expect(route).not.toMatch(/\bdeliver\s*[,(]/);
  });

  it("no delivery import survives anywhere in the sweep's own module graph", () => {
    // A transitive import is the subtler failure: the sweep importing a helper
    // that itself imports delivery would pass a check on this file alone.
    const orchestration = [...source(SWEEP).matchAll(/from\s+["']([^"']+)["']/g)]
      .map((m) => m[1]);
    const store = [...source(SWEEP_STORE).matchAll(/from\s+["']([^"']+)["']/g)]
      .map((m) => m[1]);

    // Both are deliberately near-dependency-free. If that changes, this forces
    // a deliberate look at whatever was added rather than a silent widening.
    expect(orchestration).toEqual(["@/lib/db/stores/followups"]);
    expect(store).toEqual(["../client"]);
  });
});

describe("the sweep's selection rules", () => {
  it("keys off a SENT attempt, never the application status (EC-P6-11)", () => {
    const sweep = source(SWEEP_STORE);

    // applications.status='emailed' includes drafts the user never sent.
    // Following up on an unsent email is the worst thing this feature can do.
    expect(sweep).toMatch(/status:\s*["']sent["']/);
    expect(sweep).not.toMatch(/status:\s*["']emailed["']/);
  });

  it("does not claim to detect replies (EC-P6-12)", () => {
    // No IMAP, no webhook, no inbox read exists anywhere in this architecture,
    // so the user-facing wording must describe what the system can actually
    // know: whether THEY recorded a response.
    expect(source(ROUTE)).toMatch(/no response recorded/i);

    // And no code here pretends otherwise. Comments are stripped, so this is
    // about calls and identifiers rather than the prose explaining the gap.
    expect(source(SWEEP) + source(SWEEP_STORE)).not.toMatch(/imap|webhook|readInbox/i);
  });
});
