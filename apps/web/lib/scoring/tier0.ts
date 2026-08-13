/**
 * Tier-0 heuristic scoring (P4.1.1) — zero tokens, ~1ms per job.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EC-P4-01, CORRECTED. The plan said to promote `lib/heuristic-resume.ts`.
 * That file is 51 lines of `detectSections()` and `looksLikeResume()` — pure
 * display-only section splitting, with no notion of skills, comparison, or
 * scoring. It cannot be promoted; the marker should have been 🔴 NEW.
 *
 * But the edge case pointed at the wrong file. `lib/scoring.ts` ALREADY has the
 * deterministic machinery this needs — `computeSignals()` returns required /
 * preferred / keyword coverage against a JD profile, and is the same code the
 * Tier-2 chain uses. So this is a thin layer over proven code after all, just
 * not the code the plan named.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * EC-P4-03: a constant score across every job almost always means the resume
 * failed to parse into skills, not that every job fits equally. Callers should
 * log it rather than present it as a ranking.
 */

import type { JobDescriptionProfile, ResumeProfile } from "@/lib/schemas";
import { buildResumeCorpus, computeSignals, normalizeToken } from "@/lib/scoring";

export interface Tier0Score {
  /** 0-100. ADVISORY — see the floor note below. */
  score: number;
  skillCoveragePct: number;
  keywordCoveragePct: number;
  titleSimilarity: number;
  seniorityMatch: number;
  matchedRequired: string[];
  missingRequired: string[];
}

/**
 * EC-P4-01/P4.1.3 — a FLOOR, not a filter. Jobs below it are surfaced under a
 * "low fit" view and remain fully tailorable. A heuristic must never be the
 * reason a user cannot reach a job they want.
 */
export const DEFAULT_TIER0_FLOOR = 20;

const SENIORITY_RANK: Record<string, number> = {
  intern: 0, junior: 1, associate: 1, entry: 1,
  mid: 2, intermediate: 2,
  senior: 3, lead: 4, staff: 4, principal: 5,
  manager: 4, director: 5, head: 5, vp: 6,
};

function seniorityOf(text: string): number | null {
  const t = normalizeToken(text);
  for (const [word, rank] of Object.entries(SENIORITY_RANK)) {
    if (t.includes(word)) return rank;
  }
  return null;
}

/** Token overlap, ignoring order. Cheap and good enough to rank. */
function titleSimilarity(resumeTitles: string[], jdTitle: string): number {
  const jdTokens = new Set(
    normalizeToken(jdTitle).split(/\s+/).filter((w) => w.length > 2),
  );
  if (jdTokens.size === 0) return 0;

  let best = 0;
  for (const title of resumeTitles) {
    const tokens = new Set(
      normalizeToken(title).split(/\s+/).filter((w) => w.length > 2),
    );
    let hits = 0;
    for (const t of jdTokens) if (tokens.has(t)) hits += 1;
    best = Math.max(best, hits / jdTokens.size);
  }
  return Math.round(best * 100);
}

/**
 * EC-P4-04/05 — guard BOTH denominators. A resume that failed to parse (no
 * skills) and a JD with no extractable requirements both produce division by
 * zero, and both are real: EC-P3-26 lets an empty-profile JD exist.
 */
export function scoreTier0(
  resume: ResumeProfile,
  jd: JobDescriptionProfile,
): Tier0Score {
  const corpus = buildResumeCorpus(resume);
  const signals = computeSignals(corpus, jd);

  const resumeTitles = (resume.experience ?? []).map((e) => e.title ?? "");
  const titleSim = jd.jobTitle ? titleSimilarity(resumeTitles, jd.jobTitle) : 0;

  // Seniority: 100 when equal, decaying by distance. Unknown on either side is
  // NEUTRAL (50), not zero — absence of evidence is not a mismatch.
  const jdRank = jd.seniorityLevel ? seniorityOf(jd.seniorityLevel) : null;
  const resumeRank = resumeTitles
    .map(seniorityOf)
    .filter((r): r is number => r !== null)
    .reduce<number | null>((max, r) => (max === null ? r : Math.max(max, r)), null);
  const seniorityMatch =
    jdRank === null || resumeRank === null
      ? 50
      : Math.max(0, 100 - Math.abs(jdRank - resumeRank) * 25);

  const hasRequirements = jd.requiredSkills.length > 0;
  const hasSkills = (resume.skills ?? []).length > 0 || corpus.length > 0;

  // A JD with no extractable requirements cannot be scored honestly. Return 0
  // with the reason visible in the sub-scores rather than inventing a number.
  if (!hasRequirements || !hasSkills) {
    return {
      score: 0,
      skillCoveragePct: 0,
      keywordCoveragePct: 0,
      titleSimilarity: titleSim,
      seniorityMatch,
      matchedRequired: [],
      missingRequired: jd.requiredSkills,
    };
  }

  // Weights: required-skill coverage dominates, because it is the signal a
  // human actually screens on. Keywords are noisy; title is a weak proxy.
  const score = Math.round(
    signals.skillCoveragePct * 0.5 +
    signals.keywordCoveragePct * 0.15 +
    titleSim * 0.2 +
    seniorityMatch * 0.15,
  );

  return {
    score: Math.min(100, Math.max(0, score)),
    skillCoveragePct: signals.skillCoveragePct,
    keywordCoveragePct: signals.keywordCoveragePct,
    titleSimilarity: titleSim,
    seniorityMatch,
    matchedRequired: signals.requiredMatched,
    missingRequired: signals.requiredMissing,
  };
}
