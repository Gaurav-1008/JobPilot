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
import { Download, MailPlus } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ListEmpty, ListError, ListLoading } from "@/components/ui/list-state";
import { Page, PageHeader } from "@/components/ui/page";
import { ScoreValue } from "@/components/ui/score";

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

/**
 * Funnel order, left to right — plus the tone each stage carries.
 *
 * The tone is not decoration: nine identical grey headings made "rejected" and
 * "interviewing" equally easy to skim past, and those are the two rows a user
 * opens this page to find.
 */
const COLUMNS: [string, string, "secondary" | "info" | "success" | "warning" | "danger"][] = [
  ["saved", "Saved", "secondary"],
  ["scored", "Scored", "secondary"],
  ["tailored", "Tailored", "info"],
  ["contact_added", "Contact added", "info"],
  ["emailed", "Emailed", "info"],
  ["replied", "Replied", "success"],
  ["interviewing", "Interviewing", "success"],
  ["rejected", "Rejected", "danger"],
  ["closed", "Closed", "secondary"],
];

export default function TrackerPage() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);

  const { data, isPending, isError, refetch } = useQuery<{
    applications: Row[];
    pendingReview: number;
  }>({
    queryKey: ["tracker"],
    // EC-P7-01 — a failed request must reach the ERROR state, not the empty
    // one. Without this throw, `.json()` on a 500 yields an object with no
    // `applications` key, and the `?? []` below renders "No applications yet"
    // for a server error — telling the user their tracker is empty when it is
    // merely unreadable.
    queryFn: async () => {
      const res = await fetch("/api/tracker");
      if (!res.ok) throw new Error(`tracker request failed: ${res.status}`);
      return res.json();
    },
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

  // P7.1.1 / EC-P7-01 — loading, error, and empty are three separate
  // renderings, checked in that order. Sharing the first two would make a slow
  // query indistinguishable from an empty tracker.
  if (isPending) {
    return (
      <Page width="wide">
        <ListLoading rows={4} label="Loading your tracker" />
      </Page>
    );
  }

  if (isError) {
    return (
      <Page width="wide">
        {/* EC-P7-05 — this refetches a GET, so retrying is idempotent. The
            follow-up sweep below is a mutation and deliberately has no retry
            affordance of its own. */}
        <ListError
          onRetry={() => void refetch()}
          title="Your tracker could not be loaded"
          detail="The request did not complete. Every application is still recorded — this is a display problem."
        />
      </Page>
    );
  }

  const rows = data?.applications ?? [];
  const pending = data?.pendingReview ?? 0;

  return (
    <Page width="wide">
      <PageHeader
        title="Tracker"
        description="Every application, and everything that has happened to it."
        actions={
          <>
            <a
              href="/api/export/bundle"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Download className="size-4" aria-hidden="true" />
              Export proof
            </a>
            <a
              href="/api/export/bundle?redact=1"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Export redacted
            </a>
            <Button
              variant="outline"
              size="sm"
              onClick={() => sweep.mutate()}
              loading={sweep.isPending}
              title="Drafts follow-ups for emails you sent over a week ago with no reply recorded. Never sends."
            >
              {!sweep.isPending && <MailPlus className="size-4" aria-hidden="true" />}
              {sweep.isPending ? "Checking…" : "Draft follow-ups"}
            </Button>
          </>
        }
      />

      <div className="mt-6 space-y-4">
        {/* EC-P6-23: a review queue nobody is told about is a queue nobody clears. */}
        {pending > 0 && (
          <Alert
            role="status"
            tone="warning"
            title={`${pending} draft${pending === 1 ? "" : "s"} waiting for your review`}
          >
            <Link href="/outreach">Review them</Link> — nothing is sent until you
            approve it.
          </Alert>
        )}

        {notice && (
          <Alert role="status" tone="info">
            {notice}
          </Alert>
        )}

        <p className="text-xs leading-relaxed text-muted-foreground">
          “Draft follow-ups” writes drafts for anything sent over a week ago that
          you have not marked as replied. It cannot read your inbox and it cannot
          send — every draft goes through the same review and the same checks.
        </p>
      </div>

      {rows.length === 0 && (
        <div className="mt-6">
          <ListEmpty
            title="Nothing tracked yet"
            detail="Applications appear here as soon as you score or tailor a job — the tracker is built from what you do, not something you fill in."
            action={{ label: "Find jobs to score", href: "/jobs" }}
          />
        </div>
      )}

      <div className="mt-8 space-y-8">
        {COLUMNS.map(([status, label, tone]) => {
          const group = rows.filter((r) => r.status === status);
          if (group.length === 0) return null;
          return (
            <section key={status} aria-labelledby={`group-${status}`}>
              <h2 id={`group-${status}`} className="flex items-center gap-2">
                <Badge variant={tone}>{label}</Badge>
                <span className="text-xs text-muted-foreground">
                  {group.length}
                </span>
              </h2>

              <ul className="mt-3 space-y-2">
                {group.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-lg border border-border bg-card p-4 shadow-sm transition-colors duration-150 hover:border-border-strong"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/tracker/${r.id}`}
                          className="font-medium text-link underline decoration-link/40 underline-offset-4 hover:decoration-link"
                        >
                          {r.jobTitle}
                        </Link>
                        <p className="mt-0.5 truncate text-sm text-muted-foreground">
                          {r.company}
                          {r.location ? ` · ${r.location}` : ""}
                        </p>
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {r.contactCount} contact{r.contactCount === 1 ? "" : "s"}
                          {r.attemptCount > 0 &&
                            ` · ${r.attemptCount} attempt${r.attemptCount === 1 ? "" : "s"}`}
                          {r.resumeVersion !== null && ` · resume v${r.resumeVersion}`}
                        </p>
                        {r.pendingReview > 0 && (
                          <p className="mt-1 text-xs font-medium text-warning">
                            {r.pendingReview} awaiting review
                          </p>
                        )}
                      </div>

                      {/* EC-P6-06: a scoring-only application has none of
                          this, and renders blank rather than breaking. */}
                      <div className="shrink-0 text-right">
                        {r.tailoredScore ?? r.originalScore ? (
                          <ScoreValue
                            score={(r.tailoredScore ?? r.originalScore) as number}
                            size="md"
                          />
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
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
    </Page>
  );
}
