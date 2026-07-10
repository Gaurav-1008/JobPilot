import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { z } from "zod";

import { systemMessage } from "@/prompts/system";
import {
  type JobDescriptionProfile,
  type ResumeProfile,
} from "@/lib/schemas";

/** Polished summary + reordered (not invented) skills. */
export const FinalAssemblyResponseSchema = z.object({
  tailoredSummary: z.string(),
  tailoredSkills: z.array(z.string()),
});

/** Rewrite the summary and reorder skills to match the JD (truthfully). */
export function finalAssemblyPrompt(resume: ResumeProfile, jd: JobDescriptionProfile) {
  const messages: ChatCompletionMessageParam[] = [
    systemMessage(
      "Polish a resume summary and reorder skills for a target job. Do not invent skills. Return JSON only.",
    ),
    {
      role: "user",
      content: `Return JSON: { "tailoredSummary": string, "tailoredSkills": string[] }.

Rules:
- tailoredSummary: 2-3 sentences, truthful, emphasizing overlap with the JD. Keep the candidate's real seniority.
- tailoredSkills: REORDER the candidate's existing skills to surface JD-relevant ones first. You may drop clearly irrelevant skills, but do NOT add any skill not already present.

CANDIDATE SKILLS (the only skills you may use):
${JSON.stringify(resume.skills)}

CURRENT SUMMARY:
"""
${resume.summary}
"""

TARGET JOB (structured):
${JSON.stringify({ jobTitle: jd.jobTitle, requiredSkills: jd.requiredSkills, preferredSkills: jd.preferredSkills, keywords: jd.keywords })}`,
    },
  ];

  return {
    stage: "final-assembly",
    schema: FinalAssemblyResponseSchema,
    messages,
    temperature: 0.3,
  } as const;
}
