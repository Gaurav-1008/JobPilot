/**
 * Validate a `?next=` redirect target.
 *
 * The sign-in and sign-up screens both send the user onward to a path supplied
 * in the query string, which is attacker-controllable: a link to
 * `/sign-in?next=https://evil.example/login` would hand the browser straight to
 * someone else's page immediately after a real sign-in, at the moment the user
 * is most primed to type a password again. That is an open redirect, and it is
 * worth noting the redirect happens on SUCCESS — the phishing page inherits the
 * credibility of a sign-in that actually worked.
 *
 * Only same-origin absolute PATHS survive:
 *
 *   `/tailor`            ✓
 *   `/jobs?tab=saved`    ✓
 *   `https://evil.test`  ✗  absolute URL, another origin
 *   `//evil.test`        ✗  protocol-relative, reads as a host to the browser
 *   `/\evil.test`        ✗  backslash — some browsers normalise this to `//`
 *   `tailor`             ✗  relative, resolves against the current directory
 *
 * Anything rejected falls back rather than throwing: a malformed `next` should
 * land the user somewhere sensible, not on an error page.
 */
export function safeNextPath(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  // Both forms below are read by browsers as the start of a host, not a path.
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}
