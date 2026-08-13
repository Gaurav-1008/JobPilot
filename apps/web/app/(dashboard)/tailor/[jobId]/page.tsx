"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

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

  if (isPending) return <main className="p-8 text-sm text-neutral-500">Loading…</main>;
  if (!job) return <main className="p-8 text-sm text-neutral-500">Job not found.</main>;

  const ready = job.hydrationStatus === "hydrated" && job.jobDescription;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Tailor for {job.title}</h1>
      <p className="mt-1 text-sm text-neutral-600">{job.company}</p>

      {/* EC-P4-28 — refuse, and say what to do about it. */}
      {!ready ? (
        <div className="mt-6 rounded border border-amber-300 bg-amber-50 p-4 text-sm">
          This job has no description yet, and tailoring needs one.{" "}
          <Link href={`/jobs/${jobId}`} className="underline">
            Fetch or paste it on the job page
          </Link>
          , then come back.
        </div>
      ) : (
        <button onClick={run} disabled={busy}
          className="mt-6 rounded bg-black px-4 py-2 text-white disabled:opacity-50">
          {busy ? "Tailoring… (about 20s)" : "Tailor my resume for this job"}
        </button>
      )}

      {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}

      {result && (
        <section className="mt-8 rounded border p-5">
          <div className="flex items-baseline gap-6">
            <div>
              <div className="text-xs text-neutral-500">Before</div>
              <div className="text-2xl font-semibold">{result.originalScore}</div>
            </div>
            <div>
              <div className="text-xs text-neutral-500">After</div>
              <div className="text-2xl font-semibold">{result.tailoredScore}</div>
            </div>
          </div>

          {/* EC-P4-30 — a regression is reported honestly. Hiding it would be a
              broken promise about explainability, and the user needs to know
              the rewrite did not help before they send anything. */}
          {result.tailoredScore < result.originalScore && (
            <p className="mt-3 text-sm text-amber-700">
              Tailoring did not improve the match here. The original wording
              scored better — worth reviewing the changes before using them.
            </p>
          )}

          {result.warnings.length > 0 && (
            <div className="mt-4">
              <h2 className="text-sm font-medium">Review these</h2>
              <ul className="mt-1 list-disc pl-5 text-sm text-neutral-700">
                {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          <Link href={`/tailor/${result.runId}/review`}
            className="mt-5 inline-block rounded border px-4 py-2 text-sm">
            Review the changes
          </Link>
        </section>
      )}
    </main>
  );
}
