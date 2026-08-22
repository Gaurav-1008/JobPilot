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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { ListLoading } from "@/components/ui/list-state";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

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

const ATTEMPT_TONE: Record<
  string,
  "success" | "danger" | "warning" | "secondary"
> = {
  sent: "success",
  drafted: "success",
  failed: "danger",
  skipped: "secondary",
  generated: "warning",
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
    return (
      <Page width="content">
        <ListLoading rows={4} label="Loading this application" />
      </Page>
    );
  }
  if (!data) {
    return (
      <Page width="content">
        <PageHeader title="Not found" back={{ href: "/tracker", label: "Tracker" }} />
      </Page>
    );
  }

  return (
    <Page width="content">
      <PageHeader
        back={{ href: "/tracker", label: "Tracker" }}
        title={data.job.title}
        description={
          <>
            {data.job.company}
            {data.job.location ? ` · ${data.job.location}` : ""}
            {data.resumeVersion !== null && ` · resume v${data.resumeVersion}`}
            {data.tailoredScore !== null && ` · score ${data.tailoredScore}`}
          </>
        }
      />

      <div className="mt-8 space-y-6">
        {/* P6.1.4 — the user's own call. Deliberately unrestricted: they may move
            it backwards (EC-P6-05) or mark it emailed with no attempt on file
            (EC-P6-04), because they track reality, not just what this app did. */}
        <Field
          label="Status"
          hint="Marking this replied, interviewing, rejected or closed is final — the pipeline will not move it again on its own."
        >
          {(p) => (
            <Select
              {...p}
              value={data.status}
              onChange={(e) => patch.mutate({ status: e.target.value })}
              className="sm:w-64"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Notes" hint="Saved when you click away from the box.">
          {(p) => (
            <Textarea
              {...p}
              rows={3}
              className="min-h-24"
              defaultValue={data.notes ?? ""}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== null && patch.mutate({ notes })}
              placeholder="Recruiter name, referral, salary discussed…"
            />
          )}
        </Field>
      </div>

      <Section title={`Contacts (${data.contacts.length})`} className="mt-10">
        {data.contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground">None added.</p>
        ) : (
          <ul className="space-y-2">
            {data.contacts.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm"
              >
                <span className="min-w-0">
                  {c.name ? `${c.name} · ` : ""}
                  <span className="font-mono text-xs">{c.email}</span>
                </span>
                <Badge variant="accent">{c.source}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title={`Timeline (${data.attempts.length} attempt${data.attempts.length === 1 ? "" : "s"})`}
        className="mt-10"
      >
        {data.attempts.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {/* EC-P6-04: no attempts is not a missing row. If the status says
                emailed, the user recorded that themselves. */}
            {data.status === "emailed"
              ? "No attempts in JobPilot — you recorded this status manually."
              : "Nothing sent yet."}
          </p>
        )}

        {/*
         * A rail with a marker per entry, rather than a stack of bordered
         * boxes. These are events in time and the ordering carries meaning —
         * "generated, then failed, then skipped" is the story the user came
         * here for, and identical detached cards do not tell it.
         */}
        <ol className="relative space-y-4 border-l border-border pl-6">
          {data.attempts.map((a) => (
            <li key={a.id} className="relative">
              <span
                aria-hidden="true"
                className="absolute -left-[1.8125rem] top-1.5 size-2.5 rounded-full border-2 border-background bg-border-strong"
              />
              <div className="rounded-lg border border-border bg-card p-3 text-sm shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant={ATTEMPT_TONE[a.status] ?? "secondary"}>
                    {a.status}
                    {a.isFollowUp && " · follow-up"}
                  </Badge>
                  <time className="text-xs text-muted-foreground">
                    {new Date(a.createdAt).toLocaleString()}
                  </time>
                </div>

                <p className="mt-2 font-medium">{a.subject}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {a.recipient ?? "no contact"} · {a.wordCount} words ·{" "}
                  {a.generationSource} · {a.provider}
                </p>

                {a.errorMessage && (
                  <p className="mt-2 text-xs font-medium text-danger">
                    {a.errorMessage}
                  </p>
                )}
                {/* EC-P5-59: the one direction the audit trail can under-report. */}
                {a.status === "failed" && a.providerAttemptedAt && (
                  <p className="mt-2 text-xs font-medium text-warning">
                    Reached the provider before failing — a draft may exist.
                  </p>
                )}
                {a.providerMessageId && (
                  <p className="mt-2 truncate font-mono text-xs text-muted-foreground">
                    {a.providerMessageId}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Section>
    </Page>
  );
}
