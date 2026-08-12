/**
 * Best-effort posted_at normalisation (P2.4.4, EC-P2-51).
 *
 * Boards emit "Today", "2 days ago", "30+ days ago", "Just now", "", and
 * occasionally a real date. The RULE: `posted_at` is stored VERBATIM and this
 * value is a nullable convenience for sorting. A job row must NEVER fail to
 * persist because a date string did not parse.
 */

export function parsePostedAt(raw: string | null | undefined, now = new Date()): Date | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;

  if (s === "today" || s === "just now" || s.startsWith("just posted")) return now;
  if (s === "yesterday") return daysAgo(now, 1);

  // "2 days ago", "30+ days ago", "3 hours ago", "a few minutes ago"
  const rel = s.match(/(\d+)\s*\+?\s*(minute|hour|day|week|month)/);
  if (rel) {
    const n = Number(rel[1]);
    switch (rel[2]) {
      case "minute": return new Date(now.getTime() - n * 60_000);
      case "hour":   return new Date(now.getTime() - n * 3_600_000);
      case "day":    return daysAgo(now, n);
      case "week":   return daysAgo(now, n * 7);
      case "month":  return daysAgo(now, n * 30);
    }
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    // EC-P2-51: a future date is a timezone artefact, not a prophecy. Clamp
    // rather than storing a posting that has not happened yet.
    return parsed > now ? now : parsed;
  }

  // Unparseable is a perfectly normal outcome. Null, not an error.
  return null;
}

function daysAgo(now: Date, n: number): Date {
  return new Date(now.getTime() - n * 86_400_000);
}
