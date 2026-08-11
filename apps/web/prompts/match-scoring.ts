import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { systemMessage } from "@/prompts/system";
import {
  MatchScoreSchema,
  type JobDescriptionProfile,
} from "@/lib/schemas";

export interface MatchScoringInput {
  jd: JobDescriptionProfile;
  /** Flattened resume text: summary + skills + all bullet text. */
  resumeCorpus: string;
  /** Deterministic pre-checks used to seed the model for consistency. */
  signals: {
    requiredMatched: string[];
    requiredMissing: string[];
    preferredMatched: string[];
    skillCoveragePct: number;
    keywordCoveragePct: number;
  };
}

/** Score resume↔JD alignment into an explainable MatchScore (0-100). */
export function matchScoringPrompt({ jd, resumeCorpus, signals }: MatchScoringInput) {
  const messages: ChatCompletionMessageParam[] = [
    systemMessage(
      "Score how well a resume matches a job description. Be calibrated and explainable — do not inflate. Return JSON only.",
    ),
    {
      role: "user",
      content: `Produce a MatchScore as JSON. All scores are 0-100 integers. Ground your judgement in the deterministic signals below, then refine using the full text.

Deterministic signals (already computed):
- Required skills matched: ${signals.requiredMatched.join(", ") || "(none)"}
- Required skills MISSING: ${signals.requiredMissing.join(", ") || "(none)"}
- Preferred skills matched: ${signals.preferredMatched.join(", ") || "(none)"}
- Skill coverage: ${signals.skillCoveragePct}%
- Keyword coverage: ${signals.keywordCoveragePct}%

JSON shape:
{
  "overallScore": number,
  "skillCoverageScore": number,
  "responsibilityAlignmentScore": number,
  "keywordScore": number,
  "seniorityScore": number,
  "criticalMissingRequirements": string[],
  "explanation": string
}

Rules:
- criticalMissingRequirements must include required skills with no resume evidence.
- overallScore should roughly reflect the weighted sub-scores; penalize missing required skills.
- explanation: 1-3 sentences, concrete, cite evidence or gaps.

JOB DESCRIPTION (structured):
${JSON.stringify(jd)}

RESUME CORPUS:
"""
${resumeCorpus}
"""`,
    },
  ];

  return {
    stage: "match-scoring",
    schema: MatchScoreSchema,
    messages,
    temperature: 0.1,
  } as const;
}
