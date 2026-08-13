/**
 * The personalization payload (P5.2.1, FR7, architecture.md §14.2).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS IS A PURE FUNCTION AND MUST STAY ONE.
 *
 * It reads a persisted TailoringRun and returns a payload. No LLM, no I/O, no
 * clock, no randomness — which is what makes the FR7 claim testable: every
 * field in an outreach email traces back to a row that already existed before
 * the email was written. If a claim shows up in someone's inbox, its source is
 * in the database.
 *
 * The consequence for reviewers: this file may never gain a `fetch`, a
 * `prisma` import, or a "just fill in a sensible default" branch. A generated
 * value here is indistinguishable from a fabricated one downstream.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A note on the shape. architecture.md §14.2 sketches this as
 * `run.matchScore.skillCoverage.matched` / `run.bulletChanges` / `run.gaps`.
 * Those paths do not exist on TailoringRun — the sketch predates the schema in
 * shared-schemas/domain.ts. The real sources are derived below and marked; the
 * semantics of §14.2 are preserved exactly, only the traversal differs.
 */

import type {
  PersonalizationPayload,
  TailoringRun,
} from "@jobpilot/shared-schemas";
import { buildResumeCorpus, coverage } from "@/lib/scoring";

/** §14.2 keeps the payload deliberately small — three skills, two hooks. */
const MAX_SKILLS = 3;
const MAX_HOOKS = 2;

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 } as const;

/**
 * The strongest bullet the tailoring run produced.
 *
 * "Strongest" is highest confidence, ties broken by earliest position, so the
 * function is deterministic — two calls on the same run must never disagree, or
 * the body hash the user approved stops being reproducible.
 *
 * Reads the TAILORED text, not the original: that is the sentence the user
 * reviewed and accepted, and it is the one guardrails already cleared.
 */
function strongestBullet(run: TailoringRun): string | null {
  const bullets = (run.tailoredResume?.tailoredExperience ?? []).flatMap(
    (role) => role.bullets,
  );
  if (bullets.length === 0) return null;   // EC-P5-21

  let best = bullets[0];
  for (const bullet of bullets.slice(1)) {
    if (CONFIDENCE_RANK[bullet.confidence] > CONFIDENCE_RANK[best.confidence]) {
      best = bullet;
    }
  }
  return best.tailored || null;
}

/**
 * Skills the JD asks for that the resume actually evidences.
 *
 * Required skills come first: a matched *required* skill is stronger evidence
 * of fit than a matched preferred one, and only the first three survive.
 *
 * This is the §14.2 `skillCoverage.matched` idea, computed from the two
 * artifacts the run persisted (resume + JD profile) with the same `coverage()`
 * the scorer uses — so the email and the score cannot disagree about what
 * "matched" means.
 */
function topMatchedSkills(run: TailoringRun): string[] {
  const corpus = buildResumeCorpus(run.resume);
  const required = coverage(corpus, run.jobDescription.requiredSkills).matched;
  const preferred = coverage(corpus, run.jobDescription.preferredSkills).matched;

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const skill of [...required, ...preferred]) {
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(skill);
    if (ordered.length === MAX_SKILLS) break;
  }
  return ordered;
}

/**
 * Build the payload for a run.
 *
 * EC-P5-20: callers pass `null` when no run exists; this function is never
 * asked to invent one. Generation then falls back to the six-part template with
 * a generic-hook warning.
 *
 * EC-P5-27: only `tier='full'` runs carry bullet evidence. The repository
 * accessor (`tailoringRuns.latestFullForApplication`) already filters on tier,
 * so a cheap run cannot reach here — a cheap run has a score but nothing to
 * cite, and citing a score is not personalization.
 */
export function buildPayload(run: TailoringRun): PersonalizationPayload {
  return {
    topMatchedSkills: topMatchedSkills(run),
    strongestBullet: strongestBullet(run),
    // EC-P5-25: domainSignals originate in third-party JD text. They are DATA.
    // The generator must delimit them as such — see the prompt in ④.
    jdHooks: run.jobDescription.domainSignals.slice(0, MAX_HOOKS),
    // The score the user would actually be sending on: the tailored resume when
    // one exists, otherwise the original. EC-P5-23: this is context for the
    // writer, never a claim in the body — a 31 still generates.
    matchScore: Math.round(
      run.tailoredMatch?.overallScore ?? run.originalMatch.overallScore,
    ),
    // EC-P5-24: a SUPPRESSION list. These are the things the email must not
    // claim competence in. Never content.
    honestGaps: run.gapAnalysis.gaps
      .filter((gap) => gap.importance === "high")
      .map((gap) => gap.name),
  };
}

/**
 * EC-P5-22 — an empty `topMatchedSkills` produces a generic hook, and per FR7
 * that now signals a payload BUG worth investigating rather than merely a weak
 * email. Surfaced separately from the payload so the caller can log it as a
 * quality metric instead of silently shipping a generic email.
 */
export function payloadIsWeak(payload: PersonalizationPayload | null): boolean {
  return payload === null || payload.topMatchedSkills.length === 0;
}

/** snake_case mirror for the ①→④ wire (§8, EC-P0-17). */
export function toWirePersonalization(payload: PersonalizationPayload) {
  return {
    top_matched_skills: payload.topMatchedSkills,
    strongest_bullet: payload.strongestBullet,
    jd_hooks: payload.jdHooks,
    match_score: payload.matchScore,
    honest_gaps: payload.honestGaps,
  };
}
