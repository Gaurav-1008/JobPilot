/**
 * Outreach grounding (P5.3.1, architecture.md §13.3).
 *
 * The three "design gap" cases (EC-P5-33/34/35) get the most attention here on
 * purpose: each one, left unfixed, blocks or flags essentially every real
 * email, and a guardrail that fires on everything gets switched off.
 */

import { describe, expect, it } from "vitest";

import type { ResumeProfile } from "@jobpilot/shared-schemas";
import { checkGrounding, type GroundingInput } from "@/lib/outreach/grounding";

const resume: ResumeProfile = {
  contact: { name: "Gaurav K", links: [] },
  summary: "Backend engineer working on payments infrastructure",
  skills: ["Python", "PostgreSQL", "Django", "Redis"],
  experience: [
    {
      company: "Acme",
      title: "Backend Engineer",
      bullets: ["Built a Python ingestion pipeline backed by PostgreSQL"],
    },
  ],
  projects: [],
  education: [
    { institution: "IIT Delhi", degree: "B.Tech", field: "Computer Science" },
  ],
  certifications: [{ name: "AWS Certified Solutions Architect" }],
};

function check(body: string, overrides: Partial<GroundingInput> = {}) {
  return checkGrounding({
    body,
    resume,
    tailoredBullets: [],
    skillVocabulary: ["Python", "PostgreSQL", "Kubernetes", "Terraform", "Rust"],
    recipientName: "Priya",
    senderName: "Gaurav K",
    wordLimit: 150,
    wordCount: 60,
    hasPayload: true,
    genericHook: false,
    ...overrides,
  });
}

describe("grounding — the design gaps that make or break the feature", () => {
  it("does NOT block a personalized greeting using the recipient's name (EC-P5-33)", () => {
    // As §13.3 was originally written, this blocked every personalized email.
    const result = check("Hi Priya,\n\nI'm Gaurav K, a backend engineer.");
    expect(result.blocked).toBe(false);
  });

  it("does NOT flag a skill that is in the resume but not the top-3 payload (EC-P5-34)", () => {
    // Django and Redis are real resume skills. Verifying against the truncated
    // payload instead of the resume would flag them on nearly every email.
    const result = check("I have worked with Python and PostgreSQL for six years.");
    expect(result.findings.filter((f) => f.check === "unsupported_skill")).toHaveLength(0);
  });

  it("does NOT treat company research as a claim about the sender (EC-P5-35)", () => {
    // Naming the company's stack is research. Only first-person claims count.
    const result = check(
      "Hi Priya,\n\nYour team works with Kubernetes and Terraform at scale.\n\nI build payment systems in Python.",
    );
    expect(result.blocked).toBe(false);
    expect(result.findings.filter((f) => f.check === "unsupported_skill")).toHaveLength(0);
  });
});

describe("grounding — blocks", () => {
  it("blocks a claimed prior conversation", () => {
    expect(check("Hi Priya,\n\nAs we discussed, I am keen on the role.").blocked).toBe(true);
    expect(check("Great speaking with you last week.").blocked).toBe(true);
    expect(check("Following up on our call about the platform role.").blocked).toBe(true);
  });

  it("blocks a claimed referral by a third party", () => {
    const result = check("Hi Priya,\n\nRahul suggested I reach out about this role.");
    expect(result.blocked).toBe(true);
    expect(result.findings.some((f) => f.check === "claimed_referral")).toBe(true);
  });

  it("blocks a credential the resume does not support", () => {
    const result = check("Hi Priya,\n\nI hold a PhD in distributed systems.");
    expect(result.blocked).toBe(true);
    expect(result.findings.some((f) => f.check === "unsupported_credential")).toBe(true);
  });

  it("allows a credential the resume DOES support", () => {
    // B.Tech and the AWS certification are both on the resume.
    expect(check("I'm AWS certified and finished my B.Tech at IIT Delhi.").blocked).toBe(
      false,
    );
  });
});

describe("grounding — flags", () => {
  it("flags a first-person claim to a skill absent from the resume", () => {
    const result = check("I have deep Kubernetes experience running production clusters.");
    expect(result.blocked).toBe(false);   // FLAG, never BLOCK
    expect(result.findings.some((f) => f.evidence === "Kubernetes")).toBe(true);
  });

  it("flags an over-limit body without blocking it", () => {
    const result = check("I build systems in Python.", { wordCount: 180 });
    expect(result.blocked).toBe(false);
    expect(result.findings.some((f) => f.check === "word_limit")).toBe(true);
  });

  it("flags a generic hook only when evidence was actually available", () => {
    const withPayload = check("I build systems.", { genericHook: true, hasPayload: true });
    expect(withPayload.findings.some((f) => f.check === "generic_hook")).toBe(true);

    // No payload means a generic hook is expected, not a bug.
    const without = check("I build systems.", { genericHook: true, hasPayload: false });
    expect(without.findings.some((f) => f.check === "generic_hook")).toBe(false);
  });
});

describe("grounding — findings carry evidence", () => {
  it("names the phrase that tripped the check rather than only a verdict", () => {
    const result = check("As we discussed, I am keen.");
    const finding = result.findings.find((f) => f.severity === "block");
    // The review screen shows the user WHY, so they can fix it themselves.
    expect(finding?.evidence).toBeTruthy();
    expect(finding?.message).toBeTruthy();
  });

  it("returns a clean result for an honest, evidence-backed email", () => {
    const result = check(
      "Hi Priya,\n\nI noticed Acme is hiring a Platform Engineer.\n\n" +
        "I'm Gaurav K; I built a Python ingestion pipeline on PostgreSQL at my last role.\n\n" +
        "Would you be open to a quick chat?\n\nBest,\nGaurav K",
    );
    expect(result.blocked).toBe(false);
    expect(result.findings).toHaveLength(0);
  });
});
