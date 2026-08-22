/**
 * `?next=` cannot send a signed-in user off-origin.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE REDIRECT FIRES ON SUCCESS, WHICH IS WHAT MAKES IT WORTH TESTING.
 *
 * proxy.ts parks the requested path in `?next=` when it bounces an anonymous
 * visitor to sign-in, and both auth screens then navigate there once the
 * credentials check out — sign-in through router.push(), sign-up by assigning
 * window.location.href. Neither destination is anything the app chose: it
 * arrives in a URL, so it is whatever a link handed the user.
 *
 * Left unvalidated, `/sign-in?next=https://evil.example/login` walks the
 * browser to another origin at the precise moment the user has proved the site
 * is real and is primed to type the same password again. The phishing page
 * inherits the credibility of a sign-in that genuinely worked.
 *
 * The cases below are the ones a `startsWith("/")` check alone gets wrong:
 * `//host` and `/\host` both begin with a slash and are both read by browsers
 * as the start of an authority, not a path.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from "vitest";

import { safeNextPath } from "@/lib/auth/next-path";

describe("safeNextPath", () => {
  it("keeps same-origin paths, which is the whole point of the parameter", () => {
    expect(safeNextPath("/tailor", "/jobs")).toBe("/tailor");
    expect(safeNextPath("/jobs?tab=saved", "/jobs")).toBe("/jobs?tab=saved");
    expect(safeNextPath("/tracker/abc123", "/jobs")).toBe("/tracker/abc123");
  });

  it("falls back when there is nothing to honour", () => {
    expect(safeNextPath(null, "/jobs")).toBe("/jobs");
    expect(safeNextPath(undefined, "/jobs")).toBe("/jobs");
    expect(safeNextPath("", "/jobs")).toBe("/jobs");
  });

  it("refuses absolute URLs", () => {
    expect(safeNextPath("https://evil.example/login", "/jobs")).toBe("/jobs");
    expect(safeNextPath("http://evil.example", "/jobs")).toBe("/jobs");
    expect(safeNextPath("javascript:alert(1)", "/jobs")).toBe("/jobs");
  });

  it("refuses the slash-prefixed forms that still resolve to another host", () => {
    // Protocol-relative: the browser reads `evil.example` as the host.
    expect(safeNextPath("//evil.example", "/jobs")).toBe("/jobs");
    expect(safeNextPath("//evil.example/path", "/jobs")).toBe("/jobs");
    // Backslash: normalised to `//` by several browsers before navigation.
    expect(safeNextPath("/\\evil.example", "/jobs")).toBe("/jobs");
  });

  it("refuses relative paths, which resolve against the current directory", () => {
    expect(safeNextPath("tailor", "/jobs")).toBe("/jobs");
    expect(safeNextPath("../admin", "/jobs")).toBe("/jobs");
  });
});
