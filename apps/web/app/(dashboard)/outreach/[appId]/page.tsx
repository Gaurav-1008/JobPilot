"use client";

/**
 * Outreach review screen (P5.3.4, P5.3.5, P5.3.6, P5.3.7).
 *
 * This screen replaces The Closer's `preview.py` terminal render and its
 * `input()` confirmation. The visual part is a port; the confirmation is not —
 * a terminal `y/N` is a promise the program makes to itself, while approval
 * here mints a single-use token bound to a hash of the exact body, which the
 * server checks again at delivery (§14.1, "the structural upgrade").
 *
 * The evidence panel is the reason this screen exists rather than a mail
 * client. Every hook in the draft traces to a persisted tailoring artifact, and
 * the user can see which one — that is FR7's claim made inspectable instead of
 * asserted.
 */

import { use, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Finding {
  check: string;
  severity: "block" | "flag";
  message: string;
  evidence?: string;
}

interface Payload {
  topMatchedSkills: string[];
  strongestBullet: string | null;
  jdHooks: string[];
  matchScore: number;
  honestGaps: string[];
}

interface ContactRow {
  id: string;
  recipientEmailDisplay: string;
  recipientName: string | null;
  source: string;
}

interface Draft {
  id: string;
  status: string;
  subject: string;
  body: string;
  wordCount: number;
  wordLimit: number;
  generationSource: string;
  contact: { id: string; email: string; name: string | null; source: string };
  job: { title: string; company: string };
  payload: Payload | null;
  findings: Finding[];
  providerAttemptedAt: string | null;
  errorMessage: string | null;
  platformDryRunReason: string | null;
}

export default function ReviewPage({
  params,
}: {
  params: Promise<{ appId: string }>;
}) {
  const { appId } = use(params);
  const qc = useQueryClient();

  const [attemptId, setAttemptId] = useState<string | null>(null);
  /**
   * Unsaved edits, tagged with the attempt they belong to.
   *
   * Deliberately NOT synced from the query with an effect: the server's copy is
   * the source of truth, and copying it into state on every refetch would let a
   * background refetch silently overwrite what the user is typing. Tagging by
   * attempt id means edits fall away on their own when the draft changes.
   */
  const [edits, setEdits] = useState<
    { attemptId: string; body: string; subject: string } | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<"info" | "success" | "danger">("info");
  const [approved, setApproved] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [subjectOptions, setSubjectOptions] = useState<string[]>([]);

  const { data: contactsData } = useQuery<{ contacts: ContactRow[] }>({
    queryKey: ["contacts", appId],
    queryFn: async () =>
      (await fetch(`/api/contacts?applicationId=${appId}`)).json(),
  });

  const { data: draft } = useQuery<Draft>({
    queryKey: ["attempt", attemptId],
    queryFn: async () => (await fetch(`/api/outreach/${attemptId}`)).json(),
    enabled: attemptId !== null,
  });

  // Derived, not stored: the edit buffer wins only while it matches the draft
  // on screen. No effect, so no render cascade and no lost keystrokes.
  const live = edits?.attemptId === draft?.id ? edits : null;
  const body = live?.body ?? draft?.body ?? "";
  const subject = live?.subject ?? draft?.subject ?? "";
  const dirty =
    draft !== undefined &&
    live !== null &&
    (live.body !== draft.body || live.subject !== draft.subject);

  const edit = (patch: { body?: string; subject?: string }) => {
    if (!draft) return;
    setEdits({ attemptId: draft.id, body, subject, ...patch });
  };

  function say(message: string, tone: "info" | "success" | "danger" = "info") {
    setNotice(message);
    setNoticeTone(tone);
  }

  async function generate(contactId: string) {
    setBusy(true); setNotice(null); setApproved(false);
    const res = await fetch("/api/outreach/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      say(data.error ?? "Could not generate a draft.", "danger");
      return;
    }
    setAttemptId(data.attemptId);
    setEdits(null);
    setSubjectOptions(data.subjectOptions ?? []);
    if (data.fellBackToTemplate) {
      say(
        "The written draft could not be verified against your resume, so the plain template was used instead.",
      );
    }
  }

  async function save() {
    if (!attemptId) return;
    setBusy(true); setNotice(null);
    const res = await fetch(`/api/outreach/${attemptId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, subject }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { say(data.error ?? "Could not save.", "danger"); return; }

    // The server destroyed the approval row on edit; drop the local token too,
    // so the UI cannot offer a Send that the interlocks would only reject.
    setApproved(false);
    setToken(null);
    setEdits(null);
    say("Saved. Because the text changed, approve it again before sending.");
    void qc.invalidateQueries({ queryKey: ["attempt", attemptId] });
  }

  async function approve() {
    if (!attemptId) return;
    setBusy(true); setNotice(null);
    const res = await fetch(`/api/outreach/${attemptId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, body }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { say(data.error ?? "Could not approve.", "danger"); return; }
    // The token is a capability held only by this tab, for one send. It is
    // deliberately NOT persisted: a token in localStorage would survive a
    // reload and quietly turn "approved a minute ago" into "approved whenever".
    setToken(data.token);
    setApproved(true);
    say(
      `Approved. This expires in ${data.expiresInMinutes ?? 10} minutes — send it before then.`,
      "success",
    );
  }

  async function deliver() {
    if (!attemptId || !token) return;
    setBusy(true); setNotice(null);
    const res = await fetch(`/api/outreach/${attemptId}/deliver`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    // Single-use either way: the server burned it on success, and on a block
    // the token may or may not have survived. Re-approving is the only safe
    // path, and it costs the user one click.
    setApproved(false);
    setToken(null);
    if (!res.ok) {
      say(
        data.error ??
          "Blocked. Check the outreach log for which safeguard stopped it.",
        "danger",
      );
    } else {
      say(data.message ?? `Done — status: ${data.status}.`, "success");
    }
    void qc.invalidateQueries({ queryKey: ["attempt", attemptId] });
  }

  async function skip() {
    if (!attemptId) return;
    setBusy(true);
    await fetch(`/api/outreach/${attemptId}/skip`, { method: "POST" });
    setBusy(false);
    setAttemptId(null);
    say("Skipped. It stays in your log, and you can write another later.");
  }

  const contacts = contactsData?.contacts ?? [];
  const blocking = (draft?.findings ?? []).filter((f) => f.severity === "block");
  const flags = (draft?.findings ?? []).filter((f) => f.severity === "flag");

  /**
   * Over the word limit means the send is IMPOSSIBLE, not merely inadvisable.
   *
   * Grounding reports word count as a soft flag, which put it under "Worth
   * checking" — but interlock check 8 refuses outright at delivery. So the
   * screen invited approval of something the server would never send, and the
   * only feedback was a `failed` row after the fact. Approving three times and
   * finding nothing in your mailbox is the exact experience that produces.
   *
   * The block is surfaced here instead, and Approve is disabled until the text
   * fits. Editing stays available, because shortening the body is the fix.
   */
  const overLimit = draft !== undefined && draft.wordCount > draft.wordLimit;

  return (
    <Page width="content">
      <PageHeader
        back={{ href: "/outreach", label: "All outreach" }}
        title="Write an email"
        description={draft ? `${draft.job.title} · ${draft.job.company}` : undefined}
      />

      {/* ── Pick a recipient ─────────────────────────────────────────── */}
      {!attemptId && (
        <Section title="Who are you writing to?" className="mt-8">
          {contacts.length === 0 ? (
            <Alert tone="neutral">
              No contacts on this application yet.{" "}
              <Link href="/outreach">Add one from the outreach list</Link> first.
            </Alert>
          ) : (
            <ul className="space-y-2">
              {contacts.map((c) => (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-3 shadow-sm"
                >
                  <span className="min-w-0 text-sm">
                    {c.recipientName ? `${c.recipientName} · ` : ""}
                    <span className="font-mono text-xs">
                      {c.recipientEmailDisplay}
                    </span>
                  </span>
                  <Button size="sm" onClick={() => generate(c.id)} loading={busy}>
                    {busy ? "Writing…" : "Write draft"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {notice && (
        <Alert role="status" tone={noticeTone} className="mt-6">
          {notice}
        </Alert>
      )}

      {draft && (
        <>
          {/*
           * ══════════════════════════════════════════════════════════════
           * EC-P7-07 / P7.1.7 — THE WARNINGS ARE PART OF THE SAFETY GATE.
           *
           * This screen is the human gate (§14.1). If the approve control is
           * reachable but the warnings are not perceivable, then for that user
           * the gate does not exist — it is decorative, and they are approving
           * an email whose problems the system found and did not tell them
           * about. That is the same class of failure as EC-P5-56, arrived at
           * from a different direction, which is why an accessibility item sits
           * in a "polish" phase.
           *
           * Three properties, all required together:
           *
           *   1. DOM ORDER. Every warning precedes the approve control, so a
           *      screen reader and a keyboard user reach the risk before the
           *      action. This is the ordering property — it cannot be recovered
           *      with CSS, because CSS does not move the focus order.
           *   2. role="alert". Findings arrive asynchronously, after generation
           *      returns. Without a live region, content that appears after
           *      page load is silent: a sighted user sees a red panel appear,
           *      and a screen-reader user gets nothing at all. `alert` is the
           *      assertive role, correct here precisely because it interrupts —
           *      this gates a decision the user is in the middle of making.
           *   3. aria-describedby. Reaching Approve by keyboard announces the
           *      warnings as part of the control's description, so the risk is
           *      restated at the moment of the decision rather than only when
           *      it first appeared.
           *
           * THE REDESIGN DOES NOT RELAX ANY OF THIS. These were previously
           * hand-built panels using `bg-red-50 text-red-900`, which on a dark
           * theme rendered the gate's own text at roughly 1.1:1 against its
           * container — perceivable in exactly the sense that matters least.
           * The tone tokens fix the contrast; the roles and ids below are
           * carried over unchanged.
           * ══════════════════════════════════════════════════════════════
           */}

          <div className="mt-6 space-y-4">
            {/* EC-P7-23 — the platform overrides the user's send setting, and
                this is where that has to be said: before the work, not after. */}
            {draft.platformDryRunReason && (
              <Alert role="status" tone="info">
                {draft.platformDryRunReason}
              </Alert>
            )}

            {/* ── Guardrail findings ───────────────────────────────────── */}
            {overLimit && (
              <Alert
                id="warn-length"
                role="alert"
                tone="danger"
                title={`Too long to send — ${draft.wordCount} words, limit ${draft.wordLimit}`}
              >
                <p>
                  This will be refused at send time, so approving it cannot help.
                  Shorten the body below and save, and the limit check clears.
                </p>
                <p className="text-xs">
                  Long emails usually mean the background on your{" "}
                  <Link href="/profile">profile</Link> is a full bio. It gets
                  dropped into one sentence — “I’m NAME, with a background in …”
                  — so a short phrase works far better than a paragraph.
                </p>
              </Alert>
            )}

            {blocking.length > 0 && (
              <Alert
                id="warn-grounding"
                role="alert"
                tone="danger"
                title="These claims are not supported by your resume"
              >
                <ul className="space-y-1">
                  {blocking.map((f, i) => (
                    <li key={i}>
                      {f.message}
                      {f.evidence && (
                        <span className="ml-1 font-mono text-xs">({f.evidence})</span>
                      )}
                    </li>
                  ))}
                </ul>
                {/* EC-P5-37: after an edit these are warnings, not a gate. The
                    user is the author of their own words — but they are told. */}
                <p className="text-xs">
                  You can still send this. These are your words, and the decision
                  is yours — but nothing here backs them up.
                </p>
              </Alert>
            )}

            {flags.length > 0 && (
              /* role="status", not "alert": these are advisory, and an assertive
                 region for every soft flag would train the user to ignore the
                 region that carries the blocking ones. */
              <Alert
                id="warn-flags"
                role="status"
                tone="warning"
                title="Worth checking"
              >
                <ul className="space-y-1">
                  {flags.map((f, i) => (
                    <li key={i}>{f.message}</li>
                  ))}
                </ul>
              </Alert>
            )}

            {/* EC-P5-59: the audit trail can under-report in exactly one
                direction, and this is where the user finds out. */}
            {draft.status === "failed" && draft.providerAttemptedAt && (
              <Alert tone="warning">
                This attempt reached the provider before it failed, so a draft
                may have been created anyway. Check your mailbox before
                retrying.
              </Alert>
            )}
          </div>

          {/* ── The draft ────────────────────────────────────────────── */}
          <section className="mt-8">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                To {draft.contact.name ?? draft.contact.email}
              </h2>
              <span
                className={cn(
                  "text-xs tabular-nums",
                  overLimit ? "font-medium text-danger" : "text-muted-foreground",
                )}
              >
                {draft.wordCount}/{draft.wordLimit} words ·{" "}
                {draft.generationSource === "llm" ? "written" : "template"}
              </span>
            </div>

            {subjectOptions.length > 1 && (
              <fieldset className="mt-4">
                <legend className="text-sm font-medium">Subject options</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {subjectOptions.map((option) => {
                    const active = subject === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={active}
                        onClick={() => edit({ subject: option })}
                        className={cn(
                          "min-h-9 cursor-pointer rounded-md border px-3 text-xs transition-colors duration-150",
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border-strong bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}

            <div className="mt-4 space-y-4">
              <Field label="Subject">
                {(p) => (
                  <Input
                    {...p}
                    value={subject}
                    onChange={(e) => edit({ subject: e.target.value })}
                  />
                )}
              </Field>

              <Field label="Body">
                {(p) => (
                  <Textarea
                    {...p}
                    rows={14}
                    value={body}
                    onChange={(e) => edit({ body: e.target.value })}
                    className="min-h-72 font-mono text-xs"
                  />
                )}
              </Field>
            </div>

            {/*
             * EC-P7-08 — RISK MUST BE VISIBLE WITHOUT SCROLLING, AT THE ACTION.
             *
             * The warning panels above are correct in DOM order, but on a phone
             * a 14-row textarea sits between them and this button row, so by the
             * time Approve is on screen the reasons not to press it are not.
             * Ordering alone solves the screen-reader case and not the visual
             * one.
             *
             * This restates the count immediately above the controls — it always
             * travels with them — and links back to the detail rather than
             * duplicating it, so there is still one place where the findings are
             * written down.
             */}
            {(blocking.length > 0 || flags.length > 0 || overLimit) && (
              <Alert tone="warning" className="mt-4 p-3 text-xs">
                <a href="#warn-grounding" className="font-medium underline">
                  {overLimit && "Too long to send"}
                  {overLimit && (blocking.length > 0 || flags.length > 0) && " · "}
                  {blocking.length > 0 &&
                    `${blocking.length} unsupported claim${blocking.length === 1 ? "" : "s"}`}
                  {blocking.length > 0 && flags.length > 0 && " · "}
                  {flags.length > 0 &&
                    `${flags.length} thing${flags.length === 1 ? "" : "s"} worth checking`}
                </a>{" "}
                — details above.
              </Alert>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={save} disabled={busy || !dirty}>
                Save changes
              </Button>
              <Button
                variant="outline"
                onClick={approve}
                disabled={busy || dirty || approved || overLimit}
                /*
                 * EC-P7-07 — the warnings are announced as this control's
                 * description, so tabbing to Approve restates the risk at the
                 * moment of the decision. Ids of absent panels are ignored by
                 * assistive technology, so this needs no conditional logic.
                 */
                aria-describedby="warn-length warn-grounding warn-flags approve-hint"
              >
                {approved ? "Approved" : "Approve"}
              </Button>
              <Button onClick={deliver} disabled={busy || !approved}>
                Send
              </Button>
              <Button
                variant="ghost"
                onClick={skip}
                disabled={busy}
                className="ml-auto"
              >
                Skip this one
              </Button>
            </div>

            {/*
             * Why Approve is unavailable, in text rather than only in an
             * opacity change. A disabled control with no stated reason is the
             * accessibility failure that also frustrates everyone else — the
             * user cannot tell "not yet" from "broken".
             */}
            <p id="approve-hint" className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {dirty
                ? "Save your changes before approving — approval is bound to the exact text."
                : overLimit
                  ? "Approving is unavailable until the email is under the word limit."
                  : approved
                    ? "Approved. Send it before the approval expires."
                    : "Approval is bound to the exact text shown above."}
            </p>
          </section>

          <EvidencePanel payload={draft.payload} />
        </>
      )}
    </Page>
  );
}

/**
 * P5.3.5 — which tailoring output produced each hook.
 *
 * EC-P5-40: a null payload renders an explanation, not an empty box. "There is
 * no evidence behind this email" is information the user needs before sending.
 */
function EvidencePanel({ payload }: { payload: Payload | null }) {
  if (!payload) {
    return (
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Evidence</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-muted-foreground">
            No tailoring evidence — this is a generic template email. Tailor your
            resume for this job first if you want the draft to cite specifics.
          </p>
        </CardContent>
      </Card>
    );
  }

  const ITEMS: [string, React.ReactNode][] = [
    [
      "Skills this role asks for that your resume backs up",
      payload.topMatchedSkills.length > 0
        ? payload.topMatchedSkills.join(", ")
        : "None found — that is why the hook is generic.",
    ],
    ...(payload.strongestBullet
      ? ([["Strongest accomplishment cited", <em key="b">{payload.strongestBullet}</em>]] as [
          string,
          React.ReactNode,
        ][])
      : []),
    ...(payload.jdHooks.length > 0
      ? ([["What the job description emphasises", payload.jdHooks.join(" · ")]] as [
          string,
          React.ReactNode,
        ][])
      : []),
    ["Match score", `${payload.matchScore}/100`],
    // EC-P5-24: gaps are a suppression list. Shown here so the user knows they
    // were withheld — never written into the body.
    ...(payload.honestGaps.length > 0
      ? ([
          [
            "Deliberately not claimed",
            `${payload.honestGaps.join(", ")} — kept out of the email on purpose.`,
          ],
        ] as [string, React.ReactNode][])
      : []),
  ];

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle>Evidence behind this email</CardTitle>
        <CardDescription>
          Every item here comes from your saved tailoring run. Nothing was
          invented for the email.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="divide-y divide-border text-sm">
          {ITEMS.map(([term, value]) => (
            <div key={term} className="py-3 first:pt-0 last:pb-0">
              <dt className="text-xs text-muted-foreground">{term}</dt>
              <dd className="mt-1 leading-relaxed">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
