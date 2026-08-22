"use client";

/**
 * Outreach hub (P5.1.2, P5.1.5).
 *
 * Two things this screen deliberately does NOT have:
 *   - a "find contact" button (ADR-008 — there is no discovery in this product)
 *   - a "send all" action (§12.3 — there is no bulk path to build)
 *
 * The `source` dropdown has no pre-selected value. Defaulting it would make
 * provenance a formality the user clicks past, which is exactly what the
 * NOT NULL column exists to prevent (EC-P5-07).
 */

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, MailPlus, Settings2, ShieldOff } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ListEmpty, ListLoading } from "@/components/ui/list-state";
import { Page, PageHeader } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface AppRow {
  id: string;
  status: string;
  jobTitle: string;
  company: string;
  contactCount: number;
  attemptCount: number;
}

interface ContactRow {
  id: string;
  applicationId: string;
  recipientEmailDisplay: string;
  recipientName: string | null;
  source: string;
  createdAt: string;
}

const SOURCE_LABELS: Record<string, string> = {
  user_entered: "Entered by hand",
  company_careers_page: "Company careers page",
  imported_csv: "Imported from CSV",
};

export default function OutreachPage() {
  const qc = useQueryClient();
  const [openApp, setOpenApp] = useState<string | null>(null);
  const [sweepNotice, setSweepNotice] = useState<string | null>(null);

  const { data: apps, isPending } = useQuery<{ applications: AppRow[] }>({
    queryKey: ["applications"],
    queryFn: async () => (await fetch("/api/applications")).json(),
  });

  const { data: contacts } = useQuery<{ contacts: ContactRow[] }>({
    queryKey: ["contacts", openApp],
    queryFn: async () =>
      (await fetch(`/api/contacts?applicationId=${openApp}`)).json(),
    enabled: openApp !== null,
  });

  if (isPending) {
    return (
      <Page width="wide">
        <ListLoading rows={4} label="Loading your outreach" />
      </Page>
    );
  }

  const rows = apps?.applications ?? [];

  return (
    <Page width="wide">
      <PageHeader
        title="Outreach"
        description="Add a contact you already have. JobPilot does not look people up."
        actions={
          <>
            {/* The sweep produces drafts that land in THIS queue, so the action
                belongs here and not only on the tracker. It was tracker-only at
                first, which put it on a screen the outreach flow never visits. */}
            <FollowUpButton onDone={setSweepNotice} />
            {/* Both live here rather than only in the header: they are outreach
                concerns, and sending settings in particular has to be reachable
                BEFORE there is anything to send — connecting an account is a
                prerequisite, not a follow-up. */}
            <Link
              href="/outreach/settings"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Settings2 className="size-4" aria-hidden="true" />
              Sending settings
            </Link>
            <Link
              href="/opt-out"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <ShieldOff className="size-4" aria-hidden="true" />
              Opt-out list
            </Link>
          </>
        }
      />

      {sweepNotice && (
        <Alert role="status" tone="info" className="mt-6">
          {sweepNotice}
        </Alert>
      )}

      {rows.length === 0 ? (
        <div className="mt-8">
          <ListEmpty
            title="No applications yet"
            detail="Tailor a resume for a job first — outreach is seeded from that tailoring run, so the email can cite real evidence instead of a generic template."
            action={{ label: "Pick a job to tailor", href: "/jobs" }}
          />
          {/* An empty state that only says "nothing here" makes the user guess
              what to do next. Both next steps are one click from here. */}
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Or{" "}
            <Link
              href="/outreach/settings"
              className="font-medium text-link underline decoration-link/40 underline-offset-4 hover:decoration-link"
            >
              connect a sending account
            </Link>{" "}
            while you are here.
          </p>
        </div>
      ) : (
        <ul className="mt-8 space-y-2">
          {rows.map((app) => {
            const expanded = openApp === app.id;
            return (
              <li
                key={app.id}
                className="rounded-lg border border-border bg-card shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{app.jobTitle}</p>
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {app.company}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{app.status.replace("_", " ")}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {app.contactCount} contact{app.contactCount === 1 ? "" : "s"}
                        {app.attemptCount > 0 &&
                          ` · ${app.attemptCount} attempt${app.attemptCount === 1 ? "" : "s"}`}
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      aria-expanded={expanded}
                      onClick={() => setOpenApp(expanded ? null : app.id)}
                    >
                      Contacts
                      <ChevronDown
                        aria-hidden="true"
                        className={cn(
                          "size-4 transition-transform duration-200",
                          expanded && "rotate-180",
                        )}
                      />
                    </Button>
                    {app.contactCount > 0 && (
                      <Link
                        href={`/outreach/${app.id}`}
                        className={buttonVariants({ size: "sm" })}
                      >
                        Write email
                      </Link>
                    )}
                  </div>
                </div>

                {expanded && (
                  <div className="space-y-4 border-t border-border bg-elevated p-4">
                    <ContactList contacts={contacts?.contacts ?? []} />
                    <AddContactForm
                      applicationId={app.id}
                      onDone={() => {
                        void qc.invalidateQueries({ queryKey: ["contacts", app.id] });
                        void qc.invalidateQueries({ queryKey: ["applications"] });
                      }}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}

/**
 * Draft follow-ups for anything sent long enough ago (P6.2).
 *
 * Named for what it can actually do. EC-P6-12: nothing here reads an inbox, so
 * the sweep cannot know whether anyone replied — only whether YOU recorded a
 * reply. And it cannot send: it writes drafts into the same review queue, which
 * traverse the same twelve interlocks as anything else.
 */
function FollowUpButton({ onDone }: { onDone: (message: string) => void }) {
  const qc = useQueryClient();

  const sweep = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/outreach/followups", { method: "POST" });
      return res.json();
    },
    onSuccess: (body) => {
      onDone(body.message ?? body.error ?? "Sweep finished.");
      void qc.invalidateQueries({ queryKey: ["applications"] });
    },
  });

  return (
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
  );
}

/** P5.1.5 — provenance is shown wherever a contact is, not hidden in a detail view. */
function ContactList({ contacts }: { contacts: ContactRow[] }) {
  if (contacts.length === 0) {
    return <p className="text-sm text-muted-foreground">No contacts yet.</p>;
  }
  return (
    <ul className="space-y-2">
      {contacts.map((c) => (
        <li
          key={c.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm"
        >
          <span className="min-w-0">
            {c.recipientName ? `${c.recipientName} · ` : ""}
            <span className="font-mono text-xs">{c.recipientEmailDisplay}</span>
          </span>
          <Badge variant="accent">{SOURCE_LABELS[c.source] ?? c.source}</Badge>
        </li>
      ))}
    </ul>
  );
}

function AddContactForm({
  applicationId,
  onDone,
}: {
  applicationId: string;
  onDone: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId,
          recipientEmail: email,
          recipientName: name || null,
          personalizationNote: note || null,
          source,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not add the contact.");
      return body;
    },
    onSuccess: () => {
      setEmail(""); setName(""); setNote(""); setSource(""); setError(null);
      onDone();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <form
      className="space-y-4 border-t border-border pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" required error={error}>
          {(p) => (
            <Input
              {...p}
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="priya@company.com"
            />
          )}
        </Field>
        <Field label="Name" hint="Optional.">
          {(p) => (
            <Input {...p} type="text" value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
      </div>

      <Field
        label="How did you get this address?"
        required
        hint="Recorded permanently with the contact — this is the provenance every email is checked against."
      >
        {(p) => (
          <Select
            {...p}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            required
          >
            {/* No default. Provenance is a decision, not a form field to skip. */}
            <option value="">Choose one…</option>
            <option value="user_entered">I already had it</option>
            <option value="company_careers_page">Company careers page</option>
            <option value="imported_csv">Imported from a CSV</option>
          </Select>
        )}
      </Field>

      <Field label="Personalization note" hint="Optional — one detail the draft can cite.">
        {(p) => (
          <Input
            {...p}
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Met at PyCon; runs the platform team"
          />
        )}
      </Field>

      <Button type="submit" loading={add.isPending} disabled={!email || !source}>
        {add.isPending ? "Adding…" : "Add contact"}
      </Button>
    </form>
  );
}
