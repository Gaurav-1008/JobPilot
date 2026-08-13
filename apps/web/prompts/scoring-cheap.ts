/**
 * Tier-1 batch scoring prompt (P4.2.1) — targets SCORING_MODEL, not the main
 * tailoring model.
 *
 * Two things make this cheap, and both matter more than the model choice:
 *
 *   EC-P4-16  the RESUME IS SENT ONCE PER BATCH, not once per job. Repeating it
 *             per job turns a batch of 5 into 5 full-resume requests and the
 *             claimed ~40x saving evaporates. It is also capped, because a
 *             40-page resume is mostly irrelevant to ranking.
 *   EC-P4-08  every result carries its OWN jobId. Never index-mapped.
 */

/** EC-P4-16 — ranking needs skills and titles, not every bullet. */
export const MAX_RESUME_CHARS_TIER1 = 4_000;
/** Per-JD cap, so one enormous posting cannot dominate a batch. */
export const MAX_JD_CHARS_TIER1 = 2_500;

export interface Tier1JobInput {
  jobId: string;
  title: string;
  company: string;
  requiredSkills: string[];
  preferredSkills: string[];
  seniorityLevel: string | null;
}

export const SCORING_SYSTEM_PROMPT = `You score how well ONE candidate matches SEVERAL job descriptions.

Rules:
- Score 0-100. Be calibrated: 80+ means a strong fit a recruiter would shortlist; 40-60 means partial; below 30 means a poor fit.
- Judge ONLY on the evidence given. Never assume unstated experience.
- Return one result per job, each carrying the jobId it was given.
- explanation: ONE short sentence naming the decisive factor.

Return JSON exactly:
{"results":[{"jobId":"...","overallScore":0,"skillCoverageScore":0,"responsibilityAlignmentScore":0,"keywordScore":0,"seniorityScore":0,"criticalMissingRequirements":["..."],"explanation":"..."}]}`;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function buildScoringPrompt(
  resumeSummary: string,
  jobs: Tier1JobInput[],
): string {
  // One resume block, then N compact job blocks (EC-P4-16).
  const resume = truncate(resumeSummary, MAX_RESUME_CHARS_TIER1);

  const jobBlocks = jobs.map((j) => {
    const body = [
      `jobId: ${j.jobId}`,
      `title: ${j.title}`,
      `company: ${j.company}`,
      j.seniorityLevel ? `seniority: ${j.seniorityLevel}` : null,
      `required: ${j.requiredSkills.join(", ") || "(none listed)"}`,
      `preferred: ${j.preferredSkills.join(", ") || "(none listed)"}`,
    ].filter(Boolean).join("\n");
    return truncate(body, MAX_JD_CHARS_TIER1);
  });

  return [
    "CANDIDATE:",
    resume,
    "",
    `JOBS (${jobs.length}). Score each and echo its jobId:`,
    ...jobBlocks.map((b, i) => `--- job ${i + 1} ---\n${b}`),
  ].join("\n");
}

/**
 * A compact resume view for ranking: skills, titles, companies.
 *
 * Deliberately NOT the full bullet text. Ranking decides where to spend a
 * Tier-2 run; it does not need the detail Tier 2 will read anyway.
 */
export function summariseResumeForScoring(resume: {
  skills?: string[];
  summary?: string | null;
  experience?: Array<{ title?: string; company?: string; bullets?: string[] }>;
}): string {
  const parts: string[] = [];
  if (resume.summary) parts.push(resume.summary);
  if (resume.skills?.length) parts.push(`Skills: ${resume.skills.join(", ")}`);
  for (const e of resume.experience ?? []) {
    const first = e.bullets?.[0];
    parts.push(
      `${e.title ?? "role"} at ${e.company ?? "company"}` +
      (first ? ` — ${first}` : ""),
    );
  }
  return parts.join("\n");
}
