/**
 * Cache-key normalisation (P3.2.2, EC-P3-01).
 *
 * Same asymmetry as dedupe: under-normalising costs an extra fetch;
 * over-normalising serves the WRONG job's description to a user.
 */
import { describe, it, expect } from "vitest";

import { normaliseUrl, urlHash } from "../../../../services/orchestrator/lib/url-normalize";

describe("normaliseUrl", () => {
  it("collapses variants that address the same page", () => {
    const canonical = urlHash("https://remoteok.com/remote-jobs/123");
    for (const v of [
      "https://RemoteOK.com/remote-jobs/123",       // host case
      "https://remoteok.com/remote-jobs/123/",      // trailing slash
      "https://remoteok.com/remote-jobs/123#apply", // fragment
      "https://remoteok.com:443/remote-jobs/123",   // default port
      "https://remoteok.com/remote-jobs/123?utm_source=x&gclid=y",
    ]) {
      expect(urlHash(v)).toBe(canonical);
    }
  });

  it("param ORDER does not create a second entry", () => {
    expect(urlHash("https://lever.co/j?a=1&b=2")).toBe(urlHash("https://lever.co/j?b=2&a=1"));
  });

  it("EC-P3-03: keeps meaningful query params — many boards put the job id there", () => {
    // Dropping these would collapse every listing on a host into one entry and
    // serve the wrong description.
    expect(urlHash("https://lever.co/jobs?id=1")).not.toBe(urlHash("https://lever.co/jobs?id=2"));
  });

  it("does NOT lowercase the path — many boards use case-sensitive slugs", () => {
    expect(normaliseUrl("https://x.com/Job-ABC")).toContain("/Job-ABC");
  });

  it("distinct paths stay distinct", () => {
    expect(urlHash("https://remoteok.com/a")).not.toBe(urlHash("https://remoteok.com/b"));
  });

  it("the bare root keeps its slash", () => {
    expect(normaliseUrl("https://remoteok.com/")).toBe("https://remoteok.com/");
  });
});
