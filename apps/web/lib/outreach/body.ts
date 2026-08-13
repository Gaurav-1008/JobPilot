/**
 * Body normalization and hashing (P5.3.6, P5.4.2).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EC-P5-48 — HASH EXACTLY THE BYTES THAT WILL BE HANDED TO THE PROVIDER.
 *
 * Interlock check 3 compares sha256(body) against the hash captured at
 * approval. That comparison is only meaningful if both sides hashed the same
 * bytes — and the obvious way to get this wrong is subtle: a textarea returns
 * CRLF on Windows, the UI trims for display, and the server hashes whatever it
 * was handed. The user then approves and delivers identical-looking text, and
 * the delivery is rejected for tampering.
 *
 * The fix is to normalize ONCE, here, and to hash only normalized text. Every
 * path — generation, edit, approval, delivery — routes through `normalizeBody`
 * first, so "what the user saw", "what was hashed", and "what gets sent" are
 * the same string by construction rather than by discipline.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { createHash } from "node:crypto";

/**
 * Canonical form of an email body.
 *
 * Deliberately conservative: it fixes line endings and trailing whitespace,
 * which no author intends, and leaves everything else — including internal
 * spacing and blank-line rhythm — exactly as written. An aggressive normalizer
 * would silently rewrite the user's email, which is a worse failure than the
 * hash mismatch it prevents.
 */
export function normalizeBody(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")          // CRLF and lone CR → LF
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))   // invisible, never intentional
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")       // cap blank runs, as the LLM path already does
    .trim();
}

/** sha256 of the NORMALIZED body. Never call this on raw input. */
export function hashBody(normalized: string): string {
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

/** Normalize and hash in one step — the only form callers should need. */
export function normalizeAndHash(raw: string): { body: string; hash: string } {
  const body = normalizeBody(raw);
  return { body, hash: hashBody(body) };
}

/**
 * Word count for the limit warning and the `word_count` column.
 *
 * EC-P5-30 warns that the definition matters — hyphenates, URLs, and em-dashes
 * all count differently across implementations. This matches The Closer's
 * `len(body.split())` exactly, because the validator in ④ is still the
 * authority on rejection and the two numbers disagreeing would be worse than
 * either being slightly off.
 */
export function countWords(body: string): number {
  return body.split(/\s+/).filter(Boolean).length;
}
