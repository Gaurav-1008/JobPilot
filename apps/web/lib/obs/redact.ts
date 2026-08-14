/**
 * Log redaction (P7.3.2, architecture.md §16.1).
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EC-P7-17 — REDACTION IS AN ALLOW-LIST, ENFORCED AT THE SERIALIZER.
 *
 * The obvious design is a deny-list of banned key names checked at each call
 * site: "never log `password`, `body`, `resumeText`". It does not work, and the
 * reason is worth stating plainly because the failure is silent.
 *
 * Someone will eventually write `log.error("send failed", { err })` where `err`
 * is a fetch/axios error carrying `err.config.data` — the request body, which
 * on the delivery path is a decrypted SMTP password. Nobody typed a banned key
 * name. The call site looks careful. The credential is in the log anyway.
 *
 * So the defense lives HERE, in the one place that sees every value on its way
 * to `JSON.stringify`, and it is an allow-list: a key is emitted only if it
 * appears in SAFE_KEYS. An unrecognised key is `"[redacted]"`, whatever it
 * holds. Adding a new field to a log line is therefore a deliberate act — you
 * must come to this file and decide the value is safe — rather than something
 * that happens by accident when an object grows a property.
 *
 * The cost is real: a log line missing a field you wanted is annoying. That
 * trade is correct. The failure mode of the other design is a credential in a
 * log aggregator with third-party retention, which is not recoverable by
 * editing a file.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * EC-P7-18 — recipient addresses are hashed, never written. An address in a log
 * is third-party personal data sitting outside the account-deletion path
 * (P7.4.5): deleting the user removes their rows, and the log line naming the
 * recruiter they emailed survives in a system nobody thought to enumerate.
 * Hashing keeps correlation — "the same person, twice" is still answerable —
 * while leaving nothing to disclose. Values are scanned for address shapes even
 * under allow-listed keys, because `message` is allow-listed and error messages
 * quote addresses constantly.
 *
 * EC-P7-19 — `lib/llm/logger.ts` routes through here, which extends the same
 * guarantee to outreach prompt traces. Those now carry payload data (the
 * personalization block, §14.2), so the redaction that covered tailoring
 * prompts had a gap the moment Phase 5 landed.
 */

import { createHash } from "node:crypto";

/**
 * Keys whose values may be serialized.
 *
 * The rule for adding one: the value must be operationally useful AND bounded
 * AND non-personal. Identifiers of OUR OWN rows (runId, attemptId) qualify —
 * they are meaningless outside the database and are removed by the deletion
 * cascade. Anything a human wrote or an LLM produced does not, no matter how
 * convenient it would be while debugging.
 *
 * Note what is deliberately absent: `body`, `subject`, `prompt`, `completion`,
 * `resumeText`, `jdText`, `email`, `recipient`, `password`, `token`, `config`,
 * `data`, `request`, `headers`. Several of those never appear as keys in our
 * own call sites — they are the keys that arrive attached to somebody else's
 * error object.
 */
const SAFE_KEYS: ReadonlySet<string> = new Set([
  // Correlation
  "event", "level", "requestId", "traceId", "spanId", "userId", "sessionId",
  // What happened
  "outcome", "status", "code", "check", "stage", "reason", "message", "name",
  // Where
  "route", "method", "jobName", "board", "provider", "method_", "source",
  // Our own row identifiers
  "runId", "jobId", "attemptId", "applicationId", "resumeId", "harvestRunId",
  "contactId", "keyVersion",
  // Measurements
  "ms", "durationMs", "count", "total", "attempt", "attempts", "retried",
  "statusCode", "bytes", "queued", "skipped", "failed", "succeeded",
  // LLM accounting
  "model", "tier", "promptTokens", "completionTokens", "totalTokens", "usage",
  "prompt_tokens", "completion_tokens", "total_tokens",
  // Hashed / derived values produced by this module
  "recipientHash", "bodyHash", "emailHash",
]);

/** Longest string emitted for any single value. Beyond this, truncate. */
const MAX_STRING = 300;
/** Deepest object nesting walked. Beyond this, the subtree is elided. */
const MAX_DEPTH = 6;
/** Most array elements emitted. */
const MAX_ARRAY = 20;

const REDACTED = "[redacted]";

/**
 * Deliberately loose. This is a redaction filter, not a validator: over-matching
 * costs a hashed string in a log, while under-matching leaks an address. The
 * asymmetry says to match anything address-shaped.
 */
const EMAIL_IN_TEXT = /[^\s<>"'()[\]:;,]+@[^\s<>"'()[\]:;,]+\.[a-z]{2,}/gi;

/**
 * Stable, non-reversible correlation handle for an address (EC-P7-18, §16.1).
 *
 * Truncated to 12 hex chars: collision-resistant enough to answer "same person?"
 * across a log file, short enough to read. Unsalted on purpose — a salt would
 * have to be stable across restarts and shared across services to preserve
 * correlation, at which point it is a secret whose compromise buys an attacker
 * an offline dictionary attack over an address space small enough to enumerate
 * anyway. The honest position is that this is a correlation handle, not a
 * confidentiality control, and the confidentiality control is that the address
 * itself is never written.
 */
export function hashEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return "";
  return createHash("sha256").update(normalized).digest("hex").slice(0, 12);
}

/** Replace every address-shaped run in free text with its hash. */
function scrubText(text: string): string {
  return text.replace(EMAIL_IN_TEXT, (match) => `<email:${hashEmail(match)}>`);
}

function redactString(value: string): string {
  const scrubbed = scrubText(value);
  return scrubbed.length > MAX_STRING
    ? `${scrubbed.slice(0, MAX_STRING)}…[+${scrubbed.length - MAX_STRING}]`
    : scrubbed;
}

/**
 * Errors get a hand-written projection rather than the allow-list walk.
 *
 * `JSON.stringify(new Error("x"))` is `{}` — name and message are
 * non-enumerable — so an error logged through a generic walker produces an
 * empty object and the operator learns nothing. Meanwhile the properties that
 * ARE enumerable on a real-world error are the dangerous ones: `config`,
 * `request`, `response`, `cause`. So we take exactly two fields, scrub both,
 * and drop everything else including the cause chain.
 */
function redactError(err: Error): Record<string, unknown> {
  return {
    name: err.name,
    message: redactString(err.message),
  };
}

/**
 * Project an arbitrary value into something safe to serialize.
 *
 * Exported for tests, which assert the property directly: build an object
 * carrying a credential and an email body under plausible keys, redact it, and
 * confirm neither survives.
 */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;

  const type = typeof value;
  if (type === "number" || type === "boolean") return value;
  if (type === "bigint") return String(value);
  if (type === "string") return redactString(value as string);

  // Functions and symbols carry nothing loggable and can close over anything.
  if (type === "function" || type === "symbol") return REDACTED;

  if (value instanceof Error) return redactError(value);
  if (value instanceof Date) return value.toISOString();

  // Buffers/typed arrays are ciphertext, PDFs, or resume bytes. Size only.
  if (ArrayBuffer.isView(value)) {
    return `[binary ${(value as ArrayBufferView).byteLength}b]`;
  }

  if (depth >= MAX_DEPTH) return "[depth]";

  const obj = value as object;
  // A circular structure would otherwise hang the walk. Reporting it is also
  // a useful signal: it usually means a framework object got logged.
  if (seen.has(obj)) return "[circular]";
  seen.add(obj);

  if (Array.isArray(value)) {
    const head = value.slice(0, MAX_ARRAY).map((v) => redact(v, depth + 1, seen));
    return value.length > MAX_ARRAY
      ? [...head, `[+${value.length - MAX_ARRAY} more]`]
      : head;
  }

  // Map/Set carry unbounded user data with no key names to check against.
  if (value instanceof Map || value instanceof Set) {
    return `[${value.constructor.name} size=${value.size}]`;
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    // ── The allow-list. The entire point of the module is this line. ──
    out[key] = SAFE_KEYS.has(key) ? redact(val, depth + 1, seen) : REDACTED;
  }
  return out;
}

/**
 * The only serializer log call sites should use.
 *
 * Returns a single JSON line with every value passed through `redact`. If
 * stringify still throws — an exotic getter, a BigInt we missed — we emit a
 * minimal line rather than throwing, because a logger that can crash a request
 * handler is worse than a logger that occasionally says less.
 */
export function safeSerialize(entry: Record<string, unknown>): string {
  try {
    return JSON.stringify(redact(entry));
  } catch {
    return JSON.stringify({
      event: entry.event ?? "unknown",
      outcome: "log_serialize_failed",
    });
  }
}

/** Test seam: lets a test assert the allow-list is what it claims to be. */
export function __safeKeys(): ReadonlySet<string> {
  return SAFE_KEYS;
}
