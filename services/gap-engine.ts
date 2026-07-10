import type OpenAI from "openai";

import { runPrompt } from "@/lib/llm/run-prompt";
import { gapAnalysisPrompt } from "@/prompts/gap-analysis";
import type {
  GapAnalysis,
  JobDescriptionProfile,
} from "@/lib/schemas";

const IMPORTANCE_ORDER = { high: 0, medium: 1, low: 2 } as const;

/** Resume corpus + JD → honest GapAnalysis (sorted, capped). */
export async function analyzeGaps(
  resumeCorpus: string,
  jd: JobDescriptionProfile,
  client?: OpenAI,
): Promise<GapAnalysis> {
  const result = await runPrompt({
    ...gapAnalysisPrompt(jd, resumeCorpus),
    client,
  });

  const gaps = [...result.gaps].sort(
    (a, b) => IMPORTANCE_ORDER[a.importance] - IMPORTANCE_ORDER[b.importance],
  );

  return { gaps: gaps.slice(0, 8) };
}
