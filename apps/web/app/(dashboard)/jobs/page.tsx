"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, Sparkles } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ListEmpty,
  ListError,
  ListLoading,
  ListNoMatches,
} from "@/components/ui/list-state";
import { Page, PageHeader } from "@/components/ui/page";
import { ScoreValue } from "@/components/ui/score";
import { Select } from "@/components/ui/select";

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

/**
 * Hydration state, as a badge tone rather than a bare word.
 *
 * `pending` is deliberately absent: "not fetched yet" is the default for every
 * freshly harvested row, and a badge on all of them is noise that makes the
 * ones which actually went wrong harder to spot.
 */
const HYDRATION: Record<string, { label: string; variant: "success" | "warning" | "danger" }> = {
  hydrated: { label: "parsed", variant: "success" },
  failed: { label: "unreadable", variant: "warning" },
  blocked: { label: "blocked", variant: "danger" },
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
  if (isPending) return <ListLoading rows={5} label="Loading jobs" className="mt-8" />;

  if (isError) {
    return (
      <div className="mt-8">
        <ListError
          onRetry={() => void refetch()}
          title="Your jobs could not be loaded"
          detail="The request did not complete. Nothing has been lost — this is a display problem."
        />
      </div>
    );
  }

  if (all.length === 0) {
    return (
      <div className="mt-8">
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
        <p className="mx-auto mt-5 max-w-md text-center text-sm leading-relaxed text-muted-foreground">
          Not ready to search?{" "}
          <button
            onClick={async () => {
              await fetch("/api/onboarding/sample", { method: "POST" });
              void refresh();
            }}
            className="cursor-pointer font-medium text-link underline decoration-link/40 underline-offset-4 hover:decoration-link"
          >
            Load three sample jobs
          </button>{" "}
          — clearly labelled, removable in one click, and never used as your
          default resume.
        </p>
      </div>
    );
  }

  return (
    <>
      {/*
       * Filter and action bar.
       *
       * Sticky under the 56px header so the bulk controls stay reachable while
       * scrolling a long board — selecting rows 1 and 30 previously meant
       * scrolling back to the top to act on them. The two groups are separated
       * by `ml-auto` rather than a divider: reads (filters) on the left,
       * writes (fetch, score) on the right.
       */}
      <div className="sticky top-14 z-30 -mx-4 mt-6 border-y border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            aria-label="Filter by source"
            className="h-9 w-auto min-w-40 text-sm"
          >
            <option value="all">All sources ({all.length})</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s} ({all.filter((j) => j.source === s).length})
              </option>
            ))}
          </Select>

          <Select
            value={band}
            onChange={(e) => setBand(e.target.value as typeof band)}
            aria-label="Filter by score"
            className="h-9 w-auto min-w-40 text-sm"
          >
            <option value="all">All scores</option>
            <option value="strong">Good fit</option>
            {/* EC-P4-02 — low-fit jobs are one click away and fully tailorable.
                A heuristic must never be the reason a job is unreachable. */}
            <option value="low">Low fit ({lowFitCount})</option>
            <option value="unscored">Not scored yet</option>
          </Select>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={hydrateSelected}
              disabled={selected.size === 0}
            >
              <Download className="size-4" aria-hidden="true" />
              Fetch descriptions
              {selected.size > 0 && ` (${selected.size})`}
            </Button>

            <Button size="sm" onClick={scoreAll} disabled={hydratedCount === 0}>
              <Sparkles className="size-4" aria-hidden="true" />
              Score {hydratedCount} against my resume
            </Button>
          </div>
        </div>
      </div>

      {msg && (
        <Alert role="status" tone="info" className="mt-4">
          {msg}
        </Alert>
      )}

      {/* EC-P7-02 — "no jobs" and "no jobs match" are different sentences with
          different next actions, and this is the branch that keeps them apart.
          Reaching here means `all.length > 0`, so the data exists and only the
          filters are hiding it. */}
      {shown.length === 0 ? (
        <div className="mt-4">
          <ListNoMatches
            total={all.length}
            noun="jobs"
            onClear={() => { setSource("all"); setBand("all"); }}
          />
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {shown.map((j) => (
            <li
              key={j.id}
              className="rounded-lg border border-border bg-card p-4 shadow-sm transition-colors duration-150 hover:border-border-strong"
            >
              <div className="flex items-start gap-3 sm:gap-4">
                {/* The checkbox gets its own label rather than relying on the
                    row: a click anywhere on the row must be able to open the
                    job, and a wrapping label would swallow that. */}
                <Checkbox
                  checked={selected.has(j.id)}
                  onChange={() => toggle(j.id)}
                  className="mt-1"
                  aria-label={`Select ${j.title} at ${j.company}`}
                />

                {/* The score column — the point of the phase. */}
                <div className="w-14 shrink-0 text-center">
                  {j.score === null ? (
                    <span
                      className="text-sm text-muted-foreground"
                      title="Not scored yet"
                    >
                      —
                    </span>
                  ) : (
                    <>
                      <ScoreValue score={j.tailoredScore ?? j.score} size="md" />
                      {j.tier && (
                        <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
                          {TIER_LABEL[j.tier]}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {/* Styled as a link, not just behaving like one. This was
                        `font-medium hover:underline` — indistinguishable from a
                        heading until the pointer happened to land on the text, so
                        the way into a job (and to the paste box, the only route for
                        a description automation could not fetch) was invisible. */}
                    <Link
                      href={`/jobs/${j.id}`}
                      className="font-medium text-link underline decoration-link/40 underline-offset-4 hover:decoration-link"
                    >
                      {j.title}
                    </Link>
                    {HYDRATION[j.hydrationStatus] && (
                      <Badge variant={HYDRATION[j.hydrationStatus].variant}>
                        {HYDRATION[j.hydrationStatus].label}
                      </Badge>
                    )}
                  </div>

                  <p className="mt-0.5 truncate text-sm text-muted-foreground">
                    {j.company}
                    {j.location && ` · ${j.location}`}
                  </p>

                  {j.explanation && (
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                      {j.explanation}
                    </p>
                  )}

                  {/* EC-P4-20 — a stale score that looks current is a lie. */}
                  {j.scoreIsStale && (
                    <p className="mt-1.5 text-xs font-medium text-warning">
                      Scored against an older resume version — rescore to update.
                    </p>
                  )}

                  <p className="mt-2 text-xs text-muted-foreground">
                    {j.source}
                    {j.postedAt && ` · ${j.postedAt}`}
                  </p>
                </div>

                {/*
                 * Actions, right-aligned on a wide screen and stacked full-
                 * width below the row on a phone. Previously this column held
                 * a 20px-tall "Tailor" pill next to three lines of metadata,
                 * which was both the smallest target on the screen and the
                 * most important one.
                 */}
                <div className="hidden shrink-0 flex-col items-end gap-2 sm:flex">
                  <Link
                    href={`/jobs/${j.id}`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    {j.hydrationStatus === "hydrated"
                      ? "View requirements"
                      : "Paste description"}
                  </Link>
                  {j.hydrationStatus === "hydrated" && (
                    <Link
                      href={`/tailor/${j.id}`}
                      className={buttonVariants({ size: "sm" })}
                    >
                      Tailor
                    </Link>
                  )}
                </div>
              </div>

              <div className="mt-3 flex gap-2 sm:hidden">
                <Link
                  href={`/jobs/${j.id}`}
                  className={buttonVariants({
                    variant: "outline",
                    size: "sm",
                    className: "flex-1",
                  })}
                >
                  {j.hydrationStatus === "hydrated" ? "Requirements" : "Paste description"}
                </Link>
                {j.hydrationStatus === "hydrated" && (
                  <Link
                    href={`/tailor/${j.id}`}
                    className={buttonVariants({ size: "sm", className: "flex-1" })}
                  >
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
    <Page width="wide">
      <PageHeader
        title="Jobs"
        description="Deduplicated across boards and searches, ranked against your default resume."
        actions={
          <Link
            href="/search"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            New search
          </Link>
        }
      />
      <Suspense fallback={<ListLoading rows={5} label="Loading jobs" className="mt-8" />}>
        <JobsTable />
      </Suspense>
    </Page>
  );
}
