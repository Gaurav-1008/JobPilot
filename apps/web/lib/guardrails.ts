import type {
  Confidence,
  JobDescriptionProfile,
  ResumeProfile,
  TailoredBullet,
  TailoredResume,
} from "@/lib/schemas";
import { buildResumeCorpus, normalizeToken } from "@/lib/scoring";

/**
 * Deterministic truthfulness guardrails (architecture §7.1).
 *
 * Runs AFTER the LLM tailor step and BEFORE re-scoring. It never trusts the
 * model's self-reported confidence alone: it detects fabricated employers/titles,
 * invented metrics, credential claims, and JD technologies inserted without
 * resume evidence — then downgrades confidence and attaches riskFlags. Warn-first
 * (MVP): findings surface as warnings; the UI requires user verification before
 * export rather than hard-blocking.
 */

export type GuardrailType =
  | "new-employer"
  | "new-title"
  | "new-credential"
  | "new-metric"
  | "new-technology"
  | "keyword-spike";

export type GuardrailSeverity = "block" | "warn";

export interface GuardrailFinding {
  type: GuardrailType;
  severity: GuardrailSeverity;
  message: string;
  company?: string;
  bulletIndex?: number;
}

export interface GuardrailResult {
  tailored: TailoredResume;
  findings: GuardrailFinding[];
  warnings: string[];
  blocked: boolean;
}

const CREDENTIAL_TERMS = [
  "phd",
  "ph.d",
  "mba",
  "master's",
  "masters",
  "master of",
  "bachelor",
  "b.s.",
  "m.s.",
  "doctorate",
  "certified",
  "certification",
];

/* ------------------------------------------------------------------ */
/* Matching helpers (word-accurate to avoid false positives)           */
/* ------------------------------------------------------------------ */

/** Tokenize text into normalized word tokens (keeps + # . inside tokens). */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9+#.]+/)
      .map((t) => t.replace(/^\.+|\.+$/g, ""))
      .filter(Boolean),
  );
}

/**
 * Whole-term presence check. Multi-word terms use normalized substring; single
 * tokens require an exact token match so short skills ("Go", "R") don't match
 * inside longer words ("goal", "reduce").
 */
function mentions(text: string, tokens: Set<string>, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return false;
  if (/\s/.test(t)) {
    return normalizeToken(text).includes(normalizeToken(term));
  }
  return tokens.has(t.replace(/^\.+|\.+$/g, ""));
}

/** Extract normalized numeric/metric tokens (e.g. 40%, 3m, 500gb, 5+). */
export function extractMetrics(text: string): string[] {
  const matches = text
    .toLowerCase()
    .match(/\d[\d.,]*\s?(?:%|\+|k|m|b|gb|tb|mb|x|hrs?|hours?|days?)?/gi);
  if (!matches) return [];
  return matches
    .map((m) => m.replace(/\s+/g, "").replace(/,/g, "").replace(/\.$/, ""))
    .filter((m) => /\d/.test(m));
}

function downgrade(confidence: Confidence): Confidence {
  if (confidence === "high") return "medium";
  if (confidence === "medium") return "low";
  return "low";
}

function withRisk(bullet: TailoredBullet, note: string): TailoredBullet {
  const riskFlag = bullet.riskFlag ? `${bullet.riskFlag} ${note}` : note;
  return { ...bullet, confidence: downgrade(bullet.confidence), riskFlag };
}

/* ------------------------------------------------------------------ */
/* Main checker                                                        */
/* ------------------------------------------------------------------ */

export function checkTailoredResume(
  original: ResumeProfile,
  tailored: TailoredResume,
  jd?: JobDescriptionProfile,
): GuardrailResult {
  const findings: GuardrailFinding[] = [];

  const originalCorpus = buildResumeCorpus(original);
  const originalTokens = tokenize(originalCorpus);
  const allowedMetrics = new Set(extractMetrics(originalCorpus));

  const originalCompanies = new Set(
    original.experience.map((e) => e.company.trim().toLowerCase()),
  );
  const originalTitles = new Set(
    original.experience.map((e) => e.title.trim().toLowerCase()),
  );

  // Technologies we actively watch: JD required/preferred skills + tools.
  const watchedTech = jd
    ? [...jd.requiredSkills, ...jd.preferredSkills, ...jd.tools]
    : [];

  const adjustedExperience = tailored.tailoredExperience.map((role) => {
    // 1. Fabricated employer / title.
    if (!originalCompanies.has(role.company.trim().toLowerCase())) {
      findings.push({
        type: "new-employer",
        severity: "block",
        message: `Tailored output references an employer not in the resume: "${role.company}".`,
        company: role.company,
      });
    }
    if (!originalTitles.has(role.title.trim().toLowerCase())) {
      findings.push({
        type: "new-title",
        severity: "warn",
        message: `Tailored role title "${role.title}" at ${role.company} was not in the original resume.`,
        company: role.company,
      });
    }

    const bullets = role.bullets.map((bullet, bulletIndex) => {
      let adjusted = bullet;
      const tokens = tokenize(bullet.tailored);

      // 2. Invented metrics (numbers not anywhere in the original resume).
      const newMetrics = extractMetrics(bullet.tailored).filter(
        (m) => !allowedMetrics.has(m),
      );
      if (newMetrics.length > 0) {
        findings.push({
          type: "new-metric",
          severity: "warn",
          message: `Bullet introduces a metric not in your resume (${newMetrics.join(
            ", ",
          )}) — verify or remove.`,
          company: role.company,
          bulletIndex,
        });
        adjusted = withRisk(
          adjusted,
          `Unverified metric (${newMetrics.join(", ")}); confirm before use.`,
        );
      }

      // 3. JD technologies inserted without resume evidence.
      const insertedTech = watchedTech.filter(
        (tech) =>
          mentions(bullet.tailored, tokens, tech) &&
          !mentions(originalCorpus, originalTokens, tech),
      );
      if (insertedTech.length > 0) {
        findings.push({
          type: "new-technology",
          severity: "warn",
          message: `Bullet claims "${insertedTech.join(
            ", ",
          )}" which is not evidenced in your resume.`,
          company: role.company,
          bulletIndex,
        });
        adjusted = withRisk(
          adjusted,
          `Claims ${insertedTech.join(", ")} not found in your resume.`,
        );
      }

      // 4. Credential claims (degrees/certs) appearing in a rewritten bullet.
      const newCredentials = CREDENTIAL_TERMS.filter(
        (term) =>
          mentions(bullet.tailored, tokens, term) &&
          !mentions(originalCorpus, originalTokens, term),
      );
      if (newCredentials.length > 0) {
        findings.push({
          type: "new-credential",
          severity: "block",
          message: `Bullet introduces a credential claim not in your resume (${newCredentials.join(
            ", ",
          )}).`,
          company: role.company,
          bulletIndex,
        });
        adjusted = withRisk(
          adjusted,
          `Unsupported credential claim (${newCredentials.join(", ")}).`,
        );
      }

      return adjusted;
    });

    return { ...role, bullets };
  });

  // 5. Keyword-density spike vs the original resume.
  if (jd && jd.keywords.length) {
    const tailoredCorpus = adjustedExperience
      .flatMap((r) => r.bullets.map((b) => b.tailored))
      .join("\n");
    const before = countKeywordHits(originalCorpus, jd.keywords);
    const after = countKeywordHits(tailoredCorpus, jd.keywords);
    if (after >= 6 && after > before * 2.5) {
      findings.push({
        type: "keyword-spike",
        severity: "warn",
        message: `Keyword usage jumped sharply (${before} → ${after}). Ensure bullets still read naturally.`,
      });
    }
  }

  const adjusted: TailoredResume = {
    ...tailored,
    tailoredExperience: adjustedExperience,
  };

  return {
    tailored: adjusted,
    findings,
    warnings: summarize(findings),
    blocked: findings.some((f) => f.severity === "block"),
  };
}

function countKeywordHits(corpus: string, keywords: string[]): number {
  const norm = normalizeToken(corpus);
  return keywords.reduce(
    (n, kw) => (norm.includes(normalizeToken(kw)) ? n + 1 : n),
    0,
  );
}

/** Collapse findings into human-readable warnings (deduped by type). */
function summarize(findings: GuardrailFinding[]): string[] {
  const blocks = findings.filter((f) => f.severity === "block");
  const warnings: string[] = [];

  if (blocks.length) {
    warnings.push(
      `${blocks.length} potential fabrication${
        blocks.length === 1 ? "" : "s"
      } detected — review flagged items carefully before exporting.`,
    );
  }

  const counts = new Map<GuardrailType, number>();
  for (const f of findings.filter((x) => x.severity === "warn")) {
    counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
  }
  const label: Record<GuardrailType, string> = {
    "new-employer": "unrecognized employer",
    "new-title": "changed job title",
    "new-credential": "credential claim",
    "new-metric": "unverified metric",
    "new-technology": "unsupported technology claim",
    "keyword-spike": "keyword-density spike",
  };
  for (const [type, n] of counts) {
    warnings.push(`${n} ${label[type]}${n === 1 ? "" : "s"} — verify before export.`);
  }

  return warnings;
}
