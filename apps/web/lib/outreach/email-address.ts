/**
 * Email address normalization (P5.1.1).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS AS ITS OWN MODULE
 *
 * Every downstream safety check — opt-out suppression (check 5), dedup on the
 * person (check 6), the volume cap (check 7) — compares addresses. They compare
 * them as STRINGS. A single trailing space, a `mailto:` prefix, or an IDN
 * domain written two different ways silently defeats all three at once, and the
 * failure is invisible: every counter still reads as compliant while a real
 * person receives mail they opted out of.
 *
 * So normalization happens exactly once, at ingest, and the normalized value is
 * what gets stored. Nothing downstream re-normalizes; if it had to, some caller
 * would eventually forget.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * EC-P5-01  `  MAILTO:Priya <Priya@X.com> ` → `Priya@x.com`
 * EC-P5-02  plus-addressing is PRESERVED — stripping `+tag` makes opt-out
 *           matching over-broad, suppressing addresses the user never listed.
 * EC-P5-03  IDN domains normalize to punycode for comparison; the original
 *           renders via `displayEmail()` rather than a second column.
 * EC-P5-04  obviously-invalid input returns null; callers turn that into a form
 *           error (typed) or `suppression_reason='invalid'` (imported).
 * EC-P5-05  320 characters is the RFC ceiling and is accepted.
 * EC-P5-06  self-addressing is NOT special-cased here — it is the documented
 *           self-test path from The Closer's runbook, and blocking it would
 *           remove the only way to safely try the pipeline end to end.
 */

import { domainToASCII, domainToUnicode } from "node:url";

/** RFC 5321: 320 total, 64 in the local part. */
const MAX_TOTAL = 320;
const MAX_LOCAL = 64;

/**
 * Pull the address out of a display-name wrapper.
 *
 * Deliberately anchored to the LAST `<...>` pair: a display name may itself
 * contain angle brackets, and the address is always the trailing group.
 */
function unwrapDisplayName(input: string): string {
  const open = input.lastIndexOf("<");
  const close = input.lastIndexOf(">");
  if (open !== -1 && close > open) return input.slice(open + 1, close);
  return input;
}

/**
 * Canonicalize an address for storage and comparison.
 *
 * Returns null when the input is not a usable address. The local part keeps its
 * case (RFC says it is case-sensitive); the `citext` column makes the eventual
 * comparison case-insensitive anyway, so lowercasing it here would only destroy
 * information for display.
 */
export function normalizeEmail(raw: string): string | null {
  if (typeof raw !== "string") return null;

  let value = raw.trim();
  if (!value) return null;

  // `mailto:` arrives from pasted links and from some CSV exports.
  if (/^mailto:/i.test(value)) value = value.slice(7).trim();

  value = unwrapDisplayName(value).trim();

  // Any remaining whitespace means this was never a single address.
  if (/\s/.test(value)) return null;

  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return null;   // EC-P5-04

  const local = value.slice(0, at);
  const domainRaw = value.slice(at + 1);

  if (local.length > MAX_LOCAL) return null;
  if (local.includes("@")) return null;

  // EC-P5-03: punycode is the comparison form. domainToASCII returns "" for a
  // domain it cannot encode, which is exactly the reject signal we want.
  const domain = domainToASCII(domainRaw.toLowerCase());
  if (!domain) return null;

  // A bare hostname with no dot is not a deliverable public address. This also
  // rejects the `@localhost` shapes that would otherwise pass every other test.
  if (!domain.includes(".")) return null;
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) {
    return null;
  }

  const normalized = `${local}@${domain}`;
  if (normalized.length > MAX_TOTAL) return null;   // EC-P5-05

  return normalized;
}

/**
 * Render a stored address for a human (EC-P5-03).
 *
 * Undoes the punycode encoding so `xn--80ak6aa92e.com` reads as the domain the
 * user actually typed. Storage stays canonical; only the display differs.
 */
export function displayEmail(stored: string): string {
  const at = stored.lastIndexOf("@");
  if (at <= 0) return stored;
  const unicode = domainToUnicode(stored.slice(at + 1));
  return unicode ? `${stored.slice(0, at)}@${unicode}` : stored;
}

/**
 * Opt-out entries only (P5.1.4).
 *
 * EC-P5-16: The Closer supported per-address suppression only. Rather than
 * silently storing `@company.com` as a literal address — where it would match
 * nothing and the user would believe a whole company was suppressed — the
 * domain form is recognized explicitly and normalized to `@domain`, and
 * interlock check 5 tests both the address and its domain.
 */
export function normalizeOptOutEntry(raw: string): string | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return null;

  if (value.startsWith("@")) {
    const domain = domainToASCII(value.slice(1).toLowerCase());
    if (!domain || !domain.includes(".")) return null;
    return `@${domain}`;
  }

  return normalizeEmail(value);
}

/** The `@domain` suppression key for an address. Pairs with the function above. */
export function domainKey(normalizedEmail: string): string {
  return `@${normalizedEmail.slice(normalizedEmail.lastIndexOf("@") + 1)}`;
}
