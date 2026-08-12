"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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
}

export default function SearchPage() {
  const router = useRouter();
  const [role, setRole] = useState("AI Engineer");
  const [location, setLocation] = useState("Bengaluru");
  const [boards, setBoards] = useState<string[]>([...BOARDS]);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const running = run !== null && !["complete", "partial", "failed"].includes(run.status);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Search jobs</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Runs in the background across every board you pick. One board failing
        never fails the others.
      </p>

      <form onSubmit={start} className="mt-6 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm">Role</span>
            <input value={role} onChange={(e) => setRole(e.target.value)} required
              className="mt-1 w-full rounded border px-3 py-2" />
          </label>
          <label className="block">
            <span className="text-sm">Location <span className="text-neutral-400">(optional)</span></span>
            <input value={location} onChange={(e) => setLocation(e.target.value)}
              className="mt-1 w-full rounded border px-3 py-2" />
          </label>
        </div>

        <fieldset>
          <legend className="text-sm">Boards</legend>
          <div className="mt-2 flex gap-4">
            {BOARDS.map((b) => (
              <label key={b} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={boards.includes(b)}
                  onChange={(e) => setBoards((prev) =>
                    e.target.checked ? [...prev, b] : prev.filter((x) => x !== b))} />
                {b}
              </label>
            ))}
          </div>
        </fieldset>

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={running || boards.length === 0}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50">
          {running ? "Searching…" : "Search"}
        </button>
      </form>

      {run && (
        <section className="mt-10">
          <h2 className="text-lg font-medium">
            Progress <span className="text-sm font-normal text-neutral-500">({run.status})</span>
          </h2>
          <ul className="mt-3 divide-y rounded border">
            {boards.map((b) => {
              const r = run.boardResults?.[b];
              return (
                <li key={b} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span className="font-medium">{b}</span>
                  {!r ? (
                    <span className="text-neutral-400">waiting…</span>
                  ) : r.status === "failed" ? (
                    // EC-P2-38: a globally-open circuit is not this user's
                    // fault. Say "temporarily unavailable", not "failed".
                    <span className="text-amber-700">
                      {r.reason === "circuit_open"
                        ? "temporarily unavailable"
                        : `unavailable — ${r.reason ?? "unknown"}`}
                    </span>
                  ) : (
                    <span className="text-green-700">
                      {r.count} job{r.count === 1 ? "" : "s"}
                      {r.status === "partial" && " (partial)"}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          {!running && (
            <button onClick={() => router.push(`/jobs?runId=${runId}`)}
              className="mt-4 rounded border px-4 py-2 text-sm">
              View {run.jobCount ?? 0} jobs
            </button>
          )}
        </section>
      )}
    </main>
  );
}
