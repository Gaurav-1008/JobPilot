import { describe, it, expect } from "vitest";

import {
  ResumeProfileSchema,
  JobDescriptionProfileSchema,
  TailoringRunSchema,
  MatchScoreSchema,
  TailoredBulletSchema,
} from "@/lib/schemas";

import sampleResume from "./fixtures/sample-resume.json";
import sampleJd from "./fixtures/sample-jd.json";
import mockRun from "./fixtures/mock-tailoring-run.json";

describe("domain schemas", () => {
  it("parses the sample resume fixture", () => {
    const result = ResumeProfileSchema.safeParse(sampleResume);
    expect(result.success).toBe(true);
  });

  it("parses the sample JD fixture", () => {
    const result = JobDescriptionProfileSchema.safeParse(sampleJd);
    expect(result.success).toBe(true);
  });

  it("parses the full mock TailoringRun fixture", () => {
    const result = TailoringRunSchema.safeParse(mockRun);
    if (!result.success) {
      // Surface the first issue to make failures actionable.
      throw new Error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it("keeps mock scores within 0-100", () => {
    const run = TailoringRunSchema.parse(mockRun);
    expect(run.originalMatch.overallScore).toBeGreaterThanOrEqual(0);
    expect(run.originalMatch.overallScore).toBeLessThanOrEqual(100);
    expect(run.tailoredMatch?.overallScore).toBeGreaterThan(
      run.originalMatch.overallScore,
    );
  });
});

describe("schema rejection", () => {
  it("rejects a match score above 100", () => {
    const result = MatchScoreSchema.safeParse({
      overallScore: 140,
      skillCoverageScore: 50,
      responsibilityAlignmentScore: 50,
      keywordScore: 50,
      seniorityScore: 50,
      criticalMissingRequirements: [],
      explanation: "invalid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a bullet with an invalid confidence value", () => {
    const result = TailoredBulletSchema.safeParse({
      original: "a",
      tailored: "b",
      changeReason: "c",
      keywordsAddressed: [],
      confidence: "very-high",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a resume missing required contact", () => {
    const result = ResumeProfileSchema.safeParse({ summary: "no contact" });
    expect(result.success).toBe(false);
  });
});
