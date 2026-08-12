/**
 * posted_at normalisation (P2.4.4, EC-P2-51).
 *
 * The governing rule: posted_at is stored VERBATIM and this is a nullable
 * convenience for sorting. A job must NEVER fail to persist because a board's
 * date string did not parse.
 */
import { describe, it, expect } from "vitest";

import { parsePostedAt } from "../../../../services/orchestrator/lib/posted-at";

const NOW = new Date("2026-08-12T12:00:00Z");

describe("parsePostedAt", () => {
  it("handles the relative forms boards actually emit", () => {
    expect(parsePostedAt("Today", NOW)?.toISOString()).toBe(NOW.toISOString());
    expect(parsePostedAt("Just now", NOW)?.toISOString()).toBe(NOW.toISOString());
    expect(parsePostedAt("Yesterday", NOW)?.toISOString()).toBe("2026-08-11T12:00:00.000Z");
    expect(parsePostedAt("2 days ago", NOW)?.toISOString()).toBe("2026-08-10T12:00:00.000Z");
    expect(parsePostedAt("3 hours ago", NOW)?.toISOString()).toBe("2026-08-12T09:00:00.000Z");
  });

  it("handles '30+ days ago' — the plus must not break the number", () => {
    expect(parsePostedAt("30+ days ago", NOW)?.toISOString()).toBe("2026-07-13T12:00:00.000Z");
  });

  it("returns null for anything unparseable, never throws", () => {
    for (const v of ["", "   ", "garbage", null, undefined]) {
      expect(parsePostedAt(v as string | null, NOW)).toBeNull();
    }
  });

  it("parses absolute dates", () => {
    expect(parsePostedAt("2026-08-01", NOW)?.toISOString().slice(0, 10)).toBe("2026-08-01");
  });

  it("clamps a future date — a timezone artefact, not a prophecy", () => {
    expect(parsePostedAt("2030-01-01", NOW)?.toISOString()).toBe(NOW.toISOString());
  });
});
