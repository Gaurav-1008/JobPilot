/**
 * Cross-run job deduplication (P2.2.6).
 *
 * The key is normalised(company) + normalised(title) + normalised(location).
 * Every rule below is a way that formula misfires, and the two failure
 * directions are NOT symmetric:
 *
 *   under-merging (EC-P2-17) shows a duplicate — annoying, visible, harmless
 *   over-merging  (EC-P2-18) silently hides a real job the user never sees
 *
 * So this tunes toward under-merging. When in doubt, keep both rows.
 */

/** Legal suffixes that differ between boards for the same company. */
const LEGAL_SUFFIXES = [
  "private limited", "pvt ltd", "pvt. ltd.", "pvt", "ltd", "limited",
  "incorporated", "inc", "llc", "llp", "gmbh", "corp", "corporation", "co",
];

export function normalise(value: string | null | undefined): string {
  if (!value) return "";
  return value
    // EC-P2-22: NFKC folds width/compatibility variants; then strip anything
    // that is not a letter, digit, or space (emoji, punctuation, nbsp).
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normaliseCompany(company: string): string {
  let out = normalise(company);
  // EC-P2-17: "Google" vs "Google India Pvt Ltd" must collapse. Strip trailing
  // legal suffixes repeatedly, since boards stack them ("Pvt Ltd", "Inc.").
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of LEGAL_SUFFIXES) {
      if (out.endsWith(` ${suffix}`)) {
        out = out.slice(0, -(suffix.length + 1)).trim();
        changed = true;
      }
    }
  }
  return out;
}

/**
 * EC-P2-18 — location STAYS in the key. Two openings with the same title at the
 * same company in different cities are two real jobs, and merging them loses
 * one permanently.
 *
 * EC-P2-20 — a null location normalises to the literal "remote" rather than an
 * empty segment, so RemoteOK rows do not all collapse into one another via an
 * empty string. EC-P2-21 — a multi-location string ("Hyderabad, Pune,
 * Bengaluru") is ONE job; the whole string is normalised, never split.
 */
export function dedupeKey(job: {
  company: string;
  title: string;
  location?: string | null;
}): string {
  const company = normaliseCompany(job.company);
  // EC-P2-25: seniority is NOT stripped — "Senior Engineer" and "Engineer" are
  // different jobs.
  const title = normalise(job.title);
  const location = normalise(job.location) || "remote";
  return `${company}|${title}|${location}`;
}
