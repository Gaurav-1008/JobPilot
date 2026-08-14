"use client";

/**
 * Application tracker (P6.1.2) — Breakage 3 closed, the system of record made
 * visible.
 *
 * Grouped by status rather than listed flat, because the question this screen
 * answers is "where is everything?", and a flat list answers "what exists?".
 *
 * The follow-up control is labelled for what it can actually do. EC-P6-12:
 * nothing in this architecture reads an inbox, so the sweep cannot know whether
 * anyone replied — only whether YOU recorded a reply. It says so, because a
 * feature that implies inbox awareness it does not have is a promise the user
 * discovers is false at the worst possible moment.
 */

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface Row {
  id: string;
  status: string;
  jobTitle: string;
  company: string;
  location: string | null;
  originalScore: number | null;
  tailoredScore: number | null;
  resumeVersion: number | null;
  contactCount: number;
  attemptCount: number;
  lastAttemptStatus: string | null;
  pendingReview: number;
  notes: string | null;
}

/** Funnel order, left to right. */
const COLUMNS = [
  ["saved", "Saved"],
  ["scored", "Scored"],
  ["tailored", "Tailored"],
  ["contact_added", "Contact added"],
  ["emailed", "Emailed"],
  ["replied", "Replied"],
  ["interviewing", "Interviewing"],
  ["rejected", "Rejected"],
  ["closed", "Closed"],
] as const;

export default function TrackerPage() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);

  const { data, isPending } = useQuery<{ applications: Row[]; pendingReview: number }>({
    queryKey: ["tracker"],
    queryFn: async () => (await fetch("/api/tracker")).json(),
  });

  const sweep = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/outreach/followups", { method: "POST" });
      return res.json();
    },
    onSuccess: (body) => {
      setNotice(body.message ?? "Sweep finished.");
      void qc.invalidateQueries({ queryKey: ["tracker"] });
    },
  });

  if (isPending) {
    return <main className="p-8 text-sm text-muted-foreground">Loading…</main>;
  }

  const rows = data?.applications ?? [];
  const pending = data?.pendingReview ?? 0;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Tracker</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every application, and everything that has happened to it.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <a href="/api/export/bundle" className="rounded border px-3 py-2">
            Export proof
          </a>
          <a href="/api/export/bundle?redact=1" className="rounded border px-3 py-2">
            Export redacted
          </a>
          <button
            onClick={() => sweep.mutate()}
            disabled={sweep.isPending}
            className="rounded border px-3 py-2 disabled:opacity-50"
          >
            {sweep.isPending ? "Checking…" : "Draft follow-ups"}
          </button>
        </div>
      </div>

      {/* EC-P6-23: a review queue nobody is told about is a queue nobody clears. */}
      {pending > 0 && (
        <p className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {pending} draft{pending === 1 ? "" : "s"} waiting for your review.{" "}
          <Link href="/outreach" className="underline">
            Review them
          </Link>{" "}
          — nothing is sent until you approve it.
        </p>
      )}

      {notice && (
        <p role="status" className="mt-4 rounded border border-border bg-card p-3 text-sm">
          {notice}
        </p>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        “Draft follow-ups” writes drafts for anything sent over a week ago that
        you have not marked as replied. It cannot read your inbox and it cannot
        send — every draft goes through the same review and the same checks.
      </p>

      {rows.length === 0 && (
        <p className="mt-8 rounded border border-border bg-card p-4 text-sm text-muted-foreground">
          Nothing tracked yet. Applications appear here once you score or tailor
          a job.
        </p>
      )}

      <div className="mt-8 space-y-8">
        {COLUMNS.map(([status, label]) => {
          const group = rows.filter((r) => r.status === status);
          if (group.length === 0) return null;
          return (
            <section key={status}>
              <h2 className="text-sm font-medium text-muted-foreground">
                {label} ({group.length})
              </h2>
              <ul className="mt-2 space-y-2">
                {group.map((r) => (
                  <li key={r.id} className="rounded border border-border bg-card p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={`/tracker/${r.id}`}
                          className="font-medium text-primary underline underline-offset-4"
                        >
                          {r.jobTitle}
                        </Link>
                        <p className="text-sm text-muted-foreground">
                          {r.company}
                          {r.location ? ` · ${r.location}` : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right text-xs text-muted-foreground">
                        {/* EC-P6-06: a scoring-only application has none of
                            this, and renders blank rather than breaking. */}
                        {r.tailoredScore ?? r.originalScore ?? "—"}
                        {r.resumeVersion !== null && ` · resume v${r.resumeVersion}`}
                        <div>
                          {r.contactCount} contact{r.contactCount === 1 ? "" : "s"}
                          {r.attemptCount > 0 && ` · ${r.attemptCount} attempt${r.attemptCount === 1 ? "" : "s"}`}
                        </div>
                        {r.pendingReview > 0 && (
                          <div className="text-amber-600">
                            {r.pendingReview} awaiting review
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </main>
  );
}
