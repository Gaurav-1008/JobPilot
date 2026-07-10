import { describe, it, expect } from "vitest";
import type OpenAI from "openai";

import { analyze, tailor } from "@/lib/orchestrator";
import {
  AnalyzeResponseSchema,
  TailorResponseSchema,
} from "@/lib/schemas";
import sampleResume from "./fixtures/sample-resume.json";
import sampleJd from "./fixtures/sample-jd.json";

/**
 * A fake OpenAI client that inspects the prompt and returns canned, valid JSON
 * per stage — lets us test the orchestrator wiring with no API key.
 */
function makeFakeClient(): OpenAI {
  const create = async (params: {
    messages: { role: string; content: string }[];
  }) => {
    const user = params.messages.map((m) => m.content).join("\n");
    const content = respondFor(user);
    return {
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    };
  };
  return { chat: { completions: { create } } } as unknown as OpenAI;
}

function respondFor(user: string): string {
  if (user.includes("Convert this resume into")) {
    return JSON.stringify(sampleResume);
  }
  if (user.includes("Extract the following JSON fields from this job")) {
    return JSON.stringify(sampleJd);
  }
  if (user.includes("Produce a MatchScore")) {
    return JSON.stringify({
      overallScore: 72,
      skillCoverageScore: 66,
      responsibilityAlignmentScore: 75,
      keywordScore: 70,
      seniorityScore: 82,
      criticalMissingRequirements: [],
      explanation: "Solid backend alignment; some required skills missing.",
    });
  }
  if (user.includes("List the gaps between this job description")) {
    return JSON.stringify({
      gaps: [
        {
          name: "Kubernetes",
          importance: "high",
          jdEvidence: "Required",
          resumeEvidence: "not found",
          suggestedAction: "Do not claim; discuss Docker experience.",
          canSafelyAdd: false,
        },
      ],
    });
  }
  if (user.includes("Rewrite each bullet for this role")) {
    // Echo one TailoredBullet per original bullet.
    const match = user.match(/ORIGINAL BULLETS:\s*(\[[\s\S]*\])\s*$/);
    const originals: string[] = match ? JSON.parse(match[1]) : [];
    // Deliberately insert Kubernetes (a JD skill absent from the resume) so the
    // guardrail integration is exercised end-to-end.
    return JSON.stringify({
      bullets: originals.map((original) => ({
        original,
        tailored: `${original} using Kubernetes`,
        changeReason: "Surface reliability and scale.",
        keywordsAddressed: ["reliability"],
        confidence: "high",
      })),
    });
  }
  if (user.includes('"tailoredSummary"')) {
    return JSON.stringify({
      tailoredSummary: "Senior backend engineer focused on reliable services.",
      tailoredSkills: ["Python", "PostgreSQL", "AWS"],
    });
  }
  throw new Error(`Unhandled prompt in fake client:\n${user.slice(0, 120)}`);
}

describe("orchestrator (mocked LLM)", () => {
  it("runs analyze → tailor end-to-end and returns valid contracts", async () => {
    const client = makeFakeClient();

    const analysis = await analyze("resume text", "jd text", client);
    expect(AnalyzeResponseSchema.safeParse(analysis).success).toBe(true);
    // Deterministic missing-required detection overrides the model's empty list.
    expect(analysis.originalMatch.criticalMissingRequirements).toEqual(
      expect.arrayContaining(["Go", "Kubernetes", "gRPC"]),
    );
    expect(analysis.gapAnalysis.gaps.length).toBeGreaterThan(0);

    const tailored = await tailor(analysis.runId, client);
    expect(TailorResponseSchema.safeParse(tailored).success).toBe(true);
    // One tailored bullet per original bullet in the first role.
    expect(tailored.tailoredResume.tailoredExperience[0].bullets).toHaveLength(
      4,
    );
    // Guardrails caught the fabricated Kubernetes claim: warnings + downgraded
    // confidence + a risk flag on the offending bullet.
    expect(tailored.warnings.length).toBeGreaterThan(0);
    const firstBullet =
      tailored.tailoredResume.tailoredExperience[0].bullets[0];
    expect(firstBullet.confidence).toBe("medium"); // downgraded from high
    expect(firstBullet.riskFlag).toMatch(/Kubernetes/);
    // Tailored skills never include a skill the candidate lacks.
    expect(tailored.tailoredResume.tailoredSkills).not.toContain("Go");
  });

  it("throws a friendly error when tailoring an unknown run", async () => {
    await expect(tailor("does-not-exist", makeFakeClient())).rejects.toThrow(
      /Run not found/,
    );
  });
});
