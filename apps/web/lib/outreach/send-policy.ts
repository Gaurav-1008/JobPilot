/**
 * Platform-level send policy (P7.4.3, architecture.md §17).
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EC-P7-23 — THE STAGING OVERRIDE MUST NOT READ THE USER ROW.
 *
 * §17: "Staging's forced dry-run is a platform-level override that ignores the
 * user row. A staging bug must not be able to email a real person."
 *
 * The tempting implementation is to set `dry_run = true` on the staging users
 * and call it done. That is not an override, it is a default — and defaults are
 * exactly what a staging bug edits. Anything that can write a user row (a
 * seeding script, a settings page, a migration, a test fixture, a developer
 * poking at psql) silently re-arms real delivery, and nothing about the system
 * looks different afterward. The edge case says to test it by setting
 * `dry_run=false` on a staging user and confirming nothing sends, which is only
 * a meaningful test if the answer does not come from that column.
 *
 * So the policy is resolved from the ENVIRONMENT, before any row is read, and
 * the user row cannot promote it. The user row can only ever be more
 * conservative, never less.
 *
 * FAIL CLOSED ON MISCONFIGURATION (invariant 3). Real sending requires
 * `JOBPILOT_ENV` to be exactly "production". Unset, misspelled, or set to
 * something new resolves to forced dry-run. This is the direction that survives
 * a bad deploy: an environment variable that fails to propagate costs a
 * production user their sends for one deploy — visible, complained about,
 * fixed. The opposite default costs a staging bug somebody's real inbox, and
 * the first sign of that is a reply.
 * ═════════════════════════════════════════════════════════════════════════
 */

import { log } from "@/lib/obs/logger";

export type Environment = "local" | "staging" | "production";

/**
 * The one string that permits real delivery.
 *
 * Compared exactly — no trimming of arbitrary whitespace beyond the obvious, no
 * case folding, no "prod" alias. A near-miss must fail toward dry-run rather
 * than being helpfully interpreted, because the helpful interpretation is the
 * one that sends email.
 */
const PRODUCTION = "production";

export function environment(): Environment {
  const raw = process.env.JOBPILOT_ENV?.trim();
  if (raw === PRODUCTION) return "production";
  if (raw === "staging") return "staging";
  return "local";
}

/**
 * Does the platform force dry-run regardless of what the user asked for?
 *
 * True everywhere except production. §17 gives local a hard-forced DRY_RUN and
 * staging a forced override; the two are the same rule, and writing them as one
 * removes the possibility of a third environment quietly landing between them.
 */
export function platformForcesDryRun(): boolean {
  return environment() !== "production";
}

/**
 * Why sending is disabled, for the UI. Null when the platform permits sending.
 *
 * The review screen needs to say this BEFORE the user writes and approves an
 * email. Discovering at the end that the platform was never going to send is
 * the experience that makes people distrust the dry-run indicator entirely.
 */
export function platformDryRunReason(): string | null {
  switch (environment()) {
    case "production":
      return null;
    case "staging":
      return "This is the staging environment. Emails are simulated and never delivered, whatever your settings say.";
    default:
      return "This is a local environment. Emails are simulated and never delivered, whatever your settings say.";
  }
}

/**
 * Log the resolved policy once at boot.
 *
 * Called from the config validation at startup (P7.4.4), so the first line in
 * every deploy's log states plainly whether this instance can send email. That
 * is the fact you want to be able to check in ten seconds during an incident,
 * and the fact nobody can find when it is implied by three env vars.
 */
export function logSendPolicy(): void {
  log.info("send_policy.resolved", {
    name: environment(),
    status: platformForcesDryRun() ? "forced_dry_run" : "user_choice",
  });
}
