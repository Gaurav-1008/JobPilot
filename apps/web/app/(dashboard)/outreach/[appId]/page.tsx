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
      setNotice(data.error ?? "Could not generate a draft.");
      return;
    }
    setAttemptId(data.attemptId);
    setEdits(null);
    setSubjectOptions(data.subjectOptions ?? []);
    if (data.fellBackToTemplate) {
      setNotice(
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
    if (!res.ok) { setNotice(data.error ?? "Could not save."); return; }

    // The server destroyed the approval row on edit; drop the local token too,
    // so the UI cannot offer a Send that the interlocks would only reject.
    setApproved(false);
    setToken(null);
    setEdits(null);
    setNotice("Saved. Because the text changed, approve it again before sending.");
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
    if (!res.ok) { setNotice(data.error ?? "Could not approve."); return; }
    // The token is a capability held only by this tab, for one send. It is
    // deliberately NOT persisted: a token in localStorage would survive a
    // reload and quietly turn "approved a minute ago" into "approved whenever".
    setToken(data.token);
    setApproved(true);
    setNotice(
      `Approved. This expires in ${data.expiresInMinutes ?? 10} minutes — send it before then.`,
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
      setNotice(
        data.error ??
          "Blocked. Check the outreach log for which safeguard stopped it.",
      );
    } else {
      setNotice(data.message ?? `Done — status: ${data.status}.`);
    }
    void qc.invalidateQueries({ queryKey: ["attempt", attemptId] });
  }

  async function skip() {
    if (!attemptId) return;
    setBusy(true);
    await fetch(`/api/outreach/${attemptId}/skip`, { method: "POST" });
    setBusy(false);
    setAttemptId(null);
    setNotice("Skipped. It stays in your log, and you can write another later.");
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
  const overLimit =
    draft !== undefined && draft.wordCount > draft.wordLimit;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/outreach" className="text-sm underline text-muted-foreground">
        ← All outreach
      </Link>

      <h1 className="mt-4 text-2xl font-semibold">Write an email</h1>
      {draft && (
        <p className="mt-1 text-sm text-muted-foreground">
          {draft.job.title} · {draft.job.company}
        </p>
      )}

      {/* ── Pick a recipient ─────────────────────────────────────────── */}
      {!attemptId && (
        <section className="mt-8">
          <h2 className="text-sm font-medium text-muted-foreground">
            Who are you writing to?
          </h2>
          {contacts.length === 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              No contacts on this application yet. Add one from the outreach
              list first.
            </p>
          )}
          <ul className="mt-3 space-y-2">
            {contacts.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 rounded border border-border bg-card px-3 py-2"
              >
                <span className="text-sm">
                  {c.recipientName ? `${c.recipientName} · ` : ""}
                  <span className="font-mono text-xs">
                    {c.recipientEmailDisplay}
                  </span>
                </span>
                <button
                  onClick={() => generate(c.id)}
                  disabled={busy}
                  className="shrink-0 rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-50"
                >
                  {busy ? "Writing…" : "Write draft"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {notice && (
        <p
          role="status"
          className="mt-6 rounded border border-border bg-card p-3 text-sm"
        >
          {notice}
        </p>
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
           * ══════════════════════════════════════════════════════════════
           */}

          {/* EC-P7-23 — the platform overrides the user's send setting, and
              this is where that has to be said: before the work, not after. */}
          {draft.platformDryRunReason && (
            <section
              role="status"
              className="mt-6 rounded border border-sky-300 bg-sky-50 p-4 text-sm text-sky-900"
            >
              {draft.platformDryRunReason}
            </section>
          )}

          {/* ── Guardrail findings ───────────────────────────────────── */}
          {overLimit && (
            <section
              id="warn-length"
              role="alert"
              className="mt-6 rounded border border-red-300 bg-red-50 p-4"
            >
              <h2 className="text-sm font-medium text-red-900">
                Too long to send — {draft.wordCount} words, limit {draft.wordLimit}
              </h2>
              <p className="mt-2 text-sm text-red-900">
                This will be refused at send time, so approving it cannot help.
                Shorten the body below and save, and the limit check clears.
              </p>
              <p className="mt-2 text-xs text-red-800">
                Long emails usually mean the background on your{" "}
                <Link href="/profile" className="underline">
                  profile
                </Link>{" "}
                is a full bio. It gets dropped into one sentence — “I’m NAME,
                with a background in …” — so a short phrase works far better
                than a paragraph.
              </p>
            </section>
          )}

          {blocking.length > 0 && (
            <section
              id="warn-grounding"
              role="alert"
              className="mt-6 rounded border border-red-300 bg-red-50 p-4"
            >
              <h2 className="text-sm font-medium text-red-900">
                These claims are not supported by your resume
              </h2>
              <ul className="mt-2 space-y-1 text-sm text-red-900">
                {blocking.map((f, i) => (
                  <li key={i}>
                    {f.message}
                    {f.evidence && (
                      <span className="ml-1 font-mono text-xs">
                        ({f.evidence})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {/* EC-P5-37: after an edit these are warnings, not a gate. The
                  user is the author of their own words — but they are told. */}
              <p className="mt-2 text-xs text-red-800">
                You can still send this. These are your words, and the decision
                is yours — but nothing here backs them up.
              </p>
            </section>
          )}

          {flags.length > 0 && (
            /* role="status", not "alert": these are advisory, and an assertive
               region for every soft flag would train the user to ignore the
               region that carries the blocking ones. */
            <section
              id="warn-flags"
              role="status"
              className="mt-4 rounded border border-amber-300 bg-amber-50 p-4"
            >
              <h2 className="text-sm font-medium text-amber-900">Worth checking</h2>
              <ul className="mt-2 space-y-1 text-sm text-amber-900">
                {flags.map((f, i) => (
                  <li key={i}>{f.message}</li>
                ))}
              </ul>
            </section>
          )}

          {/* EC-P5-59: the audit trail can under-report in exactly one
              direction, and this is where the user finds out. */}
          {draft.status === "failed" && draft.providerAttemptedAt && (
            <section className="mt-4 rounded border border-amber-400 bg-amber-50 p-4 text-sm text-amber-900">
              This attempt reached the provider before it failed, so a draft may
              have been created anyway. Check your mailbox before retrying.
            </section>
          )}

          {/* ── The draft ────────────────────────────────────────────── */}
          <section className="mt-8">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-medium text-muted-foreground">
                To {draft.contact.name ?? draft.contact.email}
              </h2>
              <span className="text-xs text-muted-foreground">
                {draft.wordCount}/{draft.wordLimit} words ·{" "}
                {draft.generationSource === "llm" ? "written" : "template"}
              </span>
            </div>

            {subjectOptions.length > 1 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {subjectOptions.map((option) => (
                  <button
                    key={option}
                    onClick={() => edit({ subject: option })}
                    className={`rounded border px-2 py-1 text-xs ${
                      subject === option ? "border-black bg-black text-white" : ""
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}

            <label className="mt-4 block">
              <span className="text-xs text-muted-foreground">Subject</span>
              <input
                value={subject}
                onChange={(e) => edit({ subject: e.target.value })}
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
              />
            </label>

            <label className="mt-3 block">
              <span className="text-xs text-muted-foreground">Body</span>
              <textarea
                rows={14}
                value={body}
                onChange={(e) => edit({ body: e.target.value })}
                className="mt-1 w-full rounded border px-3 py-2 font-mono text-xs"
              />
            </label>

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
              <p className="mt-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
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
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={save}
                disabled={busy || !dirty}
                className="rounded border px-4 py-2 text-sm disabled:opacity-50"
              >
                Save changes
              </button>
              <button
                onClick={approve}
                disabled={busy || dirty || approved || overLimit}
                /*
                 * EC-P7-07 — the warnings are announced as this control's
                 * description, so tabbing to Approve restates the risk at the
                 * moment of the decision. Ids of absent panels are ignored by
                 * assistive technology, so this needs no conditional logic.
                 */
                aria-describedby="warn-length warn-grounding warn-flags approve-hint"
                className="rounded border px-4 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
              >
                {approved ? "Approved" : "Approve"}
              </button>
              <button
                onClick={deliver}
                disabled={busy || !approved}
                className="rounded bg-black px-4 py-2 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
              >
                Send
              </button>
              <button
                onClick={skip}
                disabled={busy}
                className="ml-auto rounded px-4 py-2 text-sm text-muted-foreground underline disabled:opacity-50"
              >
                Skip this one
              </button>
            </div>

            {/*
             * Why Approve is unavailable, in text rather than only in an
             * opacity change. A disabled control with no stated reason is the
             * accessibility failure that also frustrates everyone else — the
             * user cannot tell "not yet" from "broken".
             */}
            <p id="approve-hint" className="mt-2 text-xs text-muted-foreground">
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
    </main>
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
      <section className="mt-8 rounded border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Evidence</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          No tailoring evidence — this is a generic template email. Tailor your
          resume for this job first if you want the draft to cite specifics.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-8 rounded border border-border bg-card p-4">
      <h2 className="text-sm font-medium">Evidence behind this email</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Every item here comes from your saved tailoring run. Nothing was
        invented for the email.
      </p>

      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">
            Skills this role asks for that your resume backs up
          </dt>
          <dd>
            {payload.topMatchedSkills.length > 0
              ? payload.topMatchedSkills.join(", ")
              : "None found — that is why the hook is generic."}
          </dd>
        </div>

        {payload.strongestBullet && (
          <div>
            <dt className="text-xs text-muted-foreground">
              Strongest accomplishment cited
            </dt>
            <dd className="italic">{payload.strongestBullet}</dd>
          </div>
        )}

        {payload.jdHooks.length > 0 && (
          <div>
            <dt className="text-xs text-muted-foreground">
              What the job description emphasises
            </dt>
            <dd>{payload.jdHooks.join(" · ")}</dd>
          </div>
        )}

        <div>
          <dt className="text-xs text-muted-foreground">Match score</dt>
          <dd>{payload.matchScore}/100</dd>
        </div>

        {payload.honestGaps.length > 0 && (
          <div>
            <dt className="text-xs text-muted-foreground">
              Deliberately not claimed
            </dt>
            {/* EC-P5-24: gaps are a suppression list. Shown here so the user
                knows they were withheld — never written into the body. */}
            <dd>
              {payload.honestGaps.join(", ")} — kept out of the email on purpose.
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
