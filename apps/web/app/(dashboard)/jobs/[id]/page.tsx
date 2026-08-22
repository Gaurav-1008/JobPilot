"use client";

import { use, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ListLoading } from "@/components/ui/list-state";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Textarea } from "@/components/ui/textarea";

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
const STATUS: Record<
  string,
  { label: string; variant: "secondary" | "success" | "warning" | "danger" }
> = {
  pending: { label: "Not fetched yet", variant: "secondary" },
  hydrated: { label: "Requirements extracted", variant: "success" },
  failed: { label: "Could not read this page", variant: "warning" },
  blocked: { label: "This board blocked automated access", variant: "danger" },
};

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [msgTone, setMsgTone] = useState<"info" | "danger">("info");
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
    setMsgTone("info");
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
    if (!res.ok) {
      setMsgTone("danger");
      setMsg(d.message ?? "Could not save.");
      return;
    }
    setPaste("");
    setMsgTone("info");
    setMsg("Saved.");
    void qc.invalidateQueries({ queryKey: ["job", id] });
  }

  if (isPending) {
    return (
      <Page width="content">
        <ListLoading rows={4} label="Loading this job" />
      </Page>
    );
  }
  if (!job) {
    return (
      <Page width="content">
        <PageHeader title="Job not found" back={{ href: "/jobs", label: "Jobs" }} />
      </Page>
    );
  }

  const p = job.jobDescription?.profile;
  const needsPaste = job.hydrationStatus === "blocked" || job.hydrationStatus === "failed";
  const status = STATUS[job.hydrationStatus];

  return (
    <Page width="content">
      <PageHeader
        back={{ href: "/jobs", label: "Jobs" }}
        title={job.title}
        description={
          <>
            {job.company}
            {job.location && ` · ${job.location}`} · {job.source}
            {job.postedAt && ` · ${job.postedAt}`}
          </>
        }
        actions={
          <a
            href={job.link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-md text-sm font-medium text-link underline decoration-link/40 underline-offset-4 hover:decoration-link"
          >
            View original posting
            {/* The icon is what tells the user this leaves the app; without it
                an external link is indistinguishable from an internal one. */}
            <ExternalLink className="size-3.5" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        }
      />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Badge variant={status?.variant ?? "secondary"}>
          {status?.label ?? job.hydrationStatus}
        </Badge>
        {job.jobDescription && (
          <span className="text-xs text-muted-foreground">
            via {job.jobDescription.extractionMethod}
          </span>
        )}
        {job.hydrationStatus === "pending" && (
          <Button size="sm" onClick={hydrate} loading={busy}>
            Fetch description
          </Button>
        )}
      </div>

      {msg && (
        <Alert role="status" tone={msgTone} className="mt-4">
          {msg}
        </Alert>
      )}

      {p && (
        <div className="mt-8 space-y-6">
          {([
            ["Required skills", p.requiredSkills],
            ["Preferred skills", p.preferredSkills],
            ["Responsibilities", p.responsibilities],
            ["Qualifications", p.qualifications],
          ] as const).map(([label, items]) =>
            items && items.length > 0 ? (
              <Section key={label} title={label}>
                {/*
                 * Skills render as chips, prose renders as a list. The two
                 * kinds of content were previously one bulleted list each, so
                 * a twelve-skill requirement column took twelve lines of
                 * vertical space to say twelve words.
                 */}
                {label.endsWith("skills") ? (
                  <ul className="flex flex-wrap gap-1.5">
                    {items.map((s, i) => (
                      <li key={i}>
                        <Badge variant="outline">{s}</Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
                    {items.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                )}
              </Section>
            ) : null,
          )}
          {p.seniorityLevel && (
            <p className="text-sm">
              <span className="text-muted-foreground">Seniority:</span>{" "}
              <span className="font-medium">{p.seniorityLevel}</span>
            </p>
          )}
        </div>
      )}

      {/* FR2 — the paste box is what makes "never dead-end the user" true.
          Offered whenever automation could not read the page, and always
          available below regardless of status. */}
      {needsPaste && (
        <Alert tone="warning" className="mt-8" title="Paste the description instead">
          We could not read this page automatically. Copy the job description
          from the original posting and paste it below — everything downstream
          works exactly the same.
        </Alert>
      )}

      <div className="mt-6 space-y-3">
        <Field
          label={job.jobDescription ? "Replace the description" : "Paste the job description"}
          hint="Plain text is fine — formatting is stripped before it is parsed."
        >
          {(fieldProps) => (
            <Textarea
              {...fieldProps}
              rows={8}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              className="font-mono text-xs"
              placeholder="Paste the full job description…"
            />
          )}
        </Field>
        <Button
          variant="outline"
          onClick={submitPaste}
          loading={busy}
          disabled={paste.trim().length === 0}
        >
          Save description
        </Button>
      </div>
    </Page>
  );
}
