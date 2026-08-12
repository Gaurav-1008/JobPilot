/**
 * Cache-key normalisation for hydrated JDs (P3.2.2, EC-P3-01).
 *
 * The two failure directions are asymmetric, same as dedupe:
 *
 *   under-normalising  costs one extra fetch — wasteful, harmless
 *   over-normalising   returns the WRONG job's description to a user, which
 *                      is silent and much worse
 *
 * So this is conservative. Tracking parameters are stripped because they are
 * known-irrelevant by name; everything else is kept, because on many boards the
 * job id lives in a query parameter and dropping it would collapse every
 * listing on that host into one cache entry.
 */

import { createHash } from "node:crypto";

/** Params that never identify content. Everything else is preserved. */
const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "gclid", "fbclid", "msclkid", "mc_cid", "mc_eid",
  "ref", "referrer", "src", "source_id", "_ga", "igshid",
]);

export function normaliseUrl(input: string): string {
  const url = new URL(input);

  // Host is case-insensitive; the path is NOT (many boards use case-sensitive
  // slugs, so lowercasing it would merge distinct jobs).
  url.hostname = url.hostname.toLowerCase();
  url.protocol = url.protocol.toLowerCase();

  // A fragment never reaches the server.
  url.hash = "";

  // Default ports are not part of identity.
  if ((url.protocol === "https:" && url.port === "443") ||
      (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  // Sort remaining params so ?a=1&b=2 and ?b=2&a=1 are one entry.
  url.searchParams.sort();

  // Trailing slash on a path (but not on the bare root) is not identity.
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }

  return url.toString();
}

/** Primary key of `jd_cache`. */
export function urlHash(input: string): string {
  return createHash("sha256").update(normaliseUrl(input)).digest("hex");
}
