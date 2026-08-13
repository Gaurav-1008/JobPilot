/**
 * Address normalization (P5.1.1).
 *
 * These cases are the load-bearing ones: every assertion here corresponds to a
 * way an un-normalized address silently defeats opt-out, dedup, or the volume
 * cap at send time.
 */

import { describe, expect, it } from "vitest";

import {
  displayEmail,
  domainKey,
  normalizeEmail,
  normalizeOptOutEntry,
} from "@/lib/outreach/email-address";

describe("normalizeEmail", () => {
  it("strips surrounding whitespace (EC-P5-01)", () => {
    expect(normalizeEmail("  priya@example.com  ")).toBe("priya@example.com");
  });

  it("unwraps the mailto: prefix (EC-P5-01)", () => {
    expect(normalizeEmail("mailto:priya@example.com")).toBe("priya@example.com");
    expect(normalizeEmail("MAILTO:priya@example.com")).toBe("priya@example.com");
  });

  it("unwraps the display-name form (EC-P5-01)", () => {
    expect(normalizeEmail("Priya <priya@example.com>")).toBe("priya@example.com");
    expect(normalizeEmail('"Doe, Jane" <jane@example.com>')).toBe("jane@example.com");
  });

  it("lowercases the domain but preserves local-part case (EC-P5-01)", () => {
    expect(normalizeEmail("Priya.K@Example.COM")).toBe("Priya.K@example.com");
  });

  it("preserves plus-addressing (EC-P5-02)", () => {
    // Stripping the tag would make an opt-out on careers@ suppress careers+jobs@,
    // which the user never asked for.
    expect(normalizeEmail("careers+jobs@example.com")).toBe("careers+jobs@example.com");
  });

  it("normalizes an IDN domain to punycode for comparison (EC-P5-03)", () => {
    const normalized = normalizeEmail("priya@bücher.example");
    expect(normalized).toBe("priya@xn--bcher-kva.example");
    // Two spellings of the same domain must collapse to one comparison key,
    // or opt-out matching depends on which one the user happened to type.
    expect(normalizeEmail("priya@xn--bcher-kva.example")).toBe(normalized);
  });

  it("round-trips an IDN domain back to unicode for display (EC-P5-03)", () => {
    expect(displayEmail("priya@xn--bcher-kva.example")).toBe("priya@bücher.example");
  });

  it("rejects obviously invalid addresses (EC-P5-04)", () => {
    for (const bad of [
      "priya@",
      "@example.com",
      "not an email",
      "",
      "   ",
      "priya@localhost",
      "priya@@example.com",
      "priya@.example.com",
      "priya@example..com",
      "two@addresses.com three@addresses.com",
    ]) {
      expect(normalizeEmail(bad), bad).toBeNull();
    }
  });

  it("accepts an address at the 320-character RFC ceiling (EC-P5-05)", () => {
    const local = "a".repeat(64);
    const domain = `${"b".repeat(60)}.${"c".repeat(60)}.example.com`;
    const address = `${local}@${domain}`;
    expect(address.length).toBeLessThanOrEqual(320);
    expect(normalizeEmail(address)).toBe(address);
  });

  it("rejects a local part over 64 characters", () => {
    expect(normalizeEmail(`${"a".repeat(65)}@example.com`)).toBeNull();
  });

  it("allows the user's own address (EC-P5-06)", () => {
    // The documented self-test path from The Closer's runbook. Blocking it
    // removes the only safe way to exercise delivery end to end.
    expect(normalizeEmail("me@example.com")).toBe("me@example.com");
  });
});

describe("normalizeOptOutEntry", () => {
  it("accepts a whole domain (EC-P5-16)", () => {
    expect(normalizeOptOutEntry("@Company.com")).toBe("@company.com");
    expect(normalizeOptOutEntry("  @company.com ")).toBe("@company.com");
  });

  it("accepts a single address", () => {
    expect(normalizeOptOutEntry("Priya@Example.com")).toBe("Priya@example.com");
  });

  it("rejects a bare domain with no dot", () => {
    expect(normalizeOptOutEntry("@localhost")).toBeNull();
  });

  it("derives the domain key an address is suppressed by", () => {
    expect(domainKey("priya@company.com")).toBe("@company.com");
  });
});
