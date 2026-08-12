/**
 * Dedupe key behaviour (P2.2.6).
 *
 * The two failure directions are NOT symmetric:
 *   under-merging shows a duplicate  — visible, annoying, harmless
 *   over-merging  hides a real job   — silent, and the user never knows
 * These tests pin that asymmetry.
 */
import { describe, it, expect } from "vitest";

import { dedupeKey, normaliseCompany, normalise } from "../../../../services/orchestrator/lib/dedupe";

describe("company normalisation (EC-P2-17)", () => {
  it("strips legal suffixes so boards agree", () => {
    expect(normaliseCompany("Google Pvt Ltd")).toBe("google");
    expect(normaliseCompany("Google Inc.")).toBe("google");
    expect(normaliseCompany("Acme AI Private Limited")).toBe("acme ai");
  });

  it("strips stacked suffixes", () => {
    expect(normaliseCompany("Foo Technologies Pvt. Ltd.")).toBe("foo technologies");
  });

  it("EC-P2-22: folds unicode, emoji and non-breaking spaces", () => {
    expect(normaliseCompany("Acme AI \u{1F680}")).toBe("acme ai");
  });

  it("does NOT strip geographic qualifiers", () => {
    // "Google India" may be a genuinely separate employer. Stripping it would
    // over-merge, and over-merging silently hides a real job.
    expect(normaliseCompany("Google India Pvt Ltd")).not.toBe("google");
  });
});

describe("dedupeKey", () => {
  it("EC-P2-18: same title at same company in different cities stays SEPARATE", () => {
    const a = dedupeKey({ company: "Acme", title: "AI Engineer", location: "Bengaluru" });
    const b = dedupeKey({ company: "Acme", title: "AI Engineer", location: "Hyderabad" });
    expect(a).not.toBe(b);
  });

  it("EC-P2-25: seniority is part of the title, not noise", () => {
    const a = dedupeKey({ company: "A", title: "Engineer", location: null });
    const b = dedupeKey({ company: "A", title: "Senior Engineer", location: null });
    expect(a).not.toBe(b);
  });

  it("EC-P2-20: a null location becomes 'remote', never an empty segment", () => {
    // An empty segment would make every location-less row collide.
    expect(dedupeKey({ company: "A", title: "B", location: null })).toBe("a|b|remote");
    expect(dedupeKey({ company: "A", title: "B", location: "" })).toBe("a|b|remote");
  });

  it("EC-P2-21: a multi-city string is ONE job, never split", () => {
    const k = dedupeKey({ company: "A", title: "B", location: "Hyderabad, Pune, Bengaluru" });
    expect(k).toBe("a|b|hyderabad pune bengaluru");
  });

  it("the same job from two boards collapses", () => {
    const naukri = dedupeKey({ company: "Acme AI Pvt Ltd", title: "AI Engineer", location: "Bengaluru" });
    const remoteok = dedupeKey({ company: "acme ai", title: "AI  Engineer", location: " bengaluru " });
    expect(naukri).toBe(remoteok);
  });

  it("normalise handles null/undefined without throwing", () => {
    expect(normalise(null)).toBe("");
    expect(normalise(undefined)).toBe("");
  });
});
