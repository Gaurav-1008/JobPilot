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
import { GapAnalysisList } from "@/components/GapAnalysisList";
import { PDFExportButton } from "@/components/PDFExportButton";
import { ScoreCard } from "@/components/ScoreCard";
import { SideBySideDiff } from "@/components/SideBySideDiff";
import { Alert } from "@/components/ui/alert";
import { ListLoading } from "@/components/ui/list-state";
import { Page, PageHeader, Section } from "@/components/ui/page";

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
    return (
      <Page width="wide">
        <ListLoading rows={4} label="Loading the run" />
      </Page>
    );
  }

  // EC-P1-26: another user's valid id resolves to 404, identically to a
  // nonexistent one. Nothing here should hint at which it was.
  if (isError || !run) {
    return (
      <Page width="content">
        <PageHeader
          back={{ href: "/jobs", label: "Jobs" }}
          title="Run not found"
          description="This tailoring run does not exist, or it is not yours."
        />
      </Page>
    );
  }

  return (
    <Page width="wide">
      <PageHeader
        back={{ href: "/jobs", label: "Jobs" }}
        title={
          <>
            {run.jobDescription.jobTitle}
            {run.jobDescription.company ? ` · ${run.jobDescription.company}` : ""}
          </>
        }
        description="Every rewrite below carries the reason it was made. Nothing was invented; anything the guardrails refused is shown as rejected, not dropped."
      />

      <div className="mt-8 space-y-8">
        <ScoreCard original={run.originalMatch} tailored={run.tailoredMatch} />

        {run.warnings.length > 0 && (
          <Alert tone="warning" title="Review these">
            <ul className="list-disc space-y-1 pl-5">
              {run.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Alert>
        )}

        <GapAnalysisList gapAnalysis={run.gapAnalysis} />

        {run.tailoredResume && (
          <Section title="Side by side">
            <SideBySideDiff tailored={run.tailoredResume} />
          </Section>
        )}

        <Section title="Export">
          <PDFExportButton runId={run.id} />
        </Section>

        {/* The next step in the pipeline, rather than a dead end at the proof. */}
        <Alert tone="neutral" title="Happy with this?">
          Outreach built from this run can cite it as evidence.{" "}
          <Link href="/outreach">Write an email about this job</Link>.
        </Alert>
      </div>
    </Page>
  );
}
