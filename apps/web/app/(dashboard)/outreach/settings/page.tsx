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
          <div className="mt-3 flex flex-wrap gap-2">
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
      <h2 className="text-sm font-medium">Sending account</h2>

      {credential ? (
        <p className="mt-2 text-sm text-muted-foreground">
          {credential.provider === "smtp" ? "SMTP" : "Google"} connected ·{" "}
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
