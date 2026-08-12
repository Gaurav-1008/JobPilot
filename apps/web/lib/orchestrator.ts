import type OpenAI from "openai";

import {
  type AnalyzeResponse,
  type TailorResponse,
  type TailoringRun,
} from "@/lib/schemas";
import { parseJobDescription } from "@/services/jd-parser";
import { parseResume } from "@/services/resume-parser";
import { scoreMatch } from "@/services/match-engine";
import { analyzeGaps } from "@/services/gap-engine";
import { tailorResume } from "@/services/tailoring-engine";
import { buildResumeCorpus, buildTailoredCorpus } from "@/lib/scoring";
import { checkTailoredResume } from "@/lib/guardrails";
import { saveRun, getRun } from "@/lib/db/stores/tailoring-run";
import { getLlmModel } from "@/lib/llm/client";
import { promptVersion } from "@/prompts/versions";
import { LlmError } from "@/lib/llm/errors";

function newRunId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Analyze workflow (architecture §5.6): parse resume + JD, score the original,
 * find gaps. Persists the run so tailor can retrieve it by id.
 */
export async function analyze(
  userId: string,
  resumeText: string,
  jdText: string,
  client?: OpenAI,
): Promise<AnalyzeResponse> {
  // Parse both in parallel — independent LLM calls.
  const [resume, jobDescription] = await Promise.all([
    parseResume(resumeText, client),
    parseJobDescription(jdText, client),
  ]);

  const corpus = buildResumeCorpus(resume);

  // Score + gaps in parallel.
  const [originalMatch, gapAnalysis] = await Promise.all([
    scoreMatch(corpus, jobDescription, client),
    analyzeGaps(corpus, jobDescription, client),
  ]);

  const run: TailoringRun = {
    id: newRunId(),
    createdAt: new Date().toISOString(),
    status: "analyzed",
    rawResumeText: resumeText,
    resume,
    jobDescription,
    originalMatch,
    tailoredResume: null,
    tailoredMatch: null,
    gapAnalysis,
    warnings: [],
  };
  // P1.3.3 — persisted with the provenance needed to explain this run later:
  // which model and which prompts (EC-P1-31). Analyze produces no tailored
  // bullets, so there is nothing for guardrails to check at this point.
  await saveRun({
    userId,
    run,
    model: getLlmModel(),
    promptVersion: promptVersion(),
    guardrail: null,
  });

  return {
    runId: run.id,
    resume,
    jobDescription,
    originalMatch,
    gapAnalysis,
  };
}

/**
 * Tailor workflow: load the analyzed run, rewrite bullets, re-score the tailored
 * corpus, and persist. Idempotent — re-running replaces tailored fields while
 * preserving originals.
 */
export async function tailor(
  userId: string,
  runId: string,
  client?: OpenAI,
): Promise<TailorResponse> {
  // Tenant-scoped: another user's runId resolves to null, so the error below
  // is indistinguishable from "no such run" (EC-P1-26).
  const run = await getRun(runId, userId);
  if (!run) {
    throw new LlmError(
      "LLM_UNKNOWN",
      "Run not found. Re-run analyze before tailoring.",
      { stage: "tailor" },
    );
  }

  const rawTailored = await tailorResume(
    run.resume,
    run.jobDescription,
    run.gapAnalysis,
    client,
  );

  // Deterministic guardrails: downgrade confidence + attach riskFlags on any
  // fabricated employer, invented metric, unsupported tech, or credential claim.
  const guard = checkTailoredResume(
    run.resume,
    rawTailored,
    run.jobDescription,
  );
  const tailoredResume = guard.tailored;

  // Re-score the guardrail-adjusted tailored corpus.
  const tailoredCorpus = buildTailoredCorpus(tailoredResume);
  const tailoredMatch = await scoreMatch(
    tailoredCorpus,
    run.jobDescription,
    client,
  );

  const updated: TailoringRun = {
    ...run,
    status: "tailored",
    tailoredResume,
    tailoredMatch,
    warnings: guard.warnings,
  };
  // EC-P1-37 — guardrails ran ABOVE; `tailoredResume` is the adjusted version
  // and `guard` carries every blocked change with its reason (EC-P1-40).
  // No code path persists a raw, unchecked LLM response.
  await saveRun({
    userId,
    run: updated,
    model: getLlmModel(),
    promptVersion: promptVersion(),
    guardrail: guard,
  });

  return {
    runId: updated.id,
    tailoredResume,
    tailoredMatch,
    warnings: guard.warnings,
  };
}
