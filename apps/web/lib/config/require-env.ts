/**
 * Startup configuration validation (P7.4.4, EC-P7-28).
 *
 * ═════════════════════════════════════════════════════════════════════════
 * A MISSING VARIABLE MUST STOP THE BOOT, NOT THE FIRST USER.
 *
 * EC-P7-28: "Production .env missing a variable → a service starts and fails at
 * first use." The example the edge case gives is the one that hurts — a missing
 * `ENCRYPTION_KEY` discovered at first send is a `failed` outreach row for a
 * real person who did everything right, hours after the deploy that caused it,
 * with the deploy long since declared successful.
 *
 * Config errors are the one class of failure that is FULLY KNOWABLE at startup.
 * There is no reason to discover them later, and every reason not to: at boot
 * the failure is loud, attributable to the deploy that caused it, and costs
 * nobody anything, because a container that refuses to start never takes
 * traffic. Rolling deploys make this strictly better — the old version keeps
 * serving while the new one refuses to come up.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IS REQUIRED DEPENDS ON THE ENVIRONMENT, AND THAT IS THE POINT.
 *
 * Requiring the full production set locally would make `npm run dev` demand an
 * S3 bucket and a Groq key to render a page. Developers would then set fake
 * values to get past it, and the check would be measuring their patience rather
 * than the configuration.
 *
 * So local requires the minimum to boot, and production requires everything a
 * request can reach. The middle ground — a variable whose absence degrades a
 * feature rather than breaking the service — is a WARNING, listed at startup and
 * not fatal. Failing the boot for a missing optional integration is how a config
 * check earns a reputation for crying wolf.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { environment, logSendPolicy } from "@/lib/outreach/send-policy";
import { log } from "@/lib/obs/logger";

export class ConfigurationError extends Error {
  readonly code = "CONFIGURATION_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

interface Requirement {
  name: string;
  why: string;
  /** Extra validation beyond presence. Returns an error message or null. */
  validate?: (value: string) => string | null;
}

/** Everywhere, including local: without these nothing works at all. */
const ALWAYS: Requirement[] = [
  {
    name: "DATABASE_URL",
    why: "every request reads or writes Postgres",
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_URL",
    why: "sessions cannot be validated without GoTrue",
  },
];

/**
 * Production only. Each of these has a request path that reaches it, and each
 * absence is a user-visible failure rather than a degraded feature.
 */
const PRODUCTION: Requirement[] = [
  {
    name: "DIRECT_URL",
    why: "migrations need a direct connection; pgbouncer in transaction mode cannot run DDL (§22.1)",
  },
  {
    name: "ENCRYPTION_KEY",
    why: "sender credentials cannot be stored, and every real send blocks at interlock check 11",
    // Checked HERE rather than at first use, which is the entire edge case: a
    // key of the wrong length fails identically to a missing one, and both
    // surface as a failed send for a real user hours after the deploy.
    validate: (value) => {
      const trimmed = value.trim();
      const bytes = /^[0-9a-fA-F]{64}$/.test(trimmed)
        ? 32
        : Buffer.from(trimmed, "base64").length;
      return bytes === 32
        ? null
        : "must be 32 bytes — 64 hex characters or base64. Generate one with: openssl rand -hex 32";
    },
  },
  {
    name: "REDIS_URL",
    why: "harvest and hydration are queued; without it they are unavailable (§18)",
  },
  {
    name: "WORKER_SERVICE_URL",
    why: "harvest, hydration, and delivery all call ④",
  },
  {
    name: "WORKER_SERVICE_TOKEN",
    why: "④ refuses unauthenticated calls in production, so an empty token fails every request to it",
  },
  {
    name: "GROQ_API_KEY",
    why: "scoring and tailoring are LLM paths with no offline fallback above Tier 0",
  },
  {
    name: "STORAGE_BUCKET",
    why: "resume uploads and PDF exports have nowhere to go",
  },
];

/**
 * Absence degrades something without breaking the service. Warn, never fail.
 */
const OPTIONAL: Requirement[] = [
  {
    name: "METRICS_TOKEN",
    why: "/api/metrics stays closed, so nothing can scrape the §16.2 counters",
  },
  {
    name: "FIRECRAWL_API_KEY",
    why: "hydration falls back to Playwright, then to manual paste (§18)",
  },
  {
    name: "EMAIL_LLM_MODEL",
    why: "outreach generation falls back to the deterministic template (§18)",
  },
];

export interface ValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Check configuration without throwing. Exported so a test — and a health
 * endpoint — can inspect the result rather than catching an exception.
 */
export function validateConfig(): ValidationReport {
  const env = environment();
  const required = env === "production" ? [...ALWAYS, ...PRODUCTION] : ALWAYS;

  const errors: string[] = [];
  const warnings: string[] = [];

  for (const req of required) {
    const value = process.env[req.name];
    if (!value?.trim()) {
      errors.push(`${req.name} is not set — ${req.why}.`);
      continue;
    }
    const problem = req.validate?.(value);
    if (problem) errors.push(`${req.name} ${problem}`);
  }

  for (const opt of OPTIONAL) {
    if (!process.env[opt.name]?.trim()) {
      warnings.push(`${opt.name} is not set — ${opt.why}.`);
    }
  }

  // Outside production, note what production would have demanded. This is the
  // difference between finding out now and finding out during a deploy.
  if (env !== "production") {
    for (const req of PRODUCTION) {
      if (!process.env[req.name]?.trim()) {
        warnings.push(`${req.name} is not set — required in production (${req.why}).`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Validate at startup and refuse to boot on any error.
 *
 * Errors are printed as a LIST rather than thrown one at a time. Fixing config
 * one failed deploy per variable is a miserable loop, and the information to
 * avoid it is all available on the first pass.
 */
export function assertConfig(): void {
  const report = validateConfig();

  for (const warning of report.warnings) {
    log.warn("config.warning", { message: warning, outcome: "degraded" });
  }

  if (!report.ok) {
    for (const error of report.errors) {
      log.error("config.invalid", { message: error, outcome: "error" });
    }
    throw new ConfigurationError(
      `Refusing to start: ${report.errors.length} configuration problem${
        report.errors.length === 1 ? "" : "s"
      }.\n\n  ${report.errors.join("\n  ")}\n`,
    );
  }

  // First line in every deploy's log: can this instance send email? That is the
  // fact you want answerable in ten seconds during an incident, and the fact
  // nobody can find when it is implied by three variables (EC-P7-23).
  logSendPolicy();
  log.info("config.validated", { outcome: "ok", count: report.warnings.length });
}
