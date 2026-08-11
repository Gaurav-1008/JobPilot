import type OpenAI from "openai";

import { runPrompt } from "@/lib/llm/run-prompt";
import { bulletRewriterPrompt } from "@/prompts/bullet-rewriter";
import { finalAssemblyPrompt } from "@/prompts/final-assembly";
import type {
  GapAnalysis,
  JobDescriptionProfile,
  ResumeProfile,
  TailoredBullet,
  TailoredExperience,
  TailoredResume,
} from "@/lib/schemas";

/** A bullet the model failed to return — keep the original, unchanged. */
function passthroughBullet(original: string): TailoredBullet {
  return {
    original,
    tailored: original,
    changeReason: "Kept as-is (no tailoring applied).",
    keywordsAddressed: [],
    confidence: "high",
  };
}

/**
 * Align model output to the originals: exactly one TailoredBullet per original
 * bullet, in order. Guards against the model dropping/adding entries.
 */
function alignBullets(
  originals: string[],
  produced: TailoredBullet[],
): TailoredBullet[] {
  return originals.map((original, i) => {
    const match =
      produced[i] ??
      produced.find((p) => p.original.trim() === original.trim());
    if (!match) return passthroughBullet(original);
    // Force the original to match verbatim so the diff is faithful.
    return { ...match, original };
  });
}

/**
 * Rewrite the resume for the JD: bullets per role (batched), plus a polished
 * summary and reordered skills. Truthfulness is enforced in the prompts; the
 * deterministic guardrail checker (Phase 4) runs on top of this output.
 */
export async function tailorResume(
  resume: ResumeProfile,
  jd: JobDescriptionProfile,
  gaps: GapAnalysis,
  client?: OpenAI,
): Promise<TailoredResume> {
  // Rewrite each role's bullets, one role per request (respects rate limits).
  const tailoredExperience: TailoredExperience[] = [];
  for (const role of resume.experience) {
    if (role.bullets.length === 0) {
      tailoredExperience.push({
        company: role.company,
        title: role.title,
        bullets: [],
      });
      continue;
    }
    const { bullets } = await runPrompt({
      ...bulletRewriterPrompt({ role, jd, gaps: gaps.gaps }),
      client,
    });
    tailoredExperience.push({
      company: role.company,
      title: role.title,
      bullets: alignBullets(role.bullets, bullets),
    });
  }

  // Polish summary + reorder skills (truthful; no new skills).
  let tailoredSummary = resume.summary;
  let tailoredSkills = resume.skills;
  try {
    const assembly = await runPrompt({
      ...finalAssemblyPrompt(resume, jd),
      client,
    });
    tailoredSummary = assembly.tailoredSummary || resume.summary;
    // Never allow a skill the candidate doesn't already have.
    const allowed = new Set(resume.skills.map((s) => s.toLowerCase()));
    const filtered = assembly.tailoredSkills.filter((s) =>
      allowed.has(s.toLowerCase()),
    );
    tailoredSkills = filtered.length ? filtered : resume.skills;
  } catch {
    // Optional step — fall back to originals if assembly fails.
  }

  return { tailoredSummary, tailoredSkills, tailoredExperience };
}
