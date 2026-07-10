import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { z } from "zod";

import { systemMessage } from "@/prompts/system";
import {
  GapAnalysisSchema,
  type JobDescriptionProfile,
} from "@/lib/schemas";

/**
 * Response schema: the model returns { gaps: [...] }, but we also tolerate a
 * bare array and normalize it in the service.
 */
export const GapAnalysisResponseSchema = z.union([
  GapAnalysisSchema,
  z.object({ gaps: GapAnalysisSchema.shape.gaps }),
]);

/** Identify missing/weak JD requirements against resume evidence. */
export function gapAnalysisPrompt(jd: JobDescriptionProfile, resumeCorpus: string) {
  const messages: ChatCompletionMessageParam[] = [
    systemMessage(
      "Compare a job description against a resume and list honest gaps. Never suggest fabricating experience. Return JSON only.",
    ),
    {
      role: "user",
      content: `List the gaps between this job description and resume as JSON: { "gaps": ResumeGap[] }.

ResumeGap shape:
{
  "name": string,                 // the requirement/skill
  "importance": "high" | "medium" | "low",
  "jdEvidence": string,           // why the JD wants it
  "resumeEvidence": string,       // what the resume shows (or "not found")
  "suggestedAction": string,      // honest advice; if it must not be invented, say so
  "canSafelyAdd": boolean         // true only if the candidate plausibly has it and it's just unstated
}

Rules:
- Focus on required skills/qualifications first, then preferred.
- canSafelyAdd=false for anything the candidate would have to fabricate (a skill/tool with zero resume evidence).
- canSafelyAdd=true only for things likely true but merely unstated (e.g. on-call if they ran production services).
- Return at most 8 gaps, most important first.

JOB DESCRIPTION (structured):
${JSON.stringify(jd)}

RESUME CORPUS:
"""
${resumeCorpus}
"""`,
    },
  ];

  return {
    stage: "gap-analysis",
    schema: GapAnalysisResponseSchema,
    messages,
    temperature: 0.2,
  } as const;
}
