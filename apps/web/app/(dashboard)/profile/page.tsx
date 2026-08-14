"use client";

import { useEffect, useState } from "react";

interface Profile {
  email: string;
  candidateName: string | null;
  candidateBackground: string | null;
  portfolioUrl: string | null;
  linkedinUrl: string | null;
  dryRun: boolean;
  sendMode: string;
  maxOutreachPerDay: number;
}

export default function ProfilePage() {
  const [p, setP] = useState<Profile | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/profile").then((r) => r.json()).then(setP).catch(() => {});
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!p) return;
    setStatus("Saving…");
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidateName: p.candidateName || null,
        candidateBackground: p.candidateBackground || null,
        portfolioUrl: p.portfolioUrl || null,
        linkedinUrl: p.linkedinUrl || null,
      }),
    });
    setStatus(res.ok ? "Saved." : "Could not save.");
  }

  // The heading lives OUTSIDE the loading branch. An early return that hides it
  // leaves the page with no landmark until data arrives — the other dashboard
  // pages get this right, and inconsistent structure is worse than either.
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Profile</h1>
      {!p ? (
        <p className="mt-4 text-sm text-neutral-500">Loading…</p>
      ) : (
      <>
      <p className="mt-1 text-sm text-neutral-600">
        Signed in as {p.email}. These details go into every outreach email, so
        they live here once rather than on every contact.
      </p>

      <form onSubmit={save} className="mt-8 space-y-4">
        {([
          ["candidateName", "Your name", "text"],
          ["portfolioUrl", "Portfolio URL", "url"],
          ["linkedinUrl", "LinkedIn URL", "url"],
        ] as const).map(([key, label, type]) => (
          <label key={key} className="block">
            <span className="text-sm">{label}</span>
            <input
              type={type} value={p[key] ?? ""}
              onChange={(e) => setP({ ...p, [key]: e.target.value })}
              className="mt-1 w-full rounded border px-3 py-2"
            />
          </label>
        ))}
        {/* This field is not a bio. It is interpolated into ONE sentence of
            every outreach email, and a pasted résumé summary produces both a
            broken sentence and a body far over the 150-word limit — which the
            interlock chain then refuses to send, with the failure only visible
            after approval. Saying what it is for costs one line here and saves
            that entire loop. */}
        <label className="block">
          <span className="text-sm">Background</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            A short phrase, not a bio — it is dropped into the sentence “I’m{" "}
            {p.candidateName?.trim() || "NAME"}, with a background in …” in
            every email you send. Something like “backend systems and retrieval
            pipelines” reads well; a pasted résumé summary does not.
          </span>
          <textarea
            rows={2}
            maxLength={200}
            placeholder="backend systems and retrieval pipelines"
            value={p.candidateBackground ?? ""}
            onChange={(e) => setP({ ...p, candidateBackground: e.target.value })}
            className="mt-2 w-full rounded border px-3 py-2"
          />
          <span
            className={`mt-1 block text-xs ${
              (p.candidateBackground ?? "").length > 160
                ? "text-amber-600"
                : "text-muted-foreground"
            }`}
          >
            {(p.candidateBackground ?? "").length}/200 characters
          </span>
        </label>
        <div className="flex items-center gap-3">
          <button type="submit" className="rounded bg-black px-4 py-2 text-white">Save</button>
          {status && <span role="status" className="text-sm text-neutral-600">{status}</span>}
        </div>
      </form>

      {/* P1.1.5 — read-only. EC-P1-07: the server refuses to write these too,
          because "read-only in the UI" means nothing on its own. They become
          editable in P5.5.10, once the interlocks that depend on them exist. */}
      <section className="mt-12 rounded border border-neutral-200 p-5">
        <h2 className="text-lg font-medium">Outreach safety</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Read-only until outreach ships. Shown now so the defaults are visible
          rather than a surprise later.
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-neutral-500">Dry run</dt>
          <dd>{p.dryRun ? "On — nothing is sent" : "Off"}</dd>
          <dt className="text-neutral-500">Send mode</dt>
          <dd>{p.sendMode}</dd>
          <dt className="text-neutral-500">Daily cap</dt>
          <dd>{p.maxOutreachPerDay} emails / 24h</dd>
        </dl>
      </section>
      </>
      )}
    </main>
  );
}
