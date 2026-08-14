import type {
  JobDescriptionProfile,
  ResumeProfile,
  TailoredResume,
} from "@/lib/schemas";

/**
 * Deterministic scoring helpers.
 *
 * These seed the LLM match-scoring prompt with consistent, explainable signals
 * so scores don't drift run-to-run. Pure functions — unit-tested directly.
 */

/** Normalize a token for fuzzy comparison: lowercase, strip non-alphanumerics. */
export function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+#.]/g, "");
}

/** True if `needle` appears in the resume corpus (substring, normalized). */
export function corpusIncludes(corpus: string, needle: string): boolean {
  const n = normalizeToken(needle);
  if (!n) return false;
  return normalizeToken(corpus).includes(n);
}

/** Flatten a resume into a single searchable text blob. */
export function buildResumeCorpus(resume: ResumeProfile): string {
  const parts: string[] = [resume.summary, ...resume.skills];
  for (const exp of resume.experience) {
    parts.push(exp.title, exp.company, ...exp.bullets);
  }
  for (const proj of resume.projects) {
    parts.push(proj.name, proj.description ?? "", ...proj.bullets);
  }
  for (const cert of resume.certifications) parts.push(cert.name);
  return parts.filter(Boolean).join("\n");
}

/** Flatten a tailored resume into a corpus for re-scoring. */
export function buildTailoredCorpus(tailored: TailoredResume): string {
  const parts: string[] = [
    tailored.tailoredSummary,
    ...tailored.tailoredSkills,
  ];
  for (const role of tailored.tailoredExperience) {
    parts.push(role.title, role.company);
    for (const b of role.bullets) parts.push(b.tailored);
  }
  return parts.filter(Boolean).join("\n");
}

export interface CoverageResult {
  matched: string[];
  missing: string[];
  pct: number;
}

/**
 * Which of `items` are evidenced in the corpus.
 *
 * `items` is optional rather than required-and-trusted. A JobDescription
 * profile can legitimately be partial — the hydrate handler writes `{}` when it
 * saves raw text before extraction succeeds — and a missing array threw
 * "items is not iterable" from deep inside the scorer, which failed an entire
 * batch rather than the one row that caused it.
 */
export function coverage(corpus: string, items?: string[] | null): CoverageResult {
  const matched: string[] = [];
  const missing: string[] = [];
  for (const item of items ?? []) {
    if (corpusIncludes(corpus, item)) matched.push(item);
    else missing.push(item);
  }
  // Nothing asked for is 100% covered — the same rule an empty array already
  // had, now reached by a missing one too.
  const total = matched.length + missing.length;
  const pct = total ? Math.round((matched.length / total) * 100) : 100;
  return { matched, missing, pct };
}

export interface DeterministicSignals {
  requiredMatched: string[];
  requiredMissing: string[];
  preferredMatched: string[];
  skillCoveragePct: number;
  keywordCoveragePct: number;
}

/** Compute all deterministic signals for a resume corpus vs a JD. */
export function computeSignals(
  corpus: string,
  jd: JobDescriptionProfile,
): DeterministicSignals {
  const required = coverage(corpus, jd.requiredSkills);
  const preferred = coverage(corpus, jd.preferredSkills);
  const keywords = coverage(corpus, jd.keywords);
  return {
    requiredMatched: required.matched,
    requiredMissing: required.missing,
    preferredMatched: preferred.matched,
    skillCoveragePct: required.pct,
    keywordCoveragePct: keywords.pct,
  };
}
