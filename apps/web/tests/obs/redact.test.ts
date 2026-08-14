/**
 * P7.3.2 — the redaction property, asserted rather than assumed.
 *
 * The exit checklist for Phase 7 says: "log a whole request object on purpose;
 * grep the output for the body and credentials". That is what most of this file
 * does. The tests are deliberately written as *searches over the output string*
 * rather than as assertions about specific keys, because the threat is a value
 * surviving under a key nobody predicted — asserting `out.password === undefined`
 * only tests the case the author already thought of.
 */

import { describe, expect, it } from "vitest";

import { hashEmail, redact, safeSerialize, __safeKeys } from "@/lib/obs/redact";

/** Values that must never appear in output, whatever wraps them. */
const SECRETS = {
  password: "hunter2-app-password",
  refreshToken: "1//0gRefreshTokenAAAA",
  body: "Hi Dana, I noticed your team is hiring for the platform role…",
  resume: "Gaurav Kashyap — Senior Engineer — led migration of…",
  address: "dana.recruiter@example.com",
};

function assertClean(serialized: string): void {
  for (const [label, value] of Object.entries(SECRETS)) {
    expect(serialized, `leaked ${label}`).not.toContain(value);
  }
}

describe("EC-P7-17 — allow-list redaction at the serializer", () => {
  it("redacts an entire request-shaped object logged by accident", () => {
    // The exact mistake the module exists to survive: someone logs `{ req }`.
    const request = {
      method: "POST",
      url: "https://api.example.com/email/deliver",
      headers: {
        authorization: "Bearer secret-token",
        "x-service-token": "svc-token-value",
      },
      body: {
        recipient: SECRETS.address,
        subject: "Following up on the platform role",
        body: SECRETS.body,
        credential: {
          smtpUser: "gaurav@example.com",
          smtpPassword: SECRETS.password,
          gmailRefreshToken: SECRETS.refreshToken,
        },
      },
    };

    const serialized = safeSerialize({ event: "debug", request });
    assertClean(serialized);
    // And it is still a useful line — the event survives.
    expect(JSON.parse(serialized).event).toBe("debug");
  });

  it("redacts a fetch-style error carrying the request that caused it", () => {
    // EC-P7-17's motivating case: nobody typed a banned key name. The
    // credential rides in on `config.data`, attached by an HTTP client.
    const err = Object.assign(new Error("Request failed with status 422"), {
      config: { data: JSON.stringify({ smtpPassword: SECRETS.password }) },
      response: { data: { recipient: SECRETS.address } },
    });

    const serialized = safeSerialize({ event: "worker.error", message: err });
    assertClean(serialized);
    // The operationally useful half survives.
    expect(serialized).toContain("Request failed with status 422");
  });

  it("keeps allow-listed operational fields intact", () => {
    const out = redact({
      event: "llm.call",
      model: "llama-3.3-70b",
      durationMs: 412,
      outcome: "ok",
      totalTokens: 1180,
      runId: "run_abc",
    }) as Record<string, unknown>;

    expect(out).toMatchObject({
      event: "llm.call",
      model: "llama-3.3-70b",
      durationMs: 412,
      outcome: "ok",
      totalTokens: 1180,
      runId: "run_abc",
    });
  });

  it("redacts unknown keys even when their values are harmless", () => {
    // The allow-list is the whole design: unrecognised means redacted, and
    // "but this one is fine" is a change made here, deliberately, not at a
    // call site.
    const out = redact({ favouriteColour: "blue" }) as Record<string, unknown>;
    expect(out.favouriteColour).toBe("[redacted]");
  });

  it("survives circular structures without hanging", () => {
    const a: Record<string, unknown> = { event: "cycle" };
    a.status = a;
    expect(() => safeSerialize(a)).not.toThrow();
  });

  it("never emits raw binary — resume bytes and ciphertext become a size", () => {
    const out = redact({ status: Buffer.from(SECRETS.resume) }) as Record<string, unknown>;
    expect(String(out.status)).toMatch(/^\[binary \d+b\]$/);
    expect(String(out.status)).not.toContain("Gaurav");
  });
});

describe("EC-P7-18 — recipient addresses are hashed, never written", () => {
  it("hashes an address embedded in an allow-listed free-text field", () => {
    // `message` is allow-listed because operators need it, and error messages
    // quote addresses constantly. So the scrub runs on the value, not the key.
    const serialized = safeSerialize({
      event: "outreach.blocked",
      message: `No mailbox for ${SECRETS.address}`,
    });

    expect(serialized).not.toContain(SECRETS.address);
    expect(serialized).toContain(`<email:${hashEmail(SECRETS.address)}>`);
  });

  it("hashes consistently, so correlation still works", () => {
    expect(hashEmail(SECRETS.address)).toBe(hashEmail(SECRETS.address));
    // Case and surrounding whitespace must not fork the identity.
    expect(hashEmail("  DANA.Recruiter@Example.COM ")).toBe(hashEmail(SECRETS.address));
  });

  it("distinguishes different people", () => {
    expect(hashEmail("a@example.com")).not.toBe(hashEmail("b@example.com"));
  });
});

describe("the allow-list itself", () => {
  it("contains no key that names payload content", () => {
    // A guard against the list drifting toward convenience over time. If one of
    // these is ever genuinely needed, it needs a different name AND a reason
    // written down — not a quiet addition during a debugging session.
    const forbidden = [
      "body", "subject", "prompt", "completion", "resume", "resumeText",
      "jdText", "email", "recipient", "recipientEmail", "password",
      "smtpPassword", "token", "refreshToken", "credential", "credentials",
      "config", "data", "request", "response", "headers", "authorization",
    ];
    const keys = __safeKeys();
    for (const key of forbidden) {
      expect(keys.has(key), `allow-list must not contain "${key}"`).toBe(false);
    }
  });
});
