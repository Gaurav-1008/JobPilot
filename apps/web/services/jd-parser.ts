import type OpenAI from "openai";

import { runPrompt } from "@/lib/llm/run-prompt";
import { jdExtractionPrompt } from "@/prompts/jd-extraction";
import type { JobDescriptionProfile } from "@/lib/schemas";

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(item.trim());
    }
  }
  return out;
}

/** JD text → structured JobDescriptionProfile (LLM extraction + normalization). */
export async function parseJobDescription(
  jdText: string,
  client?: OpenAI,
): Promise<JobDescriptionProfile> {
  const jd = await runPrompt({ ...jdExtractionPrompt(jdText), client });
  return {
    ...jd,
    requiredSkills: dedupe(jd.requiredSkills),
    preferredSkills: dedupe(jd.preferredSkills),
    tools: dedupe(jd.tools),
    keywords: dedupe(jd.keywords),
  };
}
