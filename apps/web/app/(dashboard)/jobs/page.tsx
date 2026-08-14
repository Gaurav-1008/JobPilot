"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  ListEmpty,
  ListError,
  ListLoading,
  ListNoMatches,
} from "@/components/ui/list-state";

interface Job {
  id: string;
  source: string;
  title: string;
  company: string;
  location: string | null;
  link: string;
  postedAt: string | null;
  hydrationStatus: string;
  score: number | null;
  tailoredScore: number | null;
  tier: "heuristic" | "cheap" | "full" | null;
  explanation: string | null;
  skillCoverage: number | null;
  scoreIsStale: boolean;
}

const HYDRATION_LABEL: Record<string, string> = {
  pending: "", hydrated: "parsed", failed: "unreadable", blocked: "blocked",
};

/**
 * EC-P4-25 — every score says which tier produced it. Sorting across mixed
 * tiers is approximate, and hiding that would present a heuristic guess and a
 * full prompt-chain result as the same kind of number.
 */
const TIER_LABEL: Record<string, string> = {
  heuristic: "quick estimate",
  cheap: "scored",
  full: "fully tailored",
};

/** EC-P4-02 / P4.1.3 — a VIEW, not a filter. Low-fit jobs stay reachable. */
const LOW_FIT_MAX = 20;

function JobsTable() {
  const runId = useSearchParams().get("runId");
  const qc = useQueryClient();
  const [source, setSource] = useState("all");
  const [band, setBand] = useState<"all" | "strong" | "low" | "unscored">("all");
  const [msg, setMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: jobs, isPending, isError, refetch } = useQuery<Job[]>({
    queryKey: ["jobs", runId],
    queryFn: async () => {
      // EC-P7-01 — a failed fetch must reach the ERROR state, not the empty
      // one. `.json()` on a 500 yields an object with no `jobs` key, and the
      // `?? []` below then renders "No jobs yet" for a server error: the user
      // is told their data is gone when the request simply failed.
      const res = await fetch(`/api/jobs${runId ? `?runId=${runId}` : ""}`);
      if (!res.ok) throw new Error(`jobs request failed: ${res.status}`);
      return (await res.json()).jobs ?? [];
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["jobs", runId] });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function hydrateSelected() {
    if (selected.size === 0) return;
    const res = await fetch("/api/jobs/hydrate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobIds: [...selected] }),
    });
    const d = await res.json().catch(() => ({}));
    setMsg(res.ok ? `Fetching ${d.queued} description${d.queued === 1 ? "" : "s"}…` : d.message);
    setSelected(new Set());
    void refresh();
  }

  async function scoreAll() {
    const res = await fetch("/api/jobs/score-batch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ harvestRunId: runId }),
    });
    const d = await res.json().catch(() => ({}));
    // A 200 with queued:0 is the "hydrate something first" case, not an error.
    setMsg(d.message ?? (res.ok ? `Scoring ${d.queued} jobs…` : "Could not start scoring."));
    void refresh();
  }

  const all = jobs ?? [];
  const sources = Array.from(new Set(all.map((j) => j.source))).sort();

  const shown = all.filter((j) => {
    if (source !== "all" && j.source !== source) return false;
    if (band === "strong") return j.score !== null && j.score > LOW_FIT_MAX;
    if (band === "low") return j.score !== null && j.score <= LOW_FIT_MAX;
    if (band === "unscored") return j.score === null;
    return true;
  });

  const lowFitCount = all.filter((j) => j.score !== null && j.score <= LOW_FIT_MAX).length;
  const hydratedCount = all.filter((j) => j.hydrationStatus === "hydrated").length;

  /*
   * P7.1.1 / EC-P7-01 — four distinct states, in priority order, sharing no
   * component. Order is the substance here: `all.length === 0` is also true
   * while the query is in flight, so checking it before `isPending` renders
   * "No jobs yet — run a search" over a request that is about to return jobs.
   * On a slow connection the user is told their board is empty and starts a
   * second search.
   *
   * EC-P7-05 — retry here refetches a GET, which is idempotent. The mutations
   * on this screen (hydrate, score) deliberately do NOT get a retry
   * affordance: they may have succeeded server-side and failed on the way
   * back, so retrying would enqueue the work twice.
   */
  if (isPending) return <ListLoading rows={5} label="Loading jobs" />;

  if (isError) {
    return (
      <ListError
        onRetry={() => void refetch()}
        title="Your jobs could not be loaded"
        detail="The request did not complete. Nothing has been lost — this is a display problem."
      />
    );
  }

  if (all.length === 0) {
    return (
      <>
        <ListEmpty
          title="No jobs yet"
          detail="Run a search and JobPilot harvests matching roles from the boards you pick."
          action={{ label: "Run a search", href: "/search" }}
        />

        {/*
         * P7.1.4 / EC-P7-03 — the sample is OFFERED, never seeded on signup.
         *
         * Seeding automatically would mean doing work for every account
         * created, including the ones that never come back. Offering it here
         * means only users who want the demonstration pay for it — and because
         * it comes from fixtures, "paying for it" costs three inserts rather
         * than three requests to real job boards.
         */}
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Not ready to search?{" "}
          <button
            onClick={async () => {
              await fetch("/api/onboarding/sample", { method: "POST" });
              void refresh();
            }}
            className="underline"
          >
            Load three sample jobs
          </button>{" "}
          — clearly labelled, removable in one click, and never used as your
          default resume.
        </p>
      </>
    );
  }

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
        <select value={source} onChange={(e) => setSource(e.target.value)}
          className="rounded border px-2 py-1" aria-label="Filter by source">
          <option value="all">all sources ({all.length})</option>
          {sources.map((s) => (
            <option key={s} value={s}>{s} ({all.filter((j) => j.source === s).length})</option>
          ))}
        </select>

        <select value={band} onChange={(e) => setBand(e.target.value as typeof band)}
          className="rounded border px-2 py-1" aria-label="Filter by score">
          <option value="all">all scores</option>
          <option value="strong">good fit</option>
          {/* EC-P4-02 — low-fit jobs are one click away and fully tailorable.
              A heuristic must never be the reason a job is unreachable. */}
          <option value="low">low fit ({lowFitCount})</option>
          <option value="unscored">not scored yet</option>
        </select>

        <button onClick={hydrateSelected} disabled={selected.size === 0}
          className="rounded border px-3 py-1 disabled:opacity-40">
          Fetch descriptions ({selected.size})
        </button>

        <button onClick={scoreAll} disabled={hydratedCount === 0}
          className="rounded bg-black px-3 py-1 text-white disabled:opacity-40">
          Score {hydratedCount} against my resume
        </button>
      </div>
      {msg && <p role="status" className="mt-2 text-sm text-neutral-700">{msg}</p>}

      {/* EC-P7-02 — "no jobs" and "no jobs match" are different sentences with
          different next actions, and this is the branch that keeps them apart.
          Reaching here means `all.length > 0`, so the data exists and only the
          filters are hiding it. */}
      {shown.length === 0 ? (
        <ListNoMatches
          total={all.length}
          noun="jobs"
          onClear={() => { setSource("all"); setBand("all"); }}
        />
      ) : (
        <ul className="mt-4 divide-y rounded border">
          {shown.map((j) => (
            <li key={j.id} className="flex items-start gap-3 px-4 py-3">
              <input type="checkbox" checked={selected.has(j.id)}
                onChange={() => toggle(j.id)} className="mt-1"
                aria-label={`Select ${j.title}`} />

              {/* The score column — the point of the phase. */}
              <div className="w-16 shrink-0 text-center">
                {j.score === null ? (
                  <span className="text-xs text-neutral-400">—</span>
                ) : (
                  <>
                    <div className={`text-lg font-semibold ${
                      j.score >= 70 ? "text-green-700"
                        : j.score > LOW_FIT_MAX ? "text-neutral-800" : "text-neutral-400"}`}>
                      {j.tailoredScore ?? j.score}
                    </div>
                    {j.tier && (
                      <div className="text-[10px] leading-tight text-neutral-500">
                        {TIER_LABEL[j.tier]}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="min-w-0 flex-1">
                {/* Styled as a link, not just behaving like one. This was
                    `font-medium hover:underline` — indistinguishable from a
                    heading until the pointer happened to land on the text, so
                    the way into a job (and to the paste box, the only route for
                    a description automation could not fetch) was invisible. */}
                <Link
                  href={`/jobs/${j.id}`}
                  className="font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
                >
                  {j.title}
                </Link>
                <div className="text-sm text-neutral-600">
                  {j.company}{j.location && ` · ${j.location}`}
                </div>
                <Link
                  href={`/jobs/${j.id}`}
                  className="mt-1 inline-block text-xs text-muted-foreground underline"
                >
                  {j.hydrationStatus === "hydrated"
                    ? "Open · view requirements"
                    : "Open · paste the description"}
                </Link>
                {j.explanation && (
                  <p className="mt-1 text-xs text-neutral-500">{j.explanation}</p>
                )}
                {/* EC-P4-20 — a stale score that looks current is a lie. */}
                {j.scoreIsStale && (
                  <p className="mt-1 text-xs text-amber-700">
                    Scored against an older resume version — rescore to update.
                  </p>
                )}
              </div>

              <div className="shrink-0 text-right text-xs text-neutral-500">
                <div>{j.source}</div>
                {HYDRATION_LABEL[j.hydrationStatus] && (
                  <div className={j.hydrationStatus === "hydrated" ? "text-green-700" : "text-amber-700"}>
                    {HYDRATION_LABEL[j.hydrationStatus]}
                  </div>
                )}
                {j.postedAt && <div>{j.postedAt}</div>}
                {j.hydrationStatus === "hydrated" && (
                  <Link href={`/tailor/${j.id}`}
                    className="mt-1 inline-block rounded border px-2 py-0.5 text-xs text-neutral-800">
                    Tailor
                  </Link>
                )}
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
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Jobs</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Deduplicated across boards and searches, ranked against your default resume.
      </p>
      <Suspense fallback={<p className="mt-8 text-sm text-neutral-500">Loading…</p>}>
        <JobsTable />
      </Suspense>
    </main>
  );
}
