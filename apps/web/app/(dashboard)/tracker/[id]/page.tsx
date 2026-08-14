"use client";

/**
 * Per-application timeline (P6.1.4, P6.1.5, P6.1.6).
 *
 * Shows skipped and failed attempts alongside successful ones. A tracker that
 * lists only what worked is a highlight reel, and "what happened here?" is
 * asked precisely when something did not — a blocked send, a draft never
 * reviewed, an email deliberately skipped.
 */

import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface Attempt {
  id: string;
  status: string;
  provider: string;
  subject: string;
  wordCount: number;
  generationSource: string;
  providerMessageId: string | null;
  providerAttemptedAt: string | null;
  errorMessage: string | null;
  isFollowUp: boolean;
  recipient: string | null;
  createdAt: string;
}

interface Timeline {
  id: string;
  status: string;
  notes: string | null;
  job: { title: string; company: string; location: string | null; url: string };
  resumeVersion: number | null;
  originalScore: number | null;
  tailoredScore: number | null;
  contacts: { id: string; email: string; name: string | null; source: string }[];
  tailoringRuns: { id: string; tier: string; createdAt: string }[];
  attempts: Attempt[];
}

const STATUSES = [
  "saved", "scored", "tailored", "contact_added",
  "emailed", "replied", "interviewing", "rejected", "closed",
] as const;

const ATTEMPT_TONE: Record<string, string> = {
  sent: "text-green-700",
  drafted: "text-green-700",
  failed: "text-red-700",
  skipped: "text-muted-foreground",
  generated: "text-amber-700",
};

export default function TrackerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [notes, setNotes] = useState<string | null>(null);

  const { data, isPending } = useQuery<Timeline>({
    queryKey: ["tracker", id],
    queryFn: async () => {
      const res = await fetch(`/api/tracker/${id}`);
      if (!res.ok) throw new Error("not found");
      return res.json();
    },
  });

  const patch = useMutation({
    mutationFn: async (body: { status?: string; notes?: string }) => {
      const res = await fetch(`/api/tracker/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return res.json();
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tracker", id] }),
  });

  if (isPending) {
    return <main className="p-8 text-sm text-muted-foreground">Loading…</main>;
  }
  if (!data) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-xl font-semibold">Not found</h1>
        <Link href="/tracker" className="mt-3 inline-block text-sm underline">
          ← Tracker
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/tracker" className="text-sm underline text-muted-foreground">
        ← Tracker
      </Link>

      <h1 className="mt-4 text-2xl font-semibold">{data.job.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {data.job.company}
        {data.job.location ? ` · ${data.job.location}` : ""}
        {data.resumeVersion !== null && ` · resume v${data.resumeVersion}`}
        {data.tailoredScore !== null && ` · score ${data.tailoredScore}`}
      </p>

      {/* P6.1.4 — the user's own call. Deliberately unrestricted: they may move
          it backwards (EC-P6-05) or mark it emailed with no attempt on file
          (EC-P6-04), because they track reality, not just what this app did. */}
      <section className="mt-6">
        <label className="block text-sm font-medium">Status</label>
        <select
          value={data.status}
          onChange={(e) => patch.mutate({ status: e.target.value })}
          className="mt-1 rounded border px-3 py-2 text-sm"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">
          Marking this replied, interviewing, rejected or closed is final — the
          pipeline will not move it again on its own.
        </p>
      </section>

      <section className="mt-6">
        <label className="block text-sm font-medium">Notes</label>
        <textarea
          rows={3}
          defaultValue={data.notes ?? ""}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== null && patch.mutate({ notes })}
          placeholder="Recruiter name, referral, salary discussed…"
          className="mt-1 w-full rounded border px-3 py-2 text-sm"
        />
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-muted-foreground">
          Contacts ({data.contacts.length})
        </h2>
        {data.contacts.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">None added.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {data.contacts.map((c) => (
              <li key={c.id}>
                {c.name ? `${c.name} · ` : ""}
                <span className="font-mono text-xs">{c.email}</span>
                <span className="ml-2 text-xs text-muted-foreground">{c.source}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-muted-foreground">
          Timeline ({data.attempts.length} attempt
          {data.attempts.length === 1 ? "" : "s"})
        </h2>

        {data.attempts.length === 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            {/* EC-P6-04: no attempts is not a missing row. If the status says
                emailed, the user recorded that themselves. */}
            {data.status === "emailed"
              ? "No attempts in JobPilot — you recorded this status manually."
              : "Nothing sent yet."}
          </p>
        )}

        <ol className="mt-3 space-y-3">
          {data.attempts.map((a) => (
            <li key={a.id} className="rounded border border-border bg-card p-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className={ATTEMPT_TONE[a.status] ?? ""}>
                  {a.status}
                  {a.isFollowUp && " · follow-up"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(a.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="mt-1">{a.subject}</p>
              <p className="text-xs text-muted-foreground">
                {a.recipient ?? "no contact"} · {a.wordCount} words ·{" "}
                {a.generationSource} · {a.provider}
              </p>
              {a.errorMessage && (
                <p className="mt-1 text-xs text-red-700">{a.errorMessage}</p>
              )}
              {/* EC-P5-59: the one direction the audit trail can under-report. */}
              {a.status === "failed" && a.providerAttemptedAt && (
                <p className="mt-1 text-xs text-amber-700">
                  Reached the provider before failing — a draft may exist.
                </p>
              )}
              {a.providerMessageId && (
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {a.providerMessageId}
                </p>
              )}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
