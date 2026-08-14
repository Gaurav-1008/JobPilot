/**
 * Startup config validation — EC-P7-28, P7.4.4.
 *
 * The edge case: "Production .env missing a variable → a service starts and
 * fails at first use." The example that hurts is a missing ENCRYPTION_KEY,
 * discovered at first send — a `failed` outreach row for a real user, hours
 * after a deploy that was declared successful.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assertConfig, validateConfig, ConfigurationError } from "@/lib/config/require-env";

const SNAPSHOT = { ...process.env };

/** A complete, valid production environment. */
function productionEnv(): void {
  process.env.JOBPILOT_ENV = "production";
  process.env.DATABASE_URL = "postgresql://user:pw@host:6543/db";
  process.env.DIRECT_URL = "postgresql://user:pw@host:5432/db";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.ENCRYPTION_KEY = "a".repeat(64);   // 64 hex chars = 32 bytes
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.WORKER_SERVICE_URL = "http://worker:8000";
  process.env.WORKER_SERVICE_TOKEN = "svc-token";
  process.env.GROQ_API_KEY = "gsk_test";
  process.env.STORAGE_BUCKET = "jobpilot";
}

beforeEach(() => {
  // Start from a clean slate so a developer's real .env cannot make these pass.
  for (const key of Object.keys(process.env)) {
    if (/^(JOBPILOT_ENV|DATABASE_URL|DIRECT_URL|NEXT_PUBLIC_SUPABASE_URL|ENCRYPTION_KEY|REDIS_URL|WORKER_SERVICE_|GROQ_API_KEY|STORAGE_BUCKET|METRICS_TOKEN|FIRECRAWL_API_KEY|EMAIL_LLM_MODEL)/.test(key)) {
      delete process.env[key];
    }
  }
});

afterEach(() => {
  process.env = { ...SNAPSHOT };
});

describe("EC-P7-28 — production refuses to boot on missing config", () => {
  it("passes with a complete production environment", () => {
    productionEnv();
    const report = validateConfig();
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(() => assertConfig()).not.toThrow();
  });

  it("refuses to boot without ENCRYPTION_KEY", () => {
    // The edge case's own example. Missing here costs one failed deploy;
    // missing at first use costs a real user a failed send.
    productionEnv();
    delete process.env.ENCRYPTION_KEY;

    expect(() => assertConfig()).toThrow(ConfigurationError);
    // And it says what breaks, not just that something is missing.
    expect(validateConfig().errors.join(" ")).toMatch(/interlock check 11/);
  });

  it("rejects an ENCRYPTION_KEY of the wrong length", () => {
    // A wrong-length key fails identically to a missing one at first use, so
    // presence alone is not the check.
    productionEnv();
    process.env.ENCRYPTION_KEY = "too-short";

    const report = validateConfig();
    expect(report.ok).toBe(false);
    expect(report.errors.join(" ")).toMatch(/32 bytes/);
  });

  it("accepts a base64 key as well as hex", () => {
    productionEnv();
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    expect(validateConfig().ok).toBe(true);
  });

  it("reports every problem at once, not one per deploy", () => {
    // Fixing configuration one failed deploy per variable is a miserable loop,
    // and all the information needed to avoid it is available on the first pass.
    productionEnv();
    delete process.env.REDIS_URL;
    delete process.env.GROQ_API_KEY;
    delete process.env.STORAGE_BUCKET;

    const report = validateConfig();
    expect(report.errors).toHaveLength(3);
  });

  it("treats an empty string as missing", () => {
    // `FOO=` in a .env file is the classic half-configured variable.
    productionEnv();
    process.env.WORKER_SERVICE_TOKEN = "   ";
    expect(validateConfig().ok).toBe(false);
  });
});

describe("local development is not held to the production set", () => {
  it("boots with only the always-required variables", () => {
    // Requiring an S3 bucket and a Groq key to render a page locally would get
    // fake values set to get past the check, which measures patience rather
    // than configuration.
    process.env.JOBPILOT_ENV = "local";
    process.env.DATABASE_URL = "postgresql://localhost:5432/jobpilot";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:9999";

    expect(validateConfig().ok).toBe(true);
    expect(() => assertConfig()).not.toThrow();
  });

  it("still fails without a database — nothing works at all", () => {
    process.env.JOBPILOT_ENV = "local";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:9999";
    expect(validateConfig().ok).toBe(false);
  });

  it("warns about what production would have demanded", () => {
    // The difference between finding out now and finding out during a deploy.
    process.env.JOBPILOT_ENV = "local";
    process.env.DATABASE_URL = "postgresql://localhost:5432/jobpilot";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:9999";

    const report = validateConfig();
    expect(report.ok).toBe(true);
    expect(report.warnings.join(" ")).toMatch(/ENCRYPTION_KEY .*required in production/);
  });
});

describe("optional integrations warn, never fail", () => {
  it("does not fail production for a missing Firecrawl key", () => {
    // §18: hydration falls back to Playwright, then to manual paste. Failing
    // the boot for a degraded-but-working feature is how a config check earns
    // a reputation for crying wolf.
    productionEnv();
    const report = validateConfig();
    expect(report.ok).toBe(true);
    expect(report.warnings.join(" ")).toMatch(/FIRECRAWL_API_KEY/);
  });
});
