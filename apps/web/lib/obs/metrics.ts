/**
 * The §16.2 metric set (P7.3.3).
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EC-P7-20 — LABEL VALUES ARE CLOSED ENUMERATIONS, CHECKED AT RUNTIME.
 *
 * A metric label carrying `userId` produces one time series per user, forever.
 * Every managed metrics backend either degrades or bills by series count, and
 * the failure arrives weeks after the commit, in an invoice or a paging storm,
 * far from the line that caused it.
 *
 * Types alone do not prevent this — `board: string` accepts an id perfectly
 * well, and the caller who writes `{ board: job.id }` is having a bad day, not
 * being reckless. So every label here declares its permitted VALUES, and
 * anything else collapses to `"other"` plus one warning line. Cardinality is
 * then bounded by construction: the product of the declared enumerations,
 * countable by reading this file.
 *
 * `"other"` rather than dropping the sample: a metric that silently loses data
 * when a new board is added is worse than one that shows a growing `other`
 * bucket, which is a visible prompt to come here and add the value.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * EC-P7-21 — `interlock_block_total` needs a second dimension, not a second
 * metric. Blocks at checks 5 and 6 (opt-out, dedup) are the system working as
 * designed and will fire constantly; blocks at checks 2 and 3 (token, body
 * hash) mean a bug or an attack and should page someone. One counter where both
 * are equally weighted gets muted within a week — and it gets muted precisely
 * because the routine blocks are noisy, which is the same act as switching off
 * the attack signal. The `class` label below splits them so a dashboard can
 * alert on `class="fault"` and merely chart `class="expected"`.
 *
 * TRANSPORT. There is no metrics backend provisioned yet (§17 lists Postgres,
 * Redis, and object storage as the managed dependencies; a TSDB is not among
 * them). Counters are therefore held in-process and also written as structured
 * log lines with a stable `event` name, which is the form a log-based collector
 * scrapes. `/api/metrics` renders the registry in Prometheus text format, so
 * pointing a real scraper at this costs a URL and no call-site changes.
 *
 * In-process counters reset on deploy and are per-instance. For counters that
 * is the normal case — Prometheus `rate()` handles resets, and per-instance is
 * what a scraper expects — so this is not the compromise it looks like.
 */

import { log } from "./logger";

/* ------------------------------------------------------------------ */
/* Label vocabularies                                                  */
/* ------------------------------------------------------------------ */

const BOARDS = ["remoteok", "wellfound", "naukri", "manual", "other"] as const;
const OUTCOMES = ["ok", "failed", "blocked", "timeout", "skipped", "other"] as const;
const HYDRATION_METHODS = ["cache", "firecrawl", "playwright", "manual", "other"] as const;
const PROVIDERS = ["smtp", "gmail_api", "dry_run", "other"] as const;
const TIERS = ["heuristic", "cheap", "full", "other"] as const;
const CACHE_RESULTS = ["hit", "miss", "other"] as const;

/**
 * Prompt names are ours and finite. Listed explicitly rather than accepting any
 * string, because a prompt name interpolated with a run id is exactly the kind
 * of accident this file exists to stop.
 */
const PROMPTS = [
  "jd_parse", "resume_parse", "score_cheap", "score_full",
  "bullet_rewrite", "gap_analysis", "email_generate", "followup_generate",
  "other",
] as const;

const GUARDRAIL_TYPES = [
  "fabricated_employer", "fabricated_metric", "unsupported_skill",
  "word_limit", "generic_hook", "ungrounded_claim", "other",
] as const;

const INTERLOCK_CHECKS = [
  "authz", "approval_token", "body_integrity", "contact_valid", "opt_out",
  "dedup", "volume_cap", "word_limit", "grounding", "credentials",
  "send_mode", "internal_error", "other",
] as const;

/**
 * EC-P7-21's split, derived from the check rather than passed in — a caller
 * choosing the class per call site is a caller who will eventually disagree
 * with another call site about what "expected" means.
 */
const INTERLOCK_CLASS: Record<string, "expected" | "fault" | "config"> = {
  // The system working. Loud, and that is correct.
  opt_out: "expected",
  dedup: "expected",
  volume_cap: "expected",
  // A bug or an attack. Rare; should page.
  approval_token: "fault",
  body_integrity: "fault",
  authz: "fault",
  internal_error: "fault",
  // The user has something to fix, or an operator does.
  contact_valid: "config",
  word_limit: "config",
  grounding: "config",
  credentials: "config",
  send_mode: "config",
};

/**
 * Anything that looks like an identifier, whatever enumeration it claims to
 * belong to. Defence in depth behind the enumerations: a future metric added
 * with a permissive vocabulary still cannot smuggle a UUID or an address into
 * a label.
 */
const ID_SHAPED =
  /^[0-9a-f]{8}-[0-9a-f]{4}-|^[0-9a-f]{24,}$|@|^\d{6,}$/i;

function bound<T extends readonly string[]>(
  allowed: T,
  value: string,
  metric: string,
  label: string,
): T[number] {
  if ((allowed as readonly string[]).includes(value) && !ID_SHAPED.test(value)) {
    return value;
  }
  // One line, not one per sample: this is a code defect and the operator needs
  // to see it once, not to have it drown the log it is reported in.
  warnOnce(`${metric}.${label}.${value}`, () =>
    log.warn("metric.label_rejected", {
      name: metric,
      // The offending value is NOT logged. If it is a userId — the case this
      // guard exists for — writing it here relocates the leak rather than
      // stopping it. The metric and label name are enough to find the caller.
      check: label,
      outcome: "other",
    }),
  );
  return "other" as T[number];
}

const warned = new Set<string>();
function warnOnce(key: string, fn: () => void): void {
  if (warned.has(key)) return;
  warned.add(key);
  fn();
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

interface Series {
  name: string;
  labels: Record<string, string>;
  value: number;
}

const g = globalThis as unknown as { __jobpilotMetrics?: Map<string, Series> };
const registry = (g.__jobpilotMetrics ??= new Map<string, Series>());

function key(name: string, labels: Record<string, string>): string {
  const parts = Object.keys(labels).sort().map((k) => `${k}=${labels[k]}`);
  return `${name}{${parts.join(",")}}`;
}

function increment(name: string, labels: Record<string, string>, by = 1): void {
  const id = key(name, labels);
  const existing = registry.get(id);
  if (existing) existing.value += by;
  else registry.set(id, { name, labels, value: by });

  // Also a log line, so a log-based collector sees it without a scraper and so
  // the counter survives this process. `event` is the metric name verbatim.
  log.info(name, { ...labels, count: by });
}

/* ------------------------------------------------------------------ */
/* The §16.2 metrics                                                   */
/* ------------------------------------------------------------------ */

/** Is a board silently degrading? */
export function harvestBoardOutcome(board: string, status: string): void {
  increment("harvest_board_outcome_total", {
    board: bound(BOARDS, board, "harvest_board_outcome_total", "board"),
    status: bound(OUTCOMES, status, "harvest_board_outcome_total", "status"),
  });
}

/** Is the fallback chain working, or is one method carrying everything? */
export function hydrationOutcome(method: string, status: string): void {
  increment("hydration_outcome_total", {
    method: bound(HYDRATION_METHODS, method, "hydration_outcome_total", "method"),
    status: bound(OUTCOMES, status, "hydration_outcome_total", "status"),
  });
}

/**
 * §16.2 names `jd_cache_hit_ratio`. A ratio is not something you emit — it is
 * something you compute from two counters at query time, and emitting it
 * directly loses the volume that says whether the ratio means anything. So the
 * counter is hits and misses, and the ratio is a dashboard expression.
 */
export function jdCacheLookup(result: "hit" | "miss"): void {
  increment("jd_cache_lookup_total", {
    result: bound(CACHE_RESULTS, result, "jd_cache_lookup_total", "result"),
  });
}

/** Prompt drift after a model change: this climbs before anything else breaks. */
export function llmValidationRetry(prompt: string): void {
  increment("llm_validation_retry_total", {
    prompt: bound(PROMPTS, prompt, "llm_validation_retry_total", "prompt"),
  });
}

/** Truthfulness enforcement actually firing (§13). */
export function guardrailBlock(type: string): void {
  increment("guardrail_block_total", {
    type: bound(GUARDRAIL_TYPES, type, "guardrail_block_total", "type"),
  });
}

/** Which gate stops sends — see EC-P7-21 on the `class` label. */
export function interlockBlock(check: string): void {
  const bounded = bound(INTERLOCK_CHECKS, check, "interlock_block_total", "check");
  increment("interlock_block_total", {
    check: bounded,
    class: INTERLOCK_CLASS[bounded] ?? "fault",
  });
}

/** Delivery health, by provider. */
export function outreachOutcome(provider: string, status: string): void {
  increment("outreach_outcome_total", {
    provider: bound(PROVIDERS, provider, "outreach_outcome_total", "provider"),
    status: bound(OUTCOMES, status, "outreach_outcome_total", "status"),
  });
}

/** Cost control for Tier-1 batch scoring. */
export function llmTokens(tier: string, model: string, tokens: number): void {
  increment(
    "llm_tokens_total",
    {
      tier: bound(TIERS, tier, "llm_tokens_total", "tier"),
      model: boundModel(model),
    },
    tokens,
  );
}

/**
 * The one label whose vocabulary cannot be enumerated here: model ids come from
 * env and change without a code edit, so an allow-list would reject every model
 * upgrade.
 *
 * Character-stripping alone is NOT sufficient, which the EC-P7-20 test caught:
 * a UUID is entirely hex and hyphens, so it survives a `[^a-z0-9._-]` filter
 * intact and becomes a per-caller series. The id-shape guard has to apply here
 * too — the absence of an enumeration makes this the weakest label, not the one
 * that gets to skip the check.
 */
function boundModel(model: string): string {
  const slug = model.replace(/[^a-z0-9._-]/gi, "").slice(0, 40);
  if (!slug) return "unknown";
  if (ID_SHAPED.test(slug)) {
    warnOnce("llm_tokens_total.model.id", () =>
      log.warn("metric.label_rejected", {
        name: "llm_tokens_total",
        check: "model",
        outcome: "other",
      }),
    );
    return "other";
  }
  return slug;
}

/** Dependency health transitions (P7.2.4) — how often we degrade, and to what. */
export function dependencyState(
  dependency: "redis" | "worker" | "database",
  state: "up" | "down",
): void {
  increment("dependency_state_total", { dependency, state });
}

/* ------------------------------------------------------------------ */
/* Exposition                                                          */
/* ------------------------------------------------------------------ */

/** Render the registry as Prometheus text (v0.0.4). */
export function renderPrometheus(): string {
  const byName = new Map<string, Series[]>();
  for (const series of registry.values()) {
    const list = byName.get(series.name) ?? [];
    list.push(series);
    byName.set(series.name, list);
  }

  const lines: string[] = [];
  for (const [name, list] of [...byName.entries()].sort()) {
    lines.push(`# TYPE ${name} counter`);
    for (const series of list) {
      const labels = Object.entries(series.labels)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}="${v}"`)
        .join(",");
      lines.push(`${name}{${labels}} ${series.value}`);
    }
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}

/** Test seam. */
export function __resetMetrics(): void {
  registry.clear();
  warned.clear();
}

/** Test seam: read a counter without going through the text format. */
export function __counter(name: string, labels: Record<string, string>): number {
  return registry.get(key(name, labels))?.value ?? 0;
}
