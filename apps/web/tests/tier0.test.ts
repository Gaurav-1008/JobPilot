/**
 * Tier-0 heuristic scoring (P4.1.1/P4.1.2).
 *
 * EC-P4-01 — this scorer is built on lib/scoring.ts (`computeSignals`), NOT on
 * lib/heuristic-resume.ts. That file is 51 lines of display-only section
 * splitting with no scoring capability; the plan named the wrong target.
 */
import { describe, it, expect } from "vitest";

import { scoreTier0, DEFAULT_TIER0_FLOOR } from "@/lib/scoring/tier0";
import type { JobDescriptionProfile, ResumeProfile } from "@/lib/schemas";

const resume = {
  contact: { name: "Demo", email: "d@example.com" },
  summary: "Backend engineer focused on retrieval and evaluation.",
  skills: ["Python", "PostgreSQL", "retrieval pipelines", "evaluation harnesses"],
  experience: [{
    company: "Example Corp", title: "Senior Backend Engineer",
    startDate: "2023", endDate: "2025",
    bullets: ["Built a document retrieval pipeline serving 40k queries/month"],
  }],
  projects: [], education: [], certifications: [],
} as unknown as ResumeProfile;

const jd = (over: Partial<JobDescriptionProfile> = {}) => ({
  jobTitle: "Senior Backend Engineer",
  company: "Acme",
  requiredSkills: ["Python", "PostgreSQL"],
  preferredSkills: [],
  responsibilities: [],
  qualifications: [],
  tools: [],
  keywords: ["Python"],
  seniorityLevel: "senior",
  domainSignals: [],
  ...over,
} as unknown as JobDescriptionProfile);

describe("scoreTier0", () => {
  it("scores a strong match highly", () => {
    expect(scoreTier0(resume, jd()).score).toBeGreaterThan(70);
  });

  it("scores an unrelated job low", () => {
    const s = scoreTier0(resume, jd({
      jobTitle: "Dental Hygienist",
      requiredSkills: ["Dental radiography", "Periodontal charting"],
      keywords: ["dentistry"],
      seniorityLevel: null as never,
    }));
    expect(s.score).toBeLessThan(DEFAULT_TIER0_FLOOR + 25);
  });

  it("ranks a closer match above a weaker one", () => {
    const strong = scoreTier0(resume, jd());
    const weak = scoreTier0(resume, jd({ requiredSkills: ["Rust", "Kubernetes"], keywords: ["rust"] }));
    expect(strong.score).toBeGreaterThan(weak.score);
  });

  it("EC-P4-05: a JD with NO extractable requirements scores 0, not a guess", () => {
    // EC-P3-26 lets an empty-profile JD exist. Inventing a number for it would
    // put a meaningless score in the ranking.
    const s = scoreTier0(resume, jd({ requiredSkills: [], keywords: [] }));
    expect(s.score).toBe(0);
  });

  it("EC-P4-04: a resume that failed to parse does not divide by zero", () => {
    const empty = { ...resume, skills: [], experience: [], summary: "" } as unknown as ResumeProfile;
    expect(() => scoreTier0(empty, jd())).not.toThrow();
    expect(scoreTier0(empty, jd()).score).toBeGreaterThanOrEqual(0);
  });

  it("reports matched and missing requirements for explainability", () => {
    const s = scoreTier0(resume, jd({ requiredSkills: ["Python", "Kubernetes"] }));
    expect(s.matchedRequired).toContain("Python");
    expect(s.missingRequired).toContain("Kubernetes");
  });

  it("unknown seniority on either side is NEUTRAL, not a mismatch", () => {
    // Absence of evidence is not evidence of mismatch.
    const s = scoreTier0(resume, jd({ seniorityLevel: null as never }));
    expect(s.seniorityMatch).toBe(50);
  });

  it("every score stays within 0-100", () => {
    for (const j of [jd(), jd({ requiredSkills: [] }), jd({ jobTitle: "" })]) {
      const s = scoreTier0(resume, j);
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
    }
  });
});
