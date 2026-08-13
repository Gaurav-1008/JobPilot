/**
 * Personalization payload builder (P5.2.1 / P5.2.2).
 *
 * Fixture runs only — no LLM in the loop. That is the point of the builder
 * being pure: FR7's guarantee ("every claim traces to a persisted artifact")
 * is checkable at this level, without a network call or a model.
 */

import { describe, expect, it } from "vitest";

import type { TailoringRun } from "@jobpilot/shared-schemas";
import { buildPayload, payloadIsWeak } from "@/lib/outreach/personalization";

function run(overrides: Partial<TailoringRun> = {}): TailoringRun {
  return {
    id: "run-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    status: "tailored",
    resume: {
      name: "Priya K",
      contact: {},
      summary: "Backend engineer",
      skills: ["Python", "PostgreSQL", "Kubernetes"],
      experience: [
        {
          company: "Acme",
          title: "Engineer",
          startDate: "2020",
          endDate: "2024",
          bullets: ["Built a Python ingestion service on PostgreSQL"],
        },
      ],
      projects: [],
      education: [],
      certifications: [],
    },
    jobDescription: {
      jobTitle: "Platform Engineer",
      requiredSkills: ["Python", "Terraform"],
      preferredSkills: ["PostgreSQL"],
      responsibilities: [],
      qualifications: [],
      tools: [],
      keywords: [],
      seniorityLevel: "mid",
      domainSignals: ["fintech payments", "PCI compliance", "high volume"],
    },
    originalMatch: {
      overallScore: 61,
      skillCoverageScore: 50,
      responsibilityAlignmentScore: 60,
      keywordScore: 60,
      seniorityScore: 70,
      criticalMissingRequirements: ["Terraform"],
      explanation: "Partial match",
    },
    tailoredResume: {
      tailoredSummary: "Backend engineer",
      tailoredSkills: ["Python"],
      tailoredExperience: [
        {
          company: "Acme",
          title: "Engineer",
          bullets: [
            {
              original: "Built a service",
              tailored: "Built a low-confidence line",
              changeReason: "clarity",
              keywordsAddressed: [],
              confidence: "low",
            },
            {
              original: "Built a service",
              tailored: "Built a Python ingestion service on PostgreSQL",
              changeReason: "keyword alignment",
              keywordsAddressed: ["Python"],
              confidence: "high",
            },
          ],
        },
      ],
    },
    tailoredMatch: {
      overallScore: 78,
      skillCoverageScore: 75,
      responsibilityAlignmentScore: 75,
      keywordScore: 80,
      seniorityScore: 80,
      criticalMissingRequirements: [],
      explanation: "Improved",
    },
    gapAnalysis: {
      gaps: [
        {
          name: "Terraform",
          importance: "high",
          jdEvidence: "Required",
          resumeEvidence: "Absent",
          suggestedAction: "Learn it",
          canSafelyAdd: false,
        },
        {
          name: "Go",
          importance: "low",
          jdEvidence: "Nice to have",
          resumeEvidence: "Absent",
          suggestedAction: "Ignore",
          canSafelyAdd: false,
        },
      ],
    },
    warnings: [],
    ...overrides,
  } as TailoringRun;
}

describe("buildPayload", () => {
  it("returns only skills the JD asks for AND the resume evidences", () => {
    const payload = buildPayload(run());
    // Terraform is required but absent from the resume — it must never appear
    // as a matched skill, or the email claims something the resume cannot back.
    expect(payload.topMatchedSkills).not.toContain("Terraform");
    expect(payload.topMatchedSkills).toContain("Python");
    expect(payload.topMatchedSkills).toContain("PostgreSQL");
  });

  it("orders required matches ahead of preferred ones", () => {
    expect(buildPayload(run()).topMatchedSkills[0]).toBe("Python");
  });

  it("caps skills at three and hooks at two (§14.2)", () => {
    const payload = buildPayload(
      run({
        jobDescription: {
          ...run().jobDescription,
          requiredSkills: ["Python", "PostgreSQL", "Kubernetes"],
          preferredSkills: ["Python"],
        },
      } as Partial<TailoringRun>),
    );
    expect(payload.topMatchedSkills).toHaveLength(3);
    expect(payload.jdHooks).toEqual(["fintech payments", "PCI compliance"]);
  });

  it("picks the highest-confidence bullet, not the first", () => {
    expect(buildPayload(run()).strongestBullet).toBe(
      "Built a Python ingestion service on PostgreSQL",
    );
  });

  it("is deterministic — the same run yields the same payload", () => {
    // If this ever drifts, an approved body hash stops being reproducible and
    // interlock check 3 starts rejecting legitimate deliveries.
    expect(buildPayload(run())).toEqual(buildPayload(run()));
  });

  it("returns a null strongestBullet when every change was blocked (EC-P5-21)", () => {
    const payload = buildPayload(
      run({
        tailoredResume: {
          tailoredSummary: "",
          tailoredSkills: [],
          tailoredExperience: [{ company: "Acme", title: "Engineer", bullets: [] }],
        },
      } as Partial<TailoringRun>),
    );
    // The template must render without it — no "undefined" in the body.
    expect(payload.strongestBullet).toBeNull();
  });

  it("carries only HIGH-importance gaps as the suppression list (EC-P5-24)", () => {
    const payload = buildPayload(run());
    expect(payload.honestGaps).toEqual(["Terraform"]);
    expect(payload.honestGaps).not.toContain("Go");
  });

  it("prefers the tailored score, falling back to the original", () => {
    expect(buildPayload(run()).matchScore).toBe(78);
    expect(
      buildPayload(run({ tailoredMatch: null } as Partial<TailoringRun>)).matchScore,
    ).toBe(61);
  });

  it("still builds a payload for a poor match (EC-P5-23)", () => {
    const payload = buildPayload(
      run({
        tailoredMatch: { ...run().originalMatch, overallScore: 31 },
      } as Partial<TailoringRun>),
    );
    // The user decides whether a 31 is worth sending; the builder does not.
    expect(payload.matchScore).toBe(31);
    expect(payload.topMatchedSkills.length).toBeGreaterThan(0);
  });
});

describe("payloadIsWeak", () => {
  it("flags a null payload (EC-P5-20)", () => {
    expect(payloadIsWeak(null)).toBe(true);
  });

  it("flags an empty skill list as a payload bug worth logging (EC-P5-22)", () => {
    const payload = buildPayload(
      run({
        jobDescription: {
          ...run().jobDescription,
          requiredSkills: ["Rust"],
          preferredSkills: [],
        },
      } as Partial<TailoringRun>),
    );
    expect(payload.topMatchedSkills).toEqual([]);
    expect(payloadIsWeak(payload)).toBe(true);
  });

  it("passes a healthy payload", () => {
    expect(payloadIsWeak(buildPayload(run()))).toBe(false);
  });
});
