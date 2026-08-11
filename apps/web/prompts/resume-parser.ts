import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { systemMessage } from "@/prompts/system";
import { ResumeProfileSchema } from "@/lib/schemas";

/**
 * Clean messy resume text into a structured ResumeProfile. Extraction only —
 * the model must not invent content that is not present in the text.
 */
export function resumeParserPrompt(resumeText: string) {
  const messages: ChatCompletionMessageParam[] = [
    systemMessage(
      "Parse raw resume text into structured JSON. Extract only what is present; never invent employers, dates, degrees, or metrics.",
    ),
    {
      role: "user",
      content: `Convert this resume into the following JSON. Preserve bullet wording as-is (do not rewrite yet). Use empty arrays/strings for missing sections.

JSON shape:
{
  "contact": { "name": string, "email"?: string, "phone"?: string, "location"?: string, "links": string[] },
  "summary": string,
  "skills": string[],
  "experience": [ { "company": string, "title": string, "startDate"?: string, "endDate"?: string, "bullets": string[] } ],
  "projects": [ { "name": string, "description"?: string, "bullets": string[] } ],
  "education": [ { "institution": string, "degree"?: string, "field"?: string, "startDate"?: string, "endDate"?: string } ],
  "certifications": [ { "name": string, "issuer"?: string, "date"?: string } ]
}

RESUME:
"""
${resumeText}
"""`,
    },
  ];

  return {
    stage: "resume-parser",
    schema: ResumeProfileSchema,
    messages,
    temperature: 0.1,
  } as const;
}
