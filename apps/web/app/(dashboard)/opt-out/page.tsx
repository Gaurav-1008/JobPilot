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
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Opt-out list</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Nobody on this list can be emailed. It is checked at send time, so
        adding someone here blocks contacts that already exist.
      </p>

      <form
        className="mt-6 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <label className="block">
          <span className="text-xs text-muted-foreground">
            Email address, or a whole domain as @company.com
          </span>
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
          <span className="text-xs text-muted-foreground">Reason (optional)</span>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Asked not to be contacted"
            className="mt-1 w-full rounded border px-3 py-2 text-sm"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={add.isPending || !email}
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {add.isPending ? "Adding…" : "Add to opt-out list"}
        </button>
      </form>

      <section className="mt-10">
        <h2 className="text-sm font-medium text-muted-foreground">
          Suppressed ({entries.length})
        </h2>
        {isPending && <p className="mt-2 text-sm text-muted-foreground">Loading…</p>}
        {!isPending && entries.length === 0 && (
          <p className="mt-2 text-sm text-muted-foreground">Nothing suppressed yet.</p>
        )}
        <ul className="mt-3 space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.email}
              className="flex items-center justify-between gap-3 rounded border border-border bg-card px-3 py-2 text-sm"
            >
              <span>
                <span className="font-mono text-xs">{entry.emailDisplay}</span>
                {entry.isDomain && (
                  <span className="ml-2 rounded bg-accent px-2 py-0.5 text-xs text-accent-foreground">
                    whole domain
                  </span>
                )}
                {entry.reason && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {entry.reason}
                  </span>
                )}
              </span>
              <button
                onClick={() => remove.mutate(entry.email)}
                className="shrink-0 text-xs underline text-muted-foreground"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
