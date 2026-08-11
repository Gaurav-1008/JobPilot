import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { z } from "zod";

import { systemMessage } from "@/prompts/system";
import {
  TailoredBulletSchema,
  type JobDescriptionProfile,
  type ExperienceEntry,
  type ResumeGap,
} from "@/lib/schemas";

/** json_object mode requires an object top-level, so bullets are wrapped. */
export const BulletRewriteResponseSchema = z.object({
  bullets: z.array(TailoredBulletSchema),
});

export interface BulletRewriteInput {
  role: Pick<ExperienceEntry, "company" | "title" | "bullets">;
  jd: JobDescriptionProfile;
  gaps: ResumeGap[];
}

/** Rewrite one role's bullets truthfully, one TailoredBullet per original. */
export function bulletRewriterPrompt({ role, jd, gaps }: BulletRewriteInput) {
  const unsafeToAdd = gaps
    .filter((g) => !g.canSafelyAdd)
    .map((g) => g.name);

  const messages: ChatCompletionMessageParam[] = [
    systemMessage(
      "Rewrite resume bullets to align with a job description WITHOUT fabricating anything. Return JSON only.",
    ),
    {
      role: "user",
      content: `Rewrite each bullet for this role. Return JSON: { "bullets": TailoredBullet[] } with EXACTLY one entry per original bullet, in order.

TailoredBullet shape:
{
  "original": string,             // copy the original bullet verbatim
  "tailored": string,             // truthful rewrite aligned to the JD
  "changeReason": string,         // why you changed it
  "keywordsAddressed": string[],  // JD keywords/skills this now surfaces (only if genuinely supported)
  "confidence": "high" | "medium" | "low",
  "riskFlag"?: string             // set when the rewrite stretches meaning; explain the risk
}

Rules:
- Keep every claim traceable to the original bullet. Do not add tools/skills the bullet does not support.
- NEVER introduce these unsupported items (candidate lacks evidence): ${unsafeToAdd.join(", ") || "(none flagged)"}.
- Preserve any metric exactly; never invent a new number.
- If the original already fits, you may keep it nearly unchanged with confidence "high" and an empty keywordsAddressed.
- Use confidence "low" + a riskFlag when reframing borders on overstatement.

FORBIDDEN transformations (never do these):
- Original "Built REST APIs in Python" → "Built gRPC microservices in Go" (invents Go/gRPC).
- Original "Improved latency by caching" → "Reduced latency 40%" (invents a metric).
- Original "Deployed with Docker" → "Operated Kubernetes clusters in production" (invents Kubernetes).
- Adding a degree, certification, employer, or title not in the original resume.

ROLE: ${role.title} at ${role.company}

TARGET JOB (structured):
${JSON.stringify({ jobTitle: jd.jobTitle, requiredSkills: jd.requiredSkills, preferredSkills: jd.preferredSkills, keywords: jd.keywords, responsibilities: jd.responsibilities })}

ORIGINAL BULLETS:
${JSON.stringify(role.bullets)}`,
    },
  ];

  return {
    stage: "bullet-rewriter",
    schema: BulletRewriteResponseSchema,
    messages,
    temperature: 0.4,
  } as const;
}
