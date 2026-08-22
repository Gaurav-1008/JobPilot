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
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ListLoading } from "@/components/ui/list-state";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Select } from "@/components/ui/select";

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
      fallback={
        <Page width="narrow">
          <ListLoading rows={3} label="Loading your sending settings" />
        </Page>
      }
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
    return (
      <Page width="narrow">
        <ListLoading rows={3} label="Loading your sending settings" />
      </Page>
    );
  }

  const posture = settings.dryRun
    ? "Nothing will be sent. Every safety check still runs, and results are logged."
    : settings.sendMode === "draft"
      ? "Emails will be created as drafts in your mailbox. You still press send there."
      : "Emails will be sent for real, to real people.";

  /*
   * The posture banner is the loudest thing on the page, and its tone is the
   * signal. Only the live-sending combination is a warning: dry run and draft
   * mode are both safe states, and colouring them the same way would make the
   * one state that warrants attention indistinguishable from the two that do
   * not.
   */
  const live = !settings.dryRun && settings.sendMode === "send";

  return (
    <Page width="narrow">
      <PageHeader
        back={{ href: "/outreach", label: "Outreach" }}
        title="Sending settings"
      />

      <div className="mt-6 space-y-4">
        <Alert
          role="status"
          tone={live ? "warning" : "success"}
          title={live ? "Live sending is on" : "Safe mode"}
        >
          {posture}
        </Alert>

        {oauthMessage && (
          <Alert role="status" tone={oauthResult === "connected" ? "success" : "warning"}>
            {oauthMessage}
          </Alert>
        )}
        {error && (
          <Alert role="alert" tone="danger">
            {error}
          </Alert>
        )}
        {notice && (
          <Alert role="status" tone="info">
            {notice}
          </Alert>
        )}
      </div>

      {/* ── Safety settings ────────────────────────────────────────────── */}
      <div className="mt-8 space-y-6">
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-4 shadow-sm transition-colors hover:border-border-strong">
          <Checkbox
            checked={settings.dryRun}
            onChange={(e) => save.mutate({ dryRun: e.target.checked })}
            className="mt-0.5"
          />
          <span>
            <span className="block text-sm font-medium">Dry run</span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
              Run the whole pipeline without contacting anyone.
              {!credential?.preflightOk &&
                " You cannot turn this off until a sending account passes its connection check."}
            </span>
          </span>
        </label>

        <Field
          label="When sending"
          hint="Drafts are the safer default and need a connected Google account."
        >
          {(p) => (
            <Select
              {...p}
              value={settings.sendMode}
              onChange={(e) =>
                save.mutate({ sendMode: e.target.value as "draft" | "send" })
              }
            >
              <option value="draft">Create a draft I press send on</option>
              <option value="send">Send immediately</option>
            </Select>
          )}
        </Field>

        {/* The one combination that can never work. Saying so here beats
            discovering it as a `failed` row after approving an email —
            interlock check 12 refuses it every time, correctly, but silently
            from the user's side. */}
        {settings.sendMode === "send" && credential && !credential.canSend && (
          <Alert role="alert" tone="danger" title="This combination can never send">
            Your Google account is authorized for <strong>drafts only</strong>,
            so nothing will send while this says “Send immediately” — every
            attempt is refused at the last check. Either switch this back to
            “Create a draft I press send on”, or use{" "}
            <strong>Add sending access</strong> below to re-authorize.
          </Alert>
        )}

        <Field
          label="Daily limit"
          hint="Counted over a rolling 24 hours, not per calendar day."
        >
          {(p) => (
            <Input
              {...p}
              type="number"
              min={1}
              max={25}
              defaultValue={settings.maxOutreachPerDay}
              onBlur={(e) => save.mutate({ maxOutreachPerDay: Number(e.target.value) })}
              className="w-28"
            />
          )}
        </Field>
      </div>

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
    </Page>
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
      <Button
        variant="outline"
        size="sm"
        onClick={() => verify.mutate()}
        loading={verify.isPending}
      >
        {verify.isPending ? "Checking…" : "Run connection check"}
      </Button>
      {result && (
        <p role="status" className="basis-full text-xs text-muted-foreground">
          {result}
        </p>
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
      <Section title="Google account" className="mt-10 border-t border-border pt-8">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Not available: this server has no Google OAuth credentials configured.
          Set{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            GOOGLE_CLIENT_ID
          </code>{" "}
          and{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            GOOGLE_CLIENT_SECRET
          </code>{" "}
          to enable draft mode. SMTP below works without it.
        </p>
      </Section>
    );
  }

  return (
    <Section title="Google account" className="mt-10 border-t border-border pt-8">
      {connected && credential ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={credential.preflightOk ? "success" : "warning"}>
              {credential.preflightOk ? "verified" : "not yet verified"}
            </Badge>
            <Badge variant={credential.canSend ? "info" : "secondary"}>
              {credential.canSend
                ? "drafts and direct sending authorized"
                : "drafts only"}
            </Badge>
          </div>

          {!credential.preflightOk && (
            <Alert tone="warning">
              The connection check has not passed, so nothing can be sent yet.
              This is often just the email service having been unreachable at the
              moment you connected — run the check again below.
            </Alert>
          )}

          <div className="flex flex-wrap gap-2">
            <VerifyButton />
            {!credential.canSend && (
              /* eslint-disable-next-line @next/next/no-html-link-for-pages --
                 Not a page: this is a route handler that 302s to Google's
                 consent screen. next/link would client-navigate and try to
                 fetch it as an RSC payload, which never reaches Google. */
              <a
                href="/api/outreach/oauth/google/start?access=send"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Add sending access
              </a>
            )}
            <Button
              variant="destructive"
              size="sm"
              onClick={() => disconnect.mutate()}
              loading={disconnect.isPending}
            >
              {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Connect Gmail to create drafts you review in your own mailbox before
            anything goes out.
          </p>
          <div className="flex flex-wrap gap-2">
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
                Route handler that redirects off-site to Google; see above. */}
            <a
              href="/api/outreach/oauth/google/start?access=draft"
              className={buttonVariants({ size: "sm" })}
            >
              Connect for drafts
            </a>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages --
                Route handler that redirects off-site to Google; see above. */}
            <a
              href="/api/outreach/oauth/google/start?access=send"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Connect for drafts and sending
            </a>
          </div>
          <p className="text-xs text-muted-foreground">
            Drafts are the safer choice — you press send yourself, in Gmail.
          </p>
        </>
      )}
    </Section>
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
    <section className="mt-10 space-y-4 border-t border-border pt-8">
      {/* Named as the ALTERNATIVE it is. With two sections on one page, a
          generic "Sending account" heading reads as a second thing you must
          also fill in — and the two are mutually exclusive: one credential row
          per user, so connecting SMTP replaces Google and vice versa. */}
      <div className="space-y-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Or connect by SMTP instead
        </h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          An alternative to Google, not an addition — you need one or the other.
          SMTP sends immediately and cannot create drafts, so draft mode needs
          Google.
        </p>
      </div>

      {credential ? (
        <Alert tone="neutral">
          Currently connected:{" "}
          <strong>{credential.provider === "smtp" ? "SMTP" : "Google"}</strong> ·{" "}
          {credential.preflightOk
            ? "connection check passed"
            : "connection check has not passed"}
        </Alert>
      ) : (
        <Alert tone="warning">
          No account connected. Nothing can be sent until one is.
        </Alert>
      )}

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          connect.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
          <Field label="SMTP host">
            {(p) => (
              <Input {...p} value={host} onChange={(e) => setHost(e.target.value)} />
            )}
          </Field>
          <Field label="Port">
            {(p) => (
              <Input
                {...p}
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
              />
            )}
          </Field>
        </div>

        <Field label="Email address">
          {(p) => (
            <Input
              {...p}
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="you@gmail.com"
              autoComplete="username"
            />
          )}
        </Field>

        <Field
          label="App password"
          hint="Not your account password. Gmail rejects normal passwords over SMTP — create an app password in your Google account settings."
          error={error}
        >
          {(p) => (
            <Input
              {...p}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
            />
          )}
        </Field>

        <Button type="submit" loading={connect.isPending} disabled={!user || !password}>
          {connect.isPending ? "Checking…" : "Save and test connection"}
        </Button>
      </form>
    </section>
  );
}
