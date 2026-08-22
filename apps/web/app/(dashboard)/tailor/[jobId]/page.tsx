"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Sparkles } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ListLoading } from "@/components/ui/list-state";
import { Page, PageHeader } from "@/components/ui/page";
import { ScoreValue } from "@/components/ui/score";

interface JobDetail {
  id: string; title: string; company: string;
  hydrationStatus: string;
  jobDescription: { rawText: string } | null;
}
interface TailorResult {
  runId: string;
  originalScore: number;
  tailoredScore: number;
  warnings: string[];
}

/**
 * Tier-2 tailoring for one job (P4.4.1/P4.4.2).
 *
 * P4.4.4 — there is no JD paste box here. The description arrives from the Job
 * record; if it is missing, the fix is to hydrate (or paste on the job page),
 * not to re-enter it in a second place where the two could disagree.
 */
export default function TailorJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(params);
  const [result, setResult] = useState<TailorResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: job, isPending } = useQuery<JobDetail>({
    queryKey: ["job", jobId],
    queryFn: async () => (await fetch(`/api/jobs/${jobId}`)).json(),
  });

  async function run() {
    setBusy(true); setError(null); setResult(null);
    const res = await fetch("/api/tailor/job", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(d.message ?? "Tailoring failed."); return; }
    setResult(d);
  }

  if (isPending) {
    return (
      <Page width="narrow">
        <ListLoading rows={3} label="Loading this job" />
      </Page>
    );
  }
  if (!job) {
    return (
      <Page width="narrow">
        <PageHeader title="Job not found" back={{ href: "/jobs", label: "Jobs" }} />
      </Page>
    );
  }

  const ready = job.hydrationStatus === "hydrated" && job.jobDescription;
  const regressed = result !== null && result.tailoredScore < result.originalScore;

  return (
    <Page width="narrow">
      <PageHeader
        back={{ href: `/jobs/${jobId}`, label: "Job" }}
        title={`Tailor for ${job.title}`}
        description={job.company}
      />

      {/* EC-P4-28 — refuse, and say what to do about it. */}
      {!ready ? (
        <Alert tone="warning" className="mt-8" title="This job has no description yet">
          Tailoring needs one.{" "}
          <Link href={`/jobs/${jobId}`}>Fetch or paste it on the job page</Link>,
          then come back.
        </Alert>
      ) : (
        <div className="mt-8">
          <Button size="lg" onClick={run} loading={busy}>
            {!busy && <Sparkles className="size-4" aria-hidden="true" />}
            {busy ? "Tailoring… (about 20s)" : "Tailor my resume for this job"}
          </Button>
          {busy && (
            <p role="status" aria-live="polite" className="mt-3 text-sm text-muted-foreground">
              Rewriting bullets role by role and re-scoring. This runs on the
              server, so leaving the page does not cancel it.
            </p>
          )}
        </div>
      )}

      {error && (
        <Alert role="alert" tone="danger" className="mt-6" title="Tailoring failed">
          {error}
        </Alert>
      )}

      {result && (
        <Card className="mt-8">
          <CardContent className="space-y-5 pt-5">
            {/*
             * Before and after with the delta between them, rather than two
             * bare numbers side by side. The delta IS the result — it is the
             * only thing on this card that answers "did that help?".
             */}
            <div className="flex items-center justify-center gap-5">
              <div className="text-center">
                <ScoreValue score={result.originalScore} size="lg" />
                <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                  Before
                </p>
              </div>
              <ArrowRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="text-center">
                <ScoreValue score={result.tailoredScore} size="lg" />
                <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                  After
                </p>
              </div>
            </div>

            {/* EC-P4-30 — a regression is reported honestly. Hiding it would be a
                broken promise about explainability, and the user needs to know
                the rewrite did not help before they send anything. */}
            {regressed && (
              <Alert tone="warning" title="Tailoring did not improve the match here">
                The original wording scored better — worth reviewing the changes
                before using them.
              </Alert>
            )}

            {result.warnings.length > 0 && (
              <Alert tone="warning" title="Review these">
                <ul className="list-disc space-y-1 pl-5">
                  {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </Alert>
            )}

            <Link
              href={`/tailor/${result.runId}/review`}
              className={buttonVariants({ className: "w-full sm:w-auto" })}
            >
              Review the changes
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </CardContent>
        </Card>
      )}
    </Page>
  );
}
