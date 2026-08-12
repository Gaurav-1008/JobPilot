import { describe, it, expect, vi } from "vitest";
import type OpenAI from "openai";

import { analyze, tailor } from "@/lib/orchestrator";
import {
  AnalyzeResponseSchema,
  TailorResponseSchema,
} from "@/lib/schemas";
import sampleResume from "./fixtures/sample-resume.json";
import sampleJd from "./fixtures/sample-jd.json";

// The orchestrator now persists through Prisma. This suite is about the LLM
// chain and its guardrails, so persistence is mocked and asserted on instead of
// requiring a live database. The store itself is covered by
// tests/safety/tenant-isolation.test.ts.
// vi.mock is hoisted above every const in this file, so the shared state the
// factory closes over must be created with vi.hoisted or it hits a TDZ error.
const store = vi.hoisted(() => ({
  saved: [] as Array<Record<string, unknown>>,
  runs: new Map<string, unknown>(),
}));

vi.mock("@/lib/db/stores/tailoring-run", () => ({
  saveRun: async (input: Record<string, unknown>) => {
    store.saved.push(input);
    const run = input.run as { id: string };
    store.runs.set(`${input.userId}:${run.id}`, run);
  },
  getRun: async (id: string, userId: string) =>
    store.runs.get(`${userId}:${id}`) ?? null,
}));

const USER = "11111111-1111-4111-8111-111111111111";


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

    const analysis = await analyze(USER, "resume text", "jd text", client);
    expect(AnalyzeResponseSchema.safeParse(analysis).success).toBe(true);
    // Deterministic missing-required detection overrides the model's empty list.
    expect(analysis.originalMatch.criticalMissingRequirements).toEqual(
      expect.arrayContaining(["Go", "Kubernetes", "gRPC"]),
    );
    expect(analysis.gapAnalysis.gaps.length).toBeGreaterThan(0);

    const tailored = await tailor(USER, analysis.runId, client);
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
    await expect(tailor(USER, "does-not-exist", makeFakeClient())).rejects.toThrow(
      /Run not found/,
    );
  });
});

describe("persistence provenance (P1.3.3 / EC-P1-37)", () => {
  it("saveRun receives the GUARDED resume and its report, never the raw response", async () => {
    store.saved.length = 0;
    store.runs.clear();

    const client = makeFakeClient();
    const analysis = await analyze(USER, "resume text", "jd text", client);
    await tailor(USER, analysis.runId, client);

    // Two writes: analyze (no bullets yet, so no guardrail) then tailor.
    expect(store.saved).toHaveLength(2);

    const [onAnalyze, onTailor] = store.saved;
    expect(onAnalyze.guardrail).toBeNull();

    // The tailor write MUST carry a guardrail report. If this is ever null,
    // an unchecked LLM response reached the database (EC-P1-37).
    expect(onTailor.guardrail).not.toBeNull();

    // EC-P1-31/32 — provenance on every run, or "why did it say that?" about an
    // old run becomes unanswerable once a prompt is edited.
    for (const write of store.saved) {
      expect(write.userId).toBe(USER);
      expect(typeof write.model).toBe("string");
      expect(String(write.promptVersion)).toMatch(/^p1-[0-9a-f]{12}$/);
    }
  });
});
