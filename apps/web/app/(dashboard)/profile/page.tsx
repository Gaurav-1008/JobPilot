"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ListLoading } from "@/components/ui/list-state";
import { Page, PageHeader } from "@/components/ui/page";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

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

const BACKGROUND_MAX = 200;

export default function ProfilePage() {
  const [p, setP] = useState<Profile | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/profile").then((r) => r.json()).then(setP).catch(() => {});
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!p) return;
    setSaving(true);
    setStatus(null);
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
    setSaving(false);
    setStatus(res.ok ? "Saved." : "Could not save.");
  }

  const background = p?.candidateBackground ?? "";
  const nearLimit = background.length > BACKGROUND_MAX * 0.8;

  // The heading lives OUTSIDE the loading branch. An early return that hides it
  // leaves the page with no landmark until data arrives — the other dashboard
  // pages get this right, and inconsistent structure is worse than either.
  return (
    <Page width="narrow">
      <PageHeader
        title="Profile"
        description={
          p
            ? `Signed in as ${p.email}. These details go into every outreach email, so they live here once rather than on every contact.`
            : undefined
        }
      />

      {!p ? (
        <ListLoading rows={3} label="Loading your profile" className="mt-8" />
      ) : (
        <>
          <form onSubmit={save} className="mt-8 space-y-5">
            {([
              ["candidateName", "Your name", "text", undefined],
              ["portfolioUrl", "Portfolio URL", "url", "https://…"],
              ["linkedinUrl", "LinkedIn URL", "url", "https://linkedin.com/in/…"],
            ] as const).map(([key, label, type, placeholder]) => (
              <Field key={key} label={label}>
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    type={type}
                    placeholder={placeholder}
                    value={p[key] ?? ""}
                    onChange={(e) => setP({ ...p, [key]: e.target.value })}
                  />
                )}
              </Field>
            ))}

            {/* This field is not a bio. It is interpolated into ONE sentence of
                every outreach email, and a pasted résumé summary produces both a
                broken sentence and a body far over the 150-word limit — which the
                interlock chain then refuses to send, with the failure only visible
                after approval. Saying what it is for costs one line here and saves
                that entire loop. */}
            <Field
              label="Background"
              hint={
                <>
                  A short phrase, not a bio — it is dropped into the sentence “I’m{" "}
                  {p.candidateName?.trim() || "NAME"}, with a background in …” in
                  every email you send. Something like “backend systems and
                  retrieval pipelines” reads well; a pasted résumé summary does
                  not.
                </>
              }
            >
              {(fieldProps) => (
                <>
                  <Textarea
                    {...fieldProps}
                    rows={2}
                    maxLength={BACKGROUND_MAX}
                    className="min-h-20"
                    placeholder="backend systems and retrieval pipelines"
                    value={background}
                    onChange={(e) => setP({ ...p, candidateBackground: e.target.value })}
                  />
                  {/*
                   * The counter warns before the limit, not at it. `maxLength`
                   * silently stops accepting keystrokes at 200 — without a
                   * visible approach to the ceiling, that reads as the keyboard
                   * having stopped working.
                   */}
                  <p
                    aria-live="polite"
                    className={cn(
                      "text-right text-xs tabular-nums",
                      nearLimit ? "font-medium text-warning" : "text-muted-foreground",
                    )}
                  >
                    {background.length}/{BACKGROUND_MAX} characters
                  </p>
                </>
              )}
            </Field>

            <div className="flex items-center gap-3">
              <Button type="submit" loading={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              {status && (
                <span
                  role="status"
                  className={cn(
                    "text-sm font-medium",
                    status === "Saved." ? "text-success" : "text-danger",
                  )}
                >
                  {status}
                </span>
              )}
            </div>
          </form>

          {/* P1.1.5 — read-only. EC-P1-07: the server refuses to write these too,
              because "read-only in the UI" means nothing on its own. They become
              editable in P5.5.10, once the interlocks that depend on them exist. */}
          <Card className="mt-12">
            <CardHeader>
              <CardTitle>Outreach safety</CardTitle>
              <CardDescription>
                Read-only until outreach ships. Shown now so the defaults are
                visible rather than a surprise later.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-border text-sm">
                {[
                  ["Dry run", p.dryRun ? "On — nothing is sent" : "Off"],
                  ["Send mode", p.sendMode],
                  ["Daily cap", `${p.maxOutreachPerDay} emails / 24h`],
                ].map(([term, value]) => (
                  <div key={term} className="flex justify-between gap-4 py-2 first:pt-0 last:pb-0">
                    <dt className="text-muted-foreground">{term}</dt>
                    <dd className="text-right font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          {p.dryRun && (
            <Alert tone="info" className="mt-4">
              Dry run is on, so nothing you approve will actually be sent. Turn
              it off in <Link href="/outreach/settings">sending settings</Link>{" "}
              once a sending account passes its connection check.
            </Alert>
          )}
        </>
      )}
    </Page>
  );
}
