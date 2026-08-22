"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, RotateCw, Search as SearchIcon } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Page, PageHeader } from "@/components/ui/page";
import { cn } from "@/lib/utils";

const BOARDS = ["naukri", "remoteok", "wellfound"] as const;

interface BoardResult {
  status: "ok" | "partial" | "failed";
  count: number;
  reason: string | null;
}
interface RunState {
  status: string;
  boardResults: Record<string, BoardResult | null>;
  jobCount?: number;
  retryCount?: number;
}

/** A run in any other state still has work in flight (EC-P7-12). */
const TERMINAL = ["complete", "partial", "failed"];

export default function SearchPage() {
  const router = useRouter();
  const [role, setRole] = useState("AI Engineer");
  const [location, setLocation] = useState("Bengaluru");
  const [boards, setBoards] = useState<string[]>([...BOARDS]);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  // EC-P2-42/43 — SSE is an optimisation. Polling the durable record runs
  // alongside it and is what actually guarantees progress appears: streams drop
  // on mobile, on sleep, and behind buffering proxies.
  useEffect(() => {
    if (!runId) return;

    const poll = setInterval(async () => {
      const r = await fetch(`/api/harvest/${runId}`);
      if (!r.ok) return;
      const d = await r.json();
      setRun(d);
      if (["complete", "partial", "failed"].includes(d.status)) {
        clearInterval(poll);
        esRef.current?.close();
      }
    }, 2000);

    const es = new EventSource(`/api/harvest/${runId}/events`);
    esRef.current = es;
    es.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.type === "snapshot") setRun((p) => ({ ...(p ?? { boardResults: {} }), ...d }));
      } catch { /* stream is best-effort */ }
    };
    es.onerror = () => es.close();   // polling carries on regardless

    return () => { clearInterval(poll); es.close(); };
  }, [runId]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setRun(null);
    const res = await fetch("/api/harvest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, location: location || null, boards, limit: 20 }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setError(d.message ?? "Could not start the search."); return; }
    setRunId(d.runId);
  }

  /**
   * P7.2.1 / EC-P7-13 — retry only what failed, and only once it is finished.
   *
   * `setRunId(runId)` afterwards is not a no-op even though the id is unchanged:
   * the polling effect keys on it, and it stopped when the run first reached a
   * terminal state. Without re-arming it the retry runs and the screen never
   * updates, which looks exactly like the retry not working.
   */
  async function retryFailed() {
    if (!runId) return;
    setRetrying(true);
    setError(null);
    const res = await fetch(`/api/harvest/${runId}/retry`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    setRetrying(false);
    if (!res.ok) { setError(d.error ?? "Could not retry."); return; }

    setRun((prev) => (prev ? { ...prev, status: "running" } : prev));
    setRunId(null);
    setTimeout(() => setRunId(d.runId ?? runId), 0);
  }

  const running = run !== null && !TERMINAL.includes(run.status);

  /**
   * EC-P7-12 — the retry control exists only for a terminal run with something
   * that actually failed. Offering it mid-run invites a press that either
   * duplicates work or is silently discarded, and both teach the user that the
   * button lies.
   */
  const failedBoards = run
    ? boards.filter((b) => run.boardResults?.[b]?.status === "failed")
    : [];
  const canRetry = run !== null && !running && failedBoards.length > 0;

  return (
    <Page width="content">
      <PageHeader
        title="Search jobs"
        description="Runs in the background across every board you pick. One board failing never fails the others."
      />

      <form onSubmit={start} className="mt-8 space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Role" required>
            {(p) => (
              <Input
                {...p}
                value={role}
                onChange={(e) => setRole(e.target.value)}
                required
                placeholder="AI Engineer"
              />
            )}
          </Field>
          <Field label="Location" hint="Optional — leave blank to search everywhere.">
            {(p) => (
              <Input
                {...p}
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Bengaluru"
              />
            )}
          </Field>
        </div>

        <fieldset>
          <legend className="text-sm font-medium">Boards</legend>
          {/*
           * Each board is a full card rather than a bare checkbox with a word
           * next to it. The original was three ~13px labels in a row: the tap
           * target was the checkbox alone at 16px, and unticking a board on a
           * phone was genuinely fiddly on the screen where the choice matters
           * most.
           */}
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {BOARDS.map((b) => {
              const checked = boards.includes(b);
              return (
                <label
                  key={b}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors duration-150",
                    checked
                      ? "border-primary bg-primary-soft font-medium text-foreground"
                      : "border-border-strong bg-card text-muted-foreground hover:border-border-strong hover:text-foreground",
                  )}
                >
                  <Checkbox
                    checked={checked}
                    onChange={(e) =>
                      setBoards((prev) =>
                        e.target.checked ? [...prev, b] : prev.filter((x) => x !== b),
                      )
                    }
                  />
                  {b}
                </label>
              );
            })}
          </div>
          {boards.length === 0 && (
            <p className="mt-2 text-xs font-medium text-warning">
              Pick at least one board to search.
            </p>
          )}
        </fieldset>

        {error && (
          <Alert role="alert" tone="danger" title="Could not start the search">
            {error}
          </Alert>
        )}

        <Button type="submit" size="lg" loading={running} disabled={boards.length === 0}>
          {!running && <SearchIcon className="size-4" aria-hidden="true" />}
          {running ? "Searching…" : "Search"}
        </Button>
      </form>

      {run && (
        <section className="mt-10" aria-labelledby="progress">
          <div className="flex items-center gap-2">
            <h2 id="progress" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Progress
            </h2>
            <span className="text-xs text-muted-foreground">({run.status})</span>
            {running && (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
            )}
          </div>

          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {boards.map((b) => {
              const r = run.boardResults?.[b];
              return (
                <li key={b} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="font-medium">{b}</span>
                  {!r ? (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      waiting…
                    </span>
                  ) : r.status === "failed" ? (
                    // EC-P2-38: a globally-open circuit is not this user's
                    // fault. Say "temporarily unavailable", not "failed".
                    <span className="text-right font-medium text-warning">
                      {r.reason === "circuit_open"
                        ? "temporarily unavailable"
                        : `unavailable — ${r.reason ?? "unknown"}`}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 font-medium text-success">
                      <CheckCircle2 className="size-3.5" aria-hidden="true" />
                      {r.count} job{r.count === 1 ? "" : "s"}
                      {r.status === "partial" && " (partial)"}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {!running && (
              <Button onClick={() => router.push(`/jobs?runId=${runId}`)}>
                View {run.jobCount ?? 0} jobs
              </Button>
            )}

            {/* EC-P7-13: the label names the subset, because "Retry" next to a
                list of results that mostly succeeded reads as "run it all
                again" — and a user who believes that will not press it. */}
            {canRetry && (
              <Button variant="outline" onClick={retryFailed} loading={retrying}>
                {!retrying && <RotateCw className="size-4" aria-hidden="true" />}
                {retrying
                  ? "Retrying…"
                  : `Retry ${failedBoards.length} failed board${failedBoards.length === 1 ? "" : "s"}`}
              </Button>
            )}

            {running && (
              /* EC-P7-12 — say what is happening instead of showing a disabled
                 retry control. A greyed-out button with no explanation reads as
                 broken; the current state is the more useful thing to show. */
              <p className="text-sm text-muted-foreground">
                Still searching — retry becomes available when this finishes.
              </p>
            )}
          </div>
        </section>
      )}
    </Page>
  );
}
