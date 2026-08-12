"use client";

import { use, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

interface JdProfile {
  requiredSkills?: string[];
  preferredSkills?: string[];
  responsibilities?: string[];
  qualifications?: string[];
  seniorityLevel?: string;
}
interface JobDetail {
  id: string; source: string; title: string; company: string;
  location: string | null; link: string; postedAt: string | null;
  hydrationStatus: "pending" | "hydrated" | "failed" | "blocked";
  jobDescription: {
    rawText: string; extractionMethod: string;
    profile: JdProfile; extractedAt: string;
  } | null;
}

/** EC-P3-45 — five states, five renderings. They mean different things. */
const STATUS_COPY: Record<string, string> = {
  pending: "Not fetched yet",
  hydrated: "Requirements extracted",
  failed: "Could not read this page",
  blocked: "This board blocked automated access",
};

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: job, isPending } = useQuery<JobDetail>({
    queryKey: ["job", id],
    queryFn: async () => (await fetch(`/api/jobs/${id}`)).json(),
    // Poll while a fetch is in flight so the page updates without a refresh.
    refetchInterval: (q) =>
      (q.state.data as JobDetail | undefined)?.hydrationStatus === "pending" ? 3000 : false,
  });

  async function hydrate() {
    setBusy(true); setMsg(null);
    await fetch("/api/jobs/hydrate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobIds: [id] }),
    });
    setBusy(false);
    setMsg("Fetching the description…");
    void qc.invalidateQueries({ queryKey: ["job", id] });
  }

  async function submitPaste() {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/jobs/${id}/jd`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: paste }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setMsg(d.message ?? "Could not save."); return; }
    setPaste("");
    setMsg("Saved.");
    void qc.invalidateQueries({ queryKey: ["job", id] });
  }

  if (isPending) return <main className="p-8 text-sm text-neutral-500">Loading…</main>;
  if (!job) return <main className="p-8 text-sm text-neutral-500">Job not found.</main>;

  const p = job.jobDescription?.profile;
  const needsPaste = job.hydrationStatus === "blocked" || job.hydrationStatus === "failed";

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">{job.title}</h1>
      <p className="mt-1 text-sm text-neutral-600">
        {job.company}{job.location && ` · ${job.location}`} · {job.source}
        {job.postedAt && ` · ${job.postedAt}`}
      </p>
      <a href={job.link} target="_blank" rel="noopener noreferrer"
        className="mt-2 inline-block text-sm underline">
        View original posting
      </a>

      <div className="mt-6 flex items-center gap-3">
        <span className="rounded border px-2 py-1 text-xs">
          {STATUS_COPY[job.hydrationStatus] ?? job.hydrationStatus}
        </span>
        {job.jobDescription && (
          <span className="text-xs text-neutral-500">
            via {job.jobDescription.extractionMethod}
          </span>
        )}
        {job.hydrationStatus === "pending" && (
          <button onClick={hydrate} disabled={busy}
            className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-50">
            Fetch description
          </button>
        )}
      </div>
      {msg && <p role="status" className="mt-3 text-sm text-neutral-700">{msg}</p>}

      {p && (
        <section className="mt-8 space-y-5">
          {([
            ["Required skills", p.requiredSkills],
            ["Preferred skills", p.preferredSkills],
            ["Responsibilities", p.responsibilities],
            ["Qualifications", p.qualifications],
          ] as const).map(([label, items]) =>
            items && items.length > 0 ? (
              <div key={label}>
                <h2 className="text-sm font-medium text-neutral-500">{label}</h2>
                <ul className="mt-1 list-disc pl-5 text-sm">
                  {items.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            ) : null,
          )}
          {p.seniorityLevel && (
            <p className="text-sm"><span className="text-neutral-500">Seniority:</span> {p.seniorityLevel}</p>
          )}
        </section>
      )}

      {/* FR2 — the paste box is what makes "never dead-end the user" true.
          Offered whenever automation could not read the page, and always
          available below regardless of status. */}
      {needsPaste && (
        <section className="mt-8 rounded border border-amber-300 bg-amber-50 p-4">
          <h2 className="text-sm font-medium">Paste the description instead</h2>
          <p className="mt-1 text-sm text-neutral-700">
            We could not read this page automatically. Copy the job description
            from the original posting and paste it here — everything downstream
            works exactly the same.
          </p>
        </section>
      )}

      <section className="mt-6">
        <label className="block">
          <span className="text-sm">
            {job.jobDescription ? "Replace the description" : "Paste the job description"}
          </span>
          <textarea rows={8} value={paste} onChange={(e) => setPaste(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2 font-mono text-xs"
            placeholder="Paste the full job description…" />
        </label>
        <button onClick={submitPaste} disabled={busy || paste.trim().length === 0}
          className="mt-2 rounded border px-4 py-2 text-sm disabled:opacity-50">
          Save description
        </button>
      </section>
    </main>
  );
}
