/**
 * Outreach grounding checks — L3 extended to email (P5.3.1, architecture.md §13.3).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE SCOPING RULE. READ THIS BEFORE CHANGING ANYTHING HERE.
 *
 * These checks police CLAIMS THE SENDER MAKES ABOUT THEMSELVES. They do not
 * police the rest of the email. Naming the company, its product, its recent
 * launch, or the role is research, not fabrication (EC-P5-35). A check applied
 * to every proper noun blocks every usable email, gets switched off within a
 * day, and then protects nothing.
 *
 * Three design gaps in the original §13.3 spec are corrected here. All three
 * were fatal — each one alone makes the feature unusable:
 *
 *   EC-P5-33  A named-person BLOCK that does not exclude the recipient's own
 *             name blocks "Hi Priya," — i.e. every personalized email.
 *   EC-P5-34  `topMatchedSkills` holds only the top THREE. Verifying claims
 *             against it flags skills the user genuinely has, on nearly every
 *             email. The payload is a PROMPT INPUT; the resume is the
 *             verification corpus.
 *   EC-P5-35  Company research reads as fabrication unless the checks are
 *             scoped to first-person claims.
 *
 * The first-person requirement below is what implements that scoping. "Your
 * team works with Kubernetes" is not a claim; "I have deep Kubernetes
 * experience" is. Dropping it reintroduces EC-P5-35 immediately.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * EC-P5-37 — on user edits, these run again and WARN rather than block. The
 * user is the accountable author of their own words; this guardrail exists to
 * stop the MODEL fabricating on their behalf. What must never happen is
 * skipping the re-check while the review screen still implies verification.
 */

import type { ResumeProfile } from "@jobpilot/shared-schemas";
import { buildResumeCorpus, corpusIncludes } from "@/lib/scoring";

export type GroundingSeverity = "block" | "flag";

export interface GroundingFinding {
  check: string;
  severity: GroundingSeverity;
  message: string;
  /** The phrase that tripped the check, so review shows evidence not a verdict. */
  evidence?: string;
}

export interface GroundingResult {
  blocked: boolean;
  findings: GroundingFinding[];
}

/**
 * Language asserting a relationship that never happened.
 *
 * A superset of ④'s BANNED_PHRASES: that validator gates the LLM's own output
 * inside ④, this one gates whatever actually reaches the review screen —
 * including a template that was edited afterwards. Neither trusts the other.
 */
const RELATIONSHIP_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bas (?:we )?discussed\b/i, label: "as discussed" },
  { pattern: /\bper our (?:conversation|call|chat|discussion)\b/i, label: "per our conversation" },
  { pattern: /\bfollowing up on our\b/i, label: "following up on our…" },
  { pattern: /\b(?:great|good|lovely) (?:speaking|talking|chatting) (?:with|to) you\b/i, label: "great speaking with you" },
  { pattern: /\bwhen we (?:met|spoke|talked)\b/i, label: "when we met" },
  { pattern: /\bwe met (?:at|in|during)\b/i, label: "we met at…" },
  { pattern: /\bas promised\b/i, label: "as promised" },
  { pattern: /\bnice to (?:see|meet) you again\b/i, label: "nice to see you again" },
  { pattern: /\bsince we last (?:spoke|talked|met)\b/i, label: "since we last spoke" },
];

/** Referral claims — someone else vouched for the sender. */
const REFERRAL_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\b(?:was |were )?referred (?:to you )?by\b/i, label: "referred by" },
  { pattern: /\breferred me\b/i, label: "referred me" },
  { pattern: /\bour mutual (?:friend|colleague|connection|contact)\b/i, label: "our mutual friend" },
  { pattern: /\b(?:your|a) (?:colleague|coworker|teammate)\s+\w+\s+(?:suggested|recommended|mentioned|told)\b/i, label: "your colleague suggested" },
  { pattern: /\b\w+\s+(?:suggested|recommended)\s+(?:that\s+)?I\s+(?:reach|get|contact|email)\b/i, label: "X suggested I reach out" },
  { pattern: /\bon the recommendation of\b/i, label: "on the recommendation of" },
  { pattern: /\bwho (?:suggested|recommended) I (?:reach|contact|email)\b/i, label: "who suggested I reach out" },
];

/** Credential vocabulary. A first-person claim to any of these needs resume backing. */
const CREDENTIAL_TERMS = [
  "phd", "doctorate", "master's", "masters", "mba", "m.tech", "mtech", "m.sc", "msc",
  "bachelor's", "bachelors", "b.tech", "btech", "b.sc", "bsc", "b.e.", "be degree",
  "degree in", "graduated from", "alumnus", "alumna",
  "certified", "certification", "certificate in",
  "aws certified", "pmp", "cissp", "cpa", "cfa", "scrum master",
];

const FIRST_PERSON = /\b(?:i|i'm|i've|i'll|my|me|myself|mine)\b/i;

/** Split into sentences so a claim is judged in its own clause, not the whole email. */
function sentences(body: string): string[] {
  return body
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isFirstPerson(sentence: string): boolean {
  return FIRST_PERSON.test(sentence);
}

/**
 * The verification corpus: the FULL resume, plus whatever the tailoring run
 * produced. Never `topMatchedSkills` — see EC-P5-34.
 */
function verificationCorpus(
  resume: ResumeProfile,
  tailoredBullets: string[],
): string {
  return [
    buildResumeCorpus(resume),
    ...tailoredBullets,
    ...resume.education.map((e) => `${e.degree ?? ""} ${e.institution ?? ""} ${e.field ?? ""}`),
    ...resume.certifications.map((c) => c.name),
  ].join("\n");
}

export interface GroundingInput {
  body: string;
  /** The full resume — the verification corpus. */
  resume: ResumeProfile;
  /** Tailored bullets, if a run exists; they are evidence too. */
  tailoredBullets?: string[];
  /** Skill vocabulary to test claims against (JD skills ∪ resume skills). */
  skillVocabulary?: string[];
  /** EC-P5-33: excluded from every name-based check. */
  recipientName?: string | null;
  /** EC-P5-33: the sender's own name is not a third party. */
  senderName?: string | null;
  wordLimit: number;
  wordCount: number;
  /** True when a payload existed but the hook came out generic. */
  hasPayload: boolean;
  genericHook: boolean;
}

export function checkGrounding(input: GroundingInput): GroundingResult {
  const findings: GroundingFinding[] = [];
  const corpus = verificationCorpus(input.resume, input.tailoredBullets ?? []);
  const parts = sentences(input.body);

  /* ---- BLOCK: claimed relationship or prior contact (§13.3 row 2) ---- */
  for (const { pattern, label } of RELATIONSHIP_PATTERNS) {
    const hit = parts.find((s) => pattern.test(s));
    if (hit) {
      findings.push({
        check: "claimed_relationship",
        severity: "block",
        message: "This claims a prior conversation that is not on record.",
        evidence: label,
      });
      break;
    }
  }

  /* ---- BLOCK: claimed referral (§13.3 row 2) ---- */
  for (const { pattern, label } of REFERRAL_PATTERNS) {
    const hit = parts.find((sentence) => {
      if (!pattern.test(sentence)) return false;
      // EC-P5-33: the recipient's own name and the sender's name are not third
      // parties. "Priya, I noticed…" must never read as a referral, and the
      // greeting contains the recipient's name in every personalized email.
      const stripped = stripKnownNames(sentence, input.recipientName, input.senderName);
      return pattern.test(stripped);
    });
    if (hit) {
      findings.push({
        check: "claimed_referral",
        severity: "block",
        message: "This claims someone referred or introduced you.",
        evidence: label,
      });
      break;
    }
  }

  /* ---- BLOCK: credential the resume does not support (§13.3 row 3) ---- */
  for (const sentence of parts) {
    if (!isFirstPerson(sentence)) continue;   // EC-P5-35 scoping
    const lowered = sentence.toLowerCase();
    const term = CREDENTIAL_TERMS.find((t) => lowered.includes(t));
    if (!term) continue;
    if (!corpusIncludes(corpus, term)) {
      findings.push({
        check: "unsupported_credential",
        severity: "block",
        message:
          "This claims a degree or certification that is not in your resume.",
        evidence: term,
      });
      break;
    }
  }

  /* ---- FLAG: skill claim not evidenced by the resume (§13.3 row 1) ---- */
  // EC-P5-34: verified against the FULL resume corpus, never the top-3 payload.
  const vocabulary = input.skillVocabulary ?? [];
  const flagged: string[] = [];
  for (const sentence of parts) {
    if (!isFirstPerson(sentence)) continue;   // EC-P5-35 scoping
    for (const skill of vocabulary) {
      if (!skill.trim() || flagged.includes(skill)) continue;
      if (!corpusIncludes(sentence, skill)) continue;
      if (corpusIncludes(corpus, skill)) continue;   // the resume backs it
      flagged.push(skill);
    }
  }
  for (const skill of flagged) {
    findings.push({
      check: "unsupported_skill",
      severity: "flag",
      message: `Your resume does not mention ${skill}. Check this claim before sending.`,
      evidence: skill,
    });
  }

  /* ---- FLAG: word limit (§13.3 row 4, existing behavior) ---- */
  if (input.wordCount > input.wordLimit) {
    findings.push({
      check: "word_limit",
      severity: "flag",
      message: `${input.wordCount} words — the limit is ${input.wordLimit}.`,
    });
  }

  /* ---- FLAG: generic hook despite evidence (§13.3 row 5) ---- */
  if (input.genericHook && input.hasPayload) {
    findings.push({
      check: "generic_hook",
      severity: "flag",
      message:
        "Tailoring evidence exists but the email did not use it — this usually means a payload bug.",
    });
  }

  return {
    blocked: findings.some((f) => f.severity === "block"),
    findings,
  };
}

/**
 * Remove the recipient's and sender's names before a name-sensitive test.
 *
 * EC-P5-33: without this, "Hi Priya," satisfies every "<name> suggested"
 * pattern that looks for a capitalized token, and the check blocks the entire
 * feature on its first real email.
 */
function stripKnownNames(
  sentence: string,
  recipientName?: string | null,
  senderName?: string | null,
): string {
  let out = sentence;
  for (const name of [recipientName, senderName]) {
    if (!name) continue;
    for (const part of name.split(/\s+/).filter((p) => p.length > 1)) {
      out = out.replace(new RegExp(`\\b${escapeRegex(part)}\\b`, "gi"), "");
    }
  }
  return out;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
