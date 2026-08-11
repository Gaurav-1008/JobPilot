import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { systemMessage } from "@/prompts/system";
import { JobDescriptionProfileSchema } from "@/lib/schemas";

/** Extract a structured JobDescriptionProfile from raw JD text. */
export function jdExtractionPrompt(jdText: string) {
  const messages: ChatCompletionMessageParam[] = [
    systemMessage(
      "Extract structured requirements from a job description into JSON.",
    ),
    {
      role: "user",
      content: `Extract the following JSON fields from this job description. Use empty arrays/strings when a field is absent. Deduplicate skills. Normalize seniorityLevel to one of: Intern, Junior, Mid, Senior, Staff, Principal, Lead, Manager (best fit).

JSON shape:
{
  "jobTitle": string,
  "company": string | omitted,
  "requiredSkills": string[],
  "preferredSkills": string[],
  "responsibilities": string[],
  "qualifications": string[],
  "tools": string[],
  "keywords": string[],
  "seniorityLevel": string,
  "domainSignals": string[]
}

JOB DESCRIPTION:
"""
${jdText}
"""`,
    },
  ];

  return {
    stage: "jd-extraction",
    schema: JobDescriptionProfileSchema,
    messages,
    temperature: 0.1,
  } as const;
}
