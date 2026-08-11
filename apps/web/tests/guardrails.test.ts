import { describe, it, expect } from "vitest";

import { checkTailoredResume, extractMetrics } from "@/lib/guardrails";
import {
  ResumeProfileSchema,
  type JobDescriptionProfile,
  type TailoredBullet,
  type TailoredResume,
} from "@/lib/schemas";
import sampleResume from "./fixtures/sample-resume.json";
import sampleJd from "./fixtures/sample-jd.json";

const original = ResumeProfileSchema.parse(sampleResume);
const jd = sampleJd as JobDescriptionProfile;

function bullet(partial: Partial<TailoredBullet>): TailoredBullet {
  return {
    original: "Built and maintained REST APIs in Python and Node.js.",
    tailored: "Built and maintained REST APIs in Python and Node.js.",
    changeReason: "kept",
    keywordsAddressed: [],
    confidence: "high",
    ...partial,
  };
}

function tailoredWith(
  bullets: TailoredBullet[],
  company = "Brightwave Systems",
  title = "Senior Software Engineer",
): TailoredResume {
  return {
    tailoredSummary: original.summary,
    tailoredSkills: original.skills,
    tailoredExperience: [{ company, title, bullets }],
  };
}

describe("extractMetrics", () => {
  it("captures numbers with units and percentages", () => {
    expect(extractMetrics("Reduced latency 40% across 3M requests")).toEqual(
      expect.arrayContaining(["40%", "3m"]),
    );
  });
});

describe("checkTailoredResume", () => {
  it("passes a faithful rewrite with no findings", () => {
    const result = checkTailoredResume(
      original,
      tailoredWith([
        bullet({
          tailored:
            "Designed and maintained REST APIs in Python and Node.js at scale.",
        }),
      ]),
      jd,
    );
    expect(result.findings).toHaveLength(0);
    expect(result.blocked).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  it("flags a fabricated employer as a blocking finding", () => {
    const result = checkTailoredResume(
      original,
      tailoredWith([bullet({})], "Globex Corporation"),
      jd,
    );
    expect(result.blocked).toBe(true);
    expect(result.findings.some((f) => f.type === "new-employer")).toBe(true);
  });

  it("flags an invented metric and downgrades confidence + adds a risk flag", () => {
    const result = checkTailoredResume(
      original,
      tailoredWith([
        bullet({
          tailored: "Cut infrastructure costs by 87% company-wide.",
          confidence: "high",
        }),
      ]),
      jd,
    );
    const finding = result.findings.find((f) => f.type === "new-metric");
    expect(finding).toBeTruthy();
    const adjusted = result.tailored.tailoredExperience[0].bullets[0];
    expect(adjusted.confidence).toBe("medium"); // downgraded from high
    expect(adjusted.riskFlag).toMatch(/87%/);
  });

  it("preserves a metric that exists in the original resume", () => {
    // 40% and 3M both appear in the sample resume, so no new-metric finding.
    const result = checkTailoredResume(
      original,
      tailoredWith([
        bullet({
          tailored: "Reduced p95 latency 40% while serving 3M requests.",
        }),
      ]),
      jd,
    );
    expect(result.findings.some((f) => f.type === "new-metric")).toBe(false);
  });

  it("flags a JD technology inserted without resume evidence", () => {
    const result = checkTailoredResume(
      original,
      tailoredWith([
        bullet({
          tailored: "Operated Kubernetes clusters and wrote Go services.",
        }),
      ]),
      jd,
    );
    const tech = result.findings.find((f) => f.type === "new-technology");
    expect(tech).toBeTruthy();
    expect(tech?.message).toMatch(/Kubernetes|Go/);
  });

  it("does not flag a technology the candidate actually has (PostgreSQL)", () => {
    const result = checkTailoredResume(
      original,
      tailoredWith([
        bullet({ tailored: "Tuned PostgreSQL queries for throughput." }),
      ]),
      jd,
    );
    expect(result.findings.some((f) => f.type === "new-technology")).toBe(false);
  });

  it("flags an unsupported credential claim as blocking", () => {
    const result = checkTailoredResume(
      original,
      tailoredWith([
        bullet({ tailored: "Applied MBA-level strategy to platform roadmap." }),
      ]),
      jd,
    );
    expect(result.blocked).toBe(true);
    expect(result.findings.some((f) => f.type === "new-credential")).toBe(true);
  });
});
