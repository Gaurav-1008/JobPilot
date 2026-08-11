import { describe, it, expect } from "vitest";

import {
  normalizeToken,
  corpusIncludes,
  coverage,
  computeSignals,
  buildResumeCorpus,
  buildTailoredCorpus,
} from "@/lib/scoring";
import { ResumeProfileSchema, type JobDescriptionProfile } from "@/lib/schemas";
import sampleResume from "./fixtures/sample-resume.json";
import sampleJd from "./fixtures/sample-jd.json";

const resume = ResumeProfileSchema.parse(sampleResume);
const jd = sampleJd as JobDescriptionProfile;

describe("normalizeToken", () => {
  it("lowercases and strips punctuation but keeps + # .", () => {
    expect(normalizeToken("Node.js")).toBe("node.js");
    expect(normalizeToken("C++")).toBe("c++");
    expect(normalizeToken("  REST APIs ")).toBe("restapis");
  });
});

describe("corpusIncludes", () => {
  const corpus = buildResumeCorpus(resume);
  it("finds a present skill", () => {
    expect(corpusIncludes(corpus, "PostgreSQL")).toBe(true);
    expect(corpusIncludes(corpus, "Python")).toBe(true);
  });
  it("does not find an absent skill", () => {
    expect(corpusIncludes(corpus, "Kubernetes")).toBe(false);
    expect(corpusIncludes(corpus, "Go")).toBe(false);
  });
});

describe("coverage", () => {
  it("splits matched vs missing and computes pct", () => {
    const corpus = buildResumeCorpus(resume);
    const result = coverage(corpus, ["Python", "Kubernetes", "PostgreSQL"]);
    expect(result.matched.sort()).toEqual(["PostgreSQL", "Python"]);
    expect(result.missing).toEqual(["Kubernetes"]);
    expect(result.pct).toBe(67);
  });
  it("returns 100% for an empty requirement list", () => {
    expect(coverage("anything", []).pct).toBe(100);
  });
});

describe("computeSignals", () => {
  it("flags Go/Kubernetes/gRPC as missing required skills", () => {
    const corpus = buildResumeCorpus(resume);
    const signals = computeSignals(corpus, jd);
    expect(signals.requiredMissing).toEqual(
      expect.arrayContaining(["Go", "Kubernetes", "gRPC"]),
    );
    expect(signals.requiredMatched).toEqual(
      expect.arrayContaining(["PostgreSQL", "AWS"]),
    );
    expect(signals.skillCoveragePct).toBeGreaterThan(0);
    expect(signals.skillCoveragePct).toBeLessThan(100);
  });
});

describe("buildTailoredCorpus", () => {
  it("includes tailored bullet text and skills", () => {
    const corpus = buildTailoredCorpus({
      tailoredSummary: "Senior backend engineer",
      tailoredSkills: ["Go", "PostgreSQL"],
      tailoredExperience: [
        {
          company: "Acme",
          title: "Engineer",
          bullets: [
            {
              original: "Built REST APIs",
              tailored: "Built distributed microservices",
              changeReason: "align",
              keywordsAddressed: ["microservices"],
              confidence: "high",
            },
          ],
        },
      ],
    });
    expect(corpus).toContain("distributed microservices");
    expect(corpus).toContain("Go");
  });
});
