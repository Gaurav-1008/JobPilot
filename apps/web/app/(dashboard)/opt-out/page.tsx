"use client";

/**
 * Opt-out list (P5.1.4).
 *
 * Kept as its own screen rather than a settings sub-tab: when someone replies
 * "stop emailing me", the time between reading that and recording it should be
 * as short as possible. Anything buried costs a second unwanted email.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldOff, X } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ListLoading } from "@/components/ui/list-state";
import { Page, PageHeader, Section } from "@/components/ui/page";

interface OptOutRow {
  email: string;
  emailDisplay: string;
  isDomain: boolean;
  reason: string | null;
  createdAt: string;
}

export default function OptOutPage() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isPending } = useQuery<{ entries: OptOutRow[] }>({
    queryKey: ["optout"],
    queryFn: async () => (await fetch("/api/optout")).json(),
  });

  const add = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/optout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, reason: reason || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not add that entry.");
    },
    onSuccess: () => {
      setEmail(""); setReason(""); setError(null);
      void qc.invalidateQueries({ queryKey: ["optout"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const remove = useMutation({
    mutationFn: async (entry: string) => {
      await fetch(`/api/optout?email=${encodeURIComponent(entry)}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["optout"] }),
  });

  const entries = data?.entries ?? [];

  return (
    <Page width="narrow">
      <PageHeader
        back={{ href: "/outreach", label: "Outreach" }}
        title="Opt-out list"
        description="Nobody on this list can be emailed. It is checked at send time, so adding someone here blocks contacts that already exist."
      />

      <form
        className="mt-8 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Field
          label="Email address"
          required
          hint="Or a whole domain, written as @company.com."
          error={error}
        >
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

        <Field label="Reason" hint="Optional — kept for your own record only.">
          {(p) => (
            <Input
              {...p}
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Asked not to be contacted"
            />
          )}
        </Field>

        <Button type="submit" loading={add.isPending} disabled={!email}>
          {!add.isPending && <ShieldOff className="size-4" aria-hidden="true" />}
          {add.isPending ? "Adding…" : "Add to opt-out list"}
        </Button>
      </form>

      <Section title={`Suppressed (${entries.length})`} className="mt-10">
        {isPending ? (
          <ListLoading rows={2} label="Loading the opt-out list" />
        ) : entries.length === 0 ? (
          <Alert tone="neutral">
            Nothing suppressed yet. Anyone added here is blocked at send time,
            permanently, across every application.
          </Alert>
        ) : (
          <ul className="space-y-2">
            {entries.map((entry) => (
              <li
                key={entry.email}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 shadow-sm"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{entry.emailDisplay}</span>
                    {entry.isDomain && <Badge variant="warning">whole domain</Badge>}
                  </div>
                  {entry.reason && (
                    <p className="text-xs text-muted-foreground">{entry.reason}</p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove.mutate(entry.email)}
                  aria-label={`Remove ${entry.emailDisplay} from the opt-out list`}
                >
                  <X className="size-4" aria-hidden="true" />
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Page>
  );
}
