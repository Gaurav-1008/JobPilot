"use client";

/**
 * Sending settings (P5.5.10).
 *
 * The safety posture is stated in plain language at the top rather than
 * inferred from three toggles. A user who cannot tell at a glance whether the
 * next click sends a real email is one bad assumption away from the failure
 * this whole phase exists to prevent.
 *
 * Dry run cannot be turned off until a sending account passes its connection
 * check — enforced on the server (the only place enforcement counts); the
 * disabled control here just explains why.
 */

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

interface Settings {
  dryRun: boolean;
  sendMode: "draft" | "send";
  maxOutreachPerDay: number;
}

interface CredentialStatus {
  provider: string;
  preflightOk: boolean;
  canSend: boolean;
  canDraft: boolean;
  connectedAt: string;
}

export default function OutreachSettingsPage() {
  // useSearchParams suspends during prerender, so the boundary is required.
  return (
    <Suspense
      fallback={<main className="p-8 text-sm text-muted-foreground">Loading…</main>}
    >
      <SettingsScreen />
    </Suspense>
  );
}

function SettingsScreen() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data } = useQuery<{
    settings: Settings;
    credential: CredentialStatus | null;
    googleConfigured: boolean;
  }>({
    queryKey: ["outreach-settings"],
    queryFn: async () => (await fetch("/api/outreach/settings")).json(),
  });

  // The OAuth callback redirects back here with a readable outcome rather than
  // rendering JSON in the address bar.
  const params = useSearchParams();
  const oauthResult = params.get("google");
  const oauthMessage = params.get("message");

  const save = useMutation({
    mutationFn: async (patch: Partial<Settings>) => {
      const res = await fetch("/api/outreach/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save.");
      return body;
    },
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ["outreach-settings"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const settings = data?.settings;
  const credential = data?.credential ?? null;
  const googleReady = data?.googleConfigured ?? false;
  if (!settings) {
    return <main className="p-8 text-sm text-muted-foreground">Loading…</main>;
  }

  const posture = settings.dryRun
    ? "Nothing will be sent. Every safety check still runs, and results are logged."
    : settings.sendMode === "draft"
      ? "Emails will be created as drafts in your mailbox. You still press send there."
      : "Emails will be sent for real, to real people.";

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/outreach" className="text-sm underline text-muted-foreground">
        ← Outreach
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">Sending settings</h1>

      <p
        className={`mt-4 rounded border p-3 text-sm ${
          settings.dryRun || settings.sendMode === "draft"
            ? "border-border bg-card"
            : "border-amber-400 bg-amber-50 text-amber-900"
        }`}
      >
        {posture}
      </p>

      {oauthMessage && (
        <p
          className={`mt-4 rounded border p-3 text-sm ${
            oauthResult === "connected"
              ? "border-border bg-card"
              : "border-amber-400 bg-amber-50 text-amber-900"
          }`}
        >
          {oauthMessage}
        </p>
      )}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {notice && <p className="mt-4 text-sm text-muted-foreground">{notice}</p>}

      {/* ── Safety settings ────────────────────────────────────────────── */}
      <section className="mt-8 space-y-5">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={settings.dryRun}
            onChange={(e) => save.mutate({ dryRun: e.target.checked })}
            className="mt-1"
          />
          <span>
            <span className="text-sm font-medium">Dry run</span>
            <span className="block text-xs text-muted-foreground">
              Run the whole pipeline without contacting anyone.
              {!credential?.preflightOk &&
                " You cannot turn this off until a sending account passes its connection check."}
            </span>
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-medium">When sending</span>
          <select
            value={settings.sendMode}
            onChange={(e) =>
              save.mutate({ sendMode: e.target.value as "draft" | "send" })
            }
            className="mt-1 w-full rounded border px-3 py-2 text-sm"
          >
            <option value="draft">Create a draft I press send on</option>
            <option value="send">Send immediately</option>
          </select>
          <span className="mt-1 block text-xs text-muted-foreground">
            Drafts are the safer default and need a connected Google account.
          </span>
          {/* The one combination that can never work. Saying so here beats
              discovering it as a `failed` row after approving an email —
              interlock check 12 refuses it every time, correctly, but silently
              from the user's side. */}
          {settings.sendMode === "send" && credential && !credential.canSend && (
            <span className="mt-2 block rounded border border-red-300 bg-red-50 p-2 text-xs text-red-900">
              Your Google account is authorized for <strong>drafts only</strong>,
              so nothing will send while this says “Send immediately” — every
              attempt is refused at the last check. Either switch this back to
              “Create a draft I press send on”, or use{" "}
              <strong>Add sending access</strong> below to re-authorize.
            </span>
          )}
        </label>

        <label className="block">
          <span className="text-sm font-medium">Daily limit</span>
          <input
            type="number"
            min={1}
            max={25}
            defaultValue={settings.maxOutreachPerDay}
            onBlur={(e) =>
              save.mutate({ maxOutreachPerDay: Number(e.target.value) })
            }
            className="mt-1 w-24 rounded border px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            Counted over a rolling 24 hours, not per calendar day.
          </span>
        </label>
      </section>

      <GoogleAccount
        credential={credential}
        configured={googleReady}
        onDisconnected={() => {
          setNotice("Disconnected. The authorization was revoked at Google too.");
          void qc.invalidateQueries({ queryKey: ["outreach-settings"] });
        }}
      />

      <SmtpForm
        credential={credential}
        onSaved={(message) => {
          setNotice(message);
          void qc.invalidateQueries({ queryKey: ["outreach-settings"] });
        }}
      />
    </main>
  );
}

/**
 * Re-run the connection check on the stored credential (P5.5.2).
 *
 * Exists because the check used to run exactly once, when the credential was
 * saved. A failure there for a reason unrelated to the credential — the email
 * service being down at that moment — left a perfectly good account marked
 * unverified forever, with the only escape being a full reconnect. For Google
 * that meant redoing the OAuth consent screen to retry a health check.
 */
function VerifyButton() {
  const qc = useQueryClient();
  const [result, setResult] = useState<string | null>(null);

  const verify = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/outreach/credentials/verify", {
        method: "POST",
      });
      return (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string | null;
        error?: string;
      };
    },
    onSuccess: (body) => {
      setResult(
        body.ok
          ? "Connection check passed. You can turn dry run off now."
          : (body.reason ?? body.error ?? "The check did not pass."),
      );
      void qc.invalidateQueries({ queryKey: ["outreach-settings"] });
    },
  });

  return (
    <>
      <button
        onClick={() => verify.mutate()}
        disabled={verify.isPending}
        className="rounded border px-4 py-2 text-sm disabled:opacity-50"
      >
        {verify.isPending ? "Checking…" : "Run connection check"}
      </button>
      {result && (
        <p className="basis-full text-xs text-muted-foreground">{result}</p>
      )}
    </>
  );
}

/**
 * Google account connection (P5.5.3).
 *
 * The two levels of access are separate buttons with the difference spelled
 * out, rather than one "Connect" that quietly asks for everything. Drafts come
 * first and are described as the safer option because they are: a draft sitting
 * in the user's mailbox is recoverable, and a sent email is not.
 *
 * EC-P5-65: what Google actually GRANTED is displayed, not what was requested.
 * A user who unchecks a permission on the consent screen learns it here, rather
 * than at the moment a send is blocked.
 */
function GoogleAccount({
  credential,
  configured,
  onDisconnected,
}: {
  credential: CredentialStatus | null;
  configured: boolean;
  onDisconnected: () => void;
}) {
  const connected = credential?.provider === "gmail_api";

  const disconnect = useMutation({
    mutationFn: async () => {
      await fetch("/api/outreach/credentials", { method: "DELETE" });
    },
    onSuccess: onDisconnected,
  });

  if (!configured) {
    return (
      <section className="mt-10 border-t border-border pt-8">
        <h2 className="text-sm font-medium">Google account</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Not available: this server has no Google OAuth credentials configured.
          Set <code className="text-xs">GOOGLE_CLIENT_ID</code> and{" "}
          <code className="text-xs">GOOGLE_CLIENT_SECRET</code> to enable draft
          mode. SMTP below works without it.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-10 border-t border-border pt-8">
      <h2 className="text-sm font-medium">Google account</h2>

      {connected && credential ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            Connected · {credential.preflightOk ? "verified" : "not yet verified"}{" "}
            ·{" "}
            {credential.canSend
              ? "drafts and direct sending authorized"
              : "drafts only"}
          </p>
          {!credential.preflightOk && (
            <p className="mt-2 text-xs text-amber-600">
              The connection check has not passed, so nothing can be sent yet.
              This is often just the email service having been unreachable at
              the moment you connected — run the check again below.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <VerifyButton />
            {!credential.canSend && (
              <>
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
                    Not a page: this is a route handler that 302s to Google's
                    consent screen. next/link would client-navigate and try to
                    fetch it as an RSC payload, which never reaches Google. */}
                <a
                  href="/api/outreach/oauth/google/start?access=send"
                  className="rounded border px-4 py-2 text-sm"
                >
                  Add sending access
                </a>
              </>
            )}
            <button
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
              className="rounded border px-4 py-2 text-sm disabled:opacity-50"
            >
              {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            Connect Gmail to create drafts you review in your own mailbox before
            anything goes out.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
                Route handler that redirects off-site to Google; see above. */}
            <a
              href="/api/outreach/oauth/google/start?access=draft"
              className="rounded bg-black px-4 py-2 text-sm text-white"
            >
              Connect for drafts
            </a>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
                Route handler that redirects off-site to Google; see above. */}
            <a
              href="/api/outreach/oauth/google/start?access=send"
              className="rounded border px-4 py-2 text-sm"
            >
              Connect for drafts and sending
            </a>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Drafts are the safer choice — you press send yourself, in Gmail.
          </p>
        </>
      )}
    </section>
  );
}

function SmtpForm({
  credential,
  onSaved,
}: {
  credential: CredentialStatus | null;
  onSaved: (message: string) => void;
}) {
  const [host, setHost] = useState("smtp.gmail.com");
  const [port, setPort] = useState(587);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const connect = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/outreach/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "smtp",
          smtpHost: host,
          smtpPort: port,
          smtpUser: user,
          smtpPassword: password,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save.");
      return body;
    },
    onSuccess: (body) => {
      // The password never comes back and is not kept in component state
      // beyond this point.
      setPassword("");
      setError(null);
      onSaved(
        body.preflightOk
          ? "Connected and verified. You can turn dry run off now."
          : `Saved, but the check failed: ${body.reason ?? "unknown"}. Nothing can be sent yet.`,
      );
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <section className="mt-10 border-t border-border pt-8">
      {/* Named as the ALTERNATIVE it is. With two sections on one page, a
          generic "Sending account" heading reads as a second thing you must
          also fill in — and the two are mutually exclusive: one credential row
          per user, so connecting SMTP replaces Google and vice versa. */}
      <h2 className="text-sm font-medium">Or connect by SMTP instead</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        An alternative to Google, not an addition — you need one or the other.
        SMTP sends immediately and cannot create drafts, so draft mode needs
        Google.
      </p>

      {credential ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Currently connected: {credential.provider === "smtp" ? "SMTP" : "Google"} ·{" "}
          {credential.preflightOk
            ? "connection check passed"
            : "connection check has not passed"}
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          No account connected. Nothing can be sent until one is.
        </p>
      )}

      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          connect.mutate();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs text-muted-foreground">SMTP host</span>
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Port</span>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-xs text-muted-foreground">Email address</span>
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="you@gmail.com"
            className="mt-1 w-full rounded border px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-xs text-muted-foreground">
            App password (not your account password)
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            className="mt-1 w-full rounded border px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            Gmail rejects normal passwords over SMTP. Create an app password in
            your Google account settings.
          </span>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={connect.isPending || !user || !password}
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {connect.isPending ? "Checking…" : "Save and test connection"}
        </button>
      </form>
    </section>
  );
}
