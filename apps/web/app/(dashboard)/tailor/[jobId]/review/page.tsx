"use client";

/**
 * Tailoring review — the page "Review the changes" has always pointed at.
 *
 * It was never built. The button on the tailor screen linked to
 * `/tailor/{runId}/review` and 404'd, which means the side-by-side proof — the
 * thing the whole tailoring phase exists to produce, and the surface where
 * guardrail decisions become visible — was unreachable from the harvested-job
 * flow. The standalone `/tailor` page rendered all of it; this route did not
 * exist.
 *
 * NOTE ON THE PARAM: the segment is `[jobId]`, but the link passes a RUN id.
 * Renaming the segment would break `/tailor/[jobId]`, which genuinely does take
 * a job id, so the value is read as what it actually is — a run id — and named
 * that way here rather than silently mismatching.
 *
 * Components are the same ones TailorFlow uses, deliberately. Two renderings of
 * one run drift, and the moment they disagree the "proof" stops proving
 * anything.
 */

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import type { TailoringRun } from "@/lib/schemas";
import { ScoreCard } from "@/components/ScoreCard";
import { GapAnalysisList } from "@/components/GapAnalysisList";
import { SideBySideDiff } from "@/components/SideBySideDiff";
import { PDFExportButton } from "@/components/PDFExportButton";

export default function TailorReviewPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  // The route segment is named jobId; the value here is a run id (see header).
  const { jobId: runId } = use(params);

  const { data: run, isPending, isError } = useQuery<TailoringRun>({
    queryKey: ["run", runId],
    queryFn: async () => {
      const res = await fetch(`/api/runs/${runId}`);
      if (!res.ok) throw new Error("not found");
      return res.json();
    },
  });

  if (isPending) {
    return <main className="p-8 text-sm text-muted-foreground">Loading the run…</main>;
  }

  // EC-P1-26: another user's valid id resolves to 404, identically to a
  // nonexistent one. Nothing here should hint at which it was.
  if (isError || !run) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-xl font-semibold">Run not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This tailoring run does not exist, or it is not yours.
        </p>
        <Link href="/jobs" className="mt-4 inline-block text-sm underline">
          ← Back to jobs
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Link href="/jobs" className="text-sm underline text-muted-foreground">
        ← Jobs
      </Link>

      <h1 className="mt-4 text-2xl font-semibold">
        {run.jobDescription.jobTitle}
        {run.jobDescription.company ? ` · ${run.jobDescription.company}` : ""}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every rewrite below carries the reason it was made. Nothing was invented;
        anything the guardrails refused is shown as rejected, not dropped.
      </p>

      <section className="mt-8">
        <ScoreCard original={run.originalMatch} tailored={run.tailoredMatch} />
      </section>

      {run.warnings.length > 0 && (
        <section className="mt-6 rounded border border-amber-300 bg-amber-50 p-4">
          <h2 className="text-sm font-medium text-amber-900">Review these</h2>
          <ul className="mt-2 list-disc pl-5 text-sm text-amber-900">
            {run.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <GapAnalysisList gapAnalysis={run.gapAnalysis} />
      </section>

      {run.tailoredResume && (
        <section className="mt-8">
          <h2 className="text-lg font-medium">Side by side</h2>
          <div className="mt-3">
            <SideBySideDiff tailored={run.tailoredResume} />
          </div>
        </section>
      )}

      <section className="mt-8">
        <PDFExportButton runId={run.id} />
      </section>

      {/* The next step in the pipeline, rather than a dead end at the proof. */}
      <section className="mt-8 rounded border border-border bg-card p-4 text-sm">
        Happy with this? Outreach built from this run can cite it as evidence.{" "}
        <Link href="/outreach" className="underline">
          Write an email about this job
        </Link>
        .
      </section>
    </main>
  );
}
