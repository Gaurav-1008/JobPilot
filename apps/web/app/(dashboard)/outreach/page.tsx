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
    return <main className="p-8 text-sm text-muted-foreground">Loading…</main>;
  }

  const rows = apps?.applications ?? [];

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Outreach</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Add a contact you already have. JobPilot does not look people up.
          </p>
        </div>
        {/* Both live here rather than only in the header: they are outreach
            concerns, and sending settings in particular has to be reachable
            BEFORE there is anything to send — connecting an account is a
            prerequisite, not a follow-up. */}
        <div className="flex shrink-0 gap-4 whitespace-nowrap text-sm">
          <Link href="/outreach/settings" className="underline">
            Sending settings
          </Link>
          <Link href="/opt-out" className="underline">
            Opt-out list
          </Link>
        </div>
      </div>

      {rows.length === 0 && (
        <div className="mt-8 rounded border border-border bg-card p-4 text-sm text-muted-foreground">
          <p>
            No applications yet. Tailor a resume for a job first — outreach is
            seeded from that tailoring run, so the email can cite real evidence
            instead of a generic template.
          </p>
          {/* An empty state that only says "nothing here" makes the user guess
              what to do next. Both next steps are one click from here. */}
          <p className="mt-3">
            <Link href="/jobs" className="underline">
              Pick a job to tailor
            </Link>
            {" · or "}
            <Link href="/outreach/settings" className="underline">
              connect a sending account
            </Link>{" "}
            while you are here.
          </p>
        </div>
      )}

      <ul className="mt-8 space-y-3">
        {rows.map((app) => (
          <li key={app.id} className="rounded border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium">{app.jobTitle}</p>
                <p className="text-sm text-muted-foreground">{app.company}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {app.contactCount} contact{app.contactCount === 1 ? "" : "s"}
                  {app.attemptCount > 0 && ` · ${app.attemptCount} attempt${app.attemptCount === 1 ? "" : "s"}`}
                  {` · ${app.status}`}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => setOpenApp(openApp === app.id ? null : app.id)}
                  className="rounded border px-3 py-1 text-sm"
                >
                  {openApp === app.id ? "Close" : "Contacts"}
                </button>
                {app.contactCount > 0 && (
                  <Link
                    href={`/outreach/${app.id}`}
                    className="rounded bg-black px-3 py-1 text-sm text-white"
                  >
                    Write email
                  </Link>
                )}
              </div>
            </div>

            {openApp === app.id && (
              <div className="mt-4 border-t border-border pt-4">
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
        ))}
      </ul>
    </main>
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
        <li key={c.id} className="flex items-center justify-between gap-3 text-sm">
          <span>
            {c.recipientName ? `${c.recipientName} · ` : ""}
            <span className="font-mono text-xs">{c.recipientEmailDisplay}</span>
          </span>
          <span className="shrink-0 rounded bg-accent px-2 py-0.5 text-xs text-accent-foreground">
            {SOURCE_LABELS[c.source] ?? c.source}
          </span>
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
      className="mt-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-muted-foreground">Email</span>
          <input
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="priya@company.com"
            className="mt-1 w-full rounded border px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">Name (optional)</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2 text-sm"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-xs text-muted-foreground">
          How did you get this address?
        </span>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          required
          className="mt-1 w-full rounded border px-3 py-2 text-sm"
        >
          {/* No default. Provenance is a decision, not a form field to skip. */}
          <option value="">Choose one…</option>
          <option value="user_entered">I already had it</option>
          <option value="company_careers_page">Company careers page</option>
          <option value="imported_csv">Imported from a CSV</option>
        </select>
      </label>

      <label className="block">
        <span className="text-xs text-muted-foreground">
          Personalization note (optional)
        </span>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Met at PyCon; runs the platform team"
          className="mt-1 w-full rounded border px-3 py-2 text-sm"
        />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={add.isPending || !email || !source}
        className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {add.isPending ? "Adding…" : "Add contact"}
      </button>
    </form>
  );
}
