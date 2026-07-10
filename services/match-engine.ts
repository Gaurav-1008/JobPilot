import type OpenAI from "openai";

import { runPrompt } from "@/lib/llm/run-prompt";
import { matchScoringPrompt } from "@/prompts/match-scoring";
import { computeSignals } from "@/lib/scoring";
import type { JobDescriptionProfile, MatchScore } from "@/lib/schemas";

/**
 * Hybrid match scoring: deterministic signals seed an LLM that produces the
 * explainable sub-scores. `corpus` is the flattened resume text (original or
 * tailored) so the same engine scores both.
 */
export async function scoreMatch(
  corpus: string,
  jd: JobDescriptionProfile,
  client?: OpenAI,
): Promise<MatchScore> {
  const signals = computeSignals(corpus, jd);
  const score = await runPrompt({
    ...matchScoringPrompt({ jd, resumeCorpus: corpus, signals }),
    client,
  });

  // Trust deterministic missing-required detection over the model's list.
  const criticalMissing = signals.requiredMissing.length
    ? signals.requiredMissing
    : score.criticalMissingRequirements;

  return { ...score, criticalMissingRequirements: criticalMissing };
}
