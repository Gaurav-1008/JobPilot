import { describe, it, expect } from "vitest";

import {
  buildComparisonContext,
  renderComparisonHtml,
  renderTailoredResumeHtml,
} from "@/lib/pdf/build-context";
import { escapeHtml } from "@/lib/pdf/escape";
import { PdfError } from "@/lib/pdf/errors";
import { TailoringRunSchema, type TailoringRun } from "@/lib/schemas";
import mockRun from "./fixtures/mock-tailoring-run.json";

const run: TailoringRun = TailoringRunSchema.parse(mockRun);

describe("escapeHtml", () => {
  it("escapes angle brackets, ampersands, and quotes", () => {
    expect(escapeHtml('<b>a & "b"</b>')).toBe(
      "&lt;b&gt;a &amp; &quot;b&quot;&lt;/b&gt;",
    );
  });
});

describe("buildComparisonContext", () => {
  const ctx = buildComparisonContext(run);

  it("computes the score delta", () => {
    expect(ctx.scoreDelta).toBe(
      run.tailoredMatch!.overallScore - run.originalMatch.overallScore,
    );
    expect(ctx.scoreDelta).toBeGreaterThan(0);
  });

  it("marks changed bullets", () => {
    const allBullets = ctx.roles.flatMap((r) => r.bullets);
    expect(allBullets.some((b) => b.changed)).toBe(true);
  });

  it("drops low-importance gaps from the summary", () => {
    expect(ctx.gaps.every((g) => g.importance !== "low")).toBe(true);
  });
});

describe("renderComparisonHtml", () => {
  const html = renderComparisonHtml(run);

  it("is a full HTML document with the job title", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain(run.jobDescription.jobTitle);
  });

  it("highlights a changed bullet with <mark>", () => {
    expect(html).toContain("<mark>");
  });

  it("includes the truthfulness disclaimer", () => {
    expect(html).toContain("verify every claim");
  });
});

describe("renderTailoredResumeHtml", () => {
  it("renders the candidate name and tailored summary", () => {
    const html = renderTailoredResumeHtml(run);
    expect(html).toContain(run.resume.contact.name);
    expect(html).toContain(run.tailoredResume!.tailoredSummary);
  });
});

describe("guard: run not tailored", () => {
  it("throws PdfError when tailoredResume is null", () => {
    const draft: TailoringRun = {
      ...run,
      tailoredResume: null,
      tailoredMatch: null,
    };
    expect(() => buildComparisonContext(draft)).toThrow(PdfError);
    expect(() => renderTailoredResumeHtml(draft)).toThrow(PdfError);
  });
});
