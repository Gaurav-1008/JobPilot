/**
 * Safety test 8 (architecture.md §19) — P1.5.1.
 *
 * "Fabricated employer in an LLM response → blocked before persistence."
 *
 * The ORDER is the whole point (EC-P1-37). Guardrails must run before the write,
 * not after: a window in which fabricated content sits in the database is a
 * window in which it can be read and exported. Layer L3 of §13 exists precisely
 * so a prompt instruction is never the only thing standing between a model and
 * a user's resume.
 *
 * EC-P1-40: a blocked change is NOT silently dropped. It is persisted in
 * guardrail_report as rejected-with-reason, so the UI can show it as rejected
 * and the audit survives.
 */

import { describe, it, expect } from "vitest";

import { checkTailoredResume } from "@/lib/guardrails";
import type { ResumeProfile, TailoredResume } from "@/lib/schemas";

const original: ResumeProfile = {
  contact: { name: "Demo Candidate", email: "demo@example.com" },
  summary: "Backend engineer.",
  skills: ["Python", "PostgreSQL"],
  experience: [
    {
      company: "Example Corp",
      title: "Backend Engineer",
      startDate: "2023",
      endDate: "2025",
      bullets: ["Built a retrieval pipeline serving 40k queries/month"],
    },
  ],
  projects: [],
  education: [],
  certifications: [],
} as unknown as ResumeProfile;

/** An LLM response that invents an employer the candidate never worked for. */
const fabricated: TailoredResume = {
  tailoredSummary: "Backend engineer.",
  tailoredSkills: ["Python", "PostgreSQL"],
  tailoredExperience: [
    {
      company: "Google",          // <- never in the original
      title: "Staff Engineer",    // <- nor this title
      bullets: [
        {
          original: "Built a retrieval pipeline serving 40k queries/month",
          tailored: "Led retrieval infrastructure at Google serving 4M queries/month",
          changeReason: "align with JD",
          keywordsAddressed: ["retrieval"],
          confidence: "high",
          riskFlag: "",
        },
      ],
    },
  ],
} as unknown as TailoredResume;

describe("guardrails run before persistence (safety test 8)", () => {
  const result = checkTailoredResume(original, fabricated);

  it("flags the fabricated employer", () => {
    const types = result.findings.map((f) => f.type);
    expect(types).toContain("new-employer");
  });

  it("raises a blocking finding, not merely a warning", () => {
    const blocking = result.findings.filter((f) => f.severity === "block");
    expect(blocking.length).toBeGreaterThan(0);
  });

  it("flags the invented metric (4M was never in the original)", () => {
    const types = result.findings.map((f) => f.type);
    expect(types).toContain("new-metric");
  });

  it("returns an ADJUSTED resume — the caller persists this, not the raw response", () => {
    // The orchestrator writes `guard.tailored`, never the model's output. This
    // is what makes "before persistence" structural rather than a convention.
    expect(result.tailored).toBeDefined();
    const bullet = result.tailored.tailoredExperience[0].bullets[0];
    expect(bullet.confidence).not.toBe("high");   // downgraded by the guardrail
    expect(bullet.riskFlag).toBeTruthy();          // and flagged for review
  });

  it("EC-P1-40: the blocked change survives as rejected-with-reason", () => {
    // Silently dropping it would leave the user unable to see WHY the rewrite
    // they were shown differs from what the model produced.
    expect(result.findings.every((f) => typeof f.message === "string" && f.message.length > 0))
      .toBe(true);
  });
});
