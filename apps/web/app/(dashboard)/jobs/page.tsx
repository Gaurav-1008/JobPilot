"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";

interface Job {
  id: string;
  source: string;
  title: string;
  company: string;
  location: string | null;
  link: string;
  postedAt: string | null;
  hydrationStatus: string;
}

const HYDRATION_LABEL: Record<string, string> = {
  pending: "", hydrated: "parsed", failed: "unreadable", blocked: "blocked",
};

function JobsTable() {
  const runId = useSearchParams().get("runId");
  const qc = useQueryClient();
  const [source, setSource] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);

  const { data: jobs, isPending } = useQuery<Job[]>({
    queryKey: ["jobs", runId],
    queryFn: async () =>
      (await (await fetch(`/api/jobs${runId ? `?runId=${runId}` : ""}`)).json()).jobs ?? [],
  });

  const shown = (jobs ?? []).filter((j) => source === "all" || j.source === source);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function hydrateSelected() {
    if (selected.size === 0) return;
    setMsg(null);
    const res = await fetch("/api/jobs/hydrate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobIds: [...selected] }),
    });
    const d = await res.json().catch(() => ({}));
    setMsg(res.ok ? `Fetching ${d.queued} description${d.queued === 1 ? "" : "s"}…` : (d.message ?? "Failed."));
    setSelected(new Set());
    void qc.invalidateQueries({ queryKey: ["jobs", runId] });
  }
  const sources = Array.from(new Set((jobs ?? []).map((j) => j.source))).sort();

  // Three distinct states, never shared (EC-P7-01/EC-P2-48): a slow query must
  // not look like "no results".
  if (isPending) {
    return <p className="mt-8 text-sm text-neutral-500">Loading…</p>;
  }
  if (!jobs || jobs.length === 0) {
    return (
      <p className="mt-8 text-sm text-neutral-500">
        No jobs yet. Run a search to populate the board.
      </p>
    );
  }

  return (
    <>
      <div className="mt-6 flex items-center gap-3 text-sm">
        <span className="text-neutral-500">Source</span>
        <select value={source} onChange={(e) => setSource(e.target.value)}
          className="rounded border px-2 py-1">
          <option value="all">all ({jobs.length})</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s} ({jobs.filter((j) => j.source === s).length})
            </option>
          ))}
        </select>

        {/* FR2 — selected jobs only. There is deliberately no "hydrate all":
            fetching every scraped row is wasteful and unkind to the boards,
            and most rows are never opened. */}
        <button onClick={hydrateSelected} disabled={selected.size === 0}
          className="ml-auto rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-40">
          Fetch descriptions ({selected.size})
        </button>
      </div>
      {msg && <p role="status" className="mt-2 text-sm text-neutral-700">{msg}</p>}

      {shown.length === 0 ? (
        // Distinct from "no jobs at all" — different cause, different action.
        <p className="mt-8 text-sm text-neutral-500">
          No jobs match this filter.{" "}
          <button onClick={() => setSource("all")} className="underline">Clear</button>
        </p>
      ) : (
        <ul className="mt-4 divide-y rounded border">
          {shown.map((j) => (
            <li key={j.id} className="px-4 py-3">
              <div className="flex items-start gap-3">
                <input type="checkbox" checked={selected.has(j.id)}
                  onChange={() => toggle(j.id)} className="mt-1"
                  aria-label={`Select ${j.title}`} />
                <div className="flex flex-1 items-start justify-between gap-4">
                <div className="min-w-0">
                  <Link href={`/jobs/${j.id}`} className="font-medium hover:underline">
                    {j.title}
                  </Link>
                  <div className="text-sm text-neutral-600">
                    {j.company}
                    {j.location && ` · ${j.location}`}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs text-neutral-500">
                  <div>{j.source}</div>
                  {HYDRATION_LABEL[j.hydrationStatus] && (
                    <div className={j.hydrationStatus === "hydrated" ? "text-green-700" : "text-amber-700"}>
                      {HYDRATION_LABEL[j.hydrationStatus]}
                    </div>
                  )}
                  {/* posted_at is shown VERBATIM — "2 days ago" is what the
                      board said, and re-rendering a parsed date would be a
                      claim we cannot back up (EC-P2-51). */}
                  {j.postedAt && <div>{j.postedAt}</div>}
                </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function JobsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Jobs</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Deduplicated across boards and across searches.
      </p>
      {/* useSearchParams needs a Suspense boundary to prerender — the same
          thing that broke the build on /sign-in. */}
      <Suspense fallback={<p className="mt-8 text-sm text-neutral-500">Loading…</p>}>
        <JobsTable />
      </Suspense>
    </main>
  );
}
