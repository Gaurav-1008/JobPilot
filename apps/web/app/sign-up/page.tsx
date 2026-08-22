"use client";

import { useState } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export default function SignUpPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setError(data.message ?? "Sign up failed.");
      return;
    }

    /**
     * EC-P1-43, corrected.
     *
     * This screen used to say "check your email" unconditionally, on the
     * assumption that the project had `mailer_autoconfirm=false`. That setting
     * lives in the Supabase dashboard, not in this repo, and it is currently
     * ON — so no mail is sent, the account already works, and the old copy sent
     * people off to watch an inbox forever.
     *
     * The server now reports which case actually happened. When the account is
     * live immediately there is nothing to confirm, so sign straight in rather
     * than making the user retype the credentials they just chose.
     */
    if (!data.needsConfirmation) {
      const signIn = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      setBusy(false);
      if (signIn.ok) {
        // Full navigation, not router.push: the session cookie was just set and
        // every server component needs to re-render with it.
        window.location.href = "/jobs";
        return;
      }
      // Account exists but auto sign-in failed — send them to sign in by hand
      // rather than showing a confirmation screen that does not apply.
      setError("Account created. Please sign in.");
      return;
    }

    setBusy(false);
    setDone(true);
  }

  if (done) {
    return (
      <div className="mx-auto w-full max-w-sm px-4 py-16 text-center sm:px-6">
        <span
          aria-hidden="true"
          className="mx-auto grid size-12 place-items-center rounded-full bg-success-soft text-success"
        >
          <MailCheck className="size-6" />
        </span>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          Check your email
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          We sent a confirmation link. You need to click it before you can sign
          in.
        </p>
        <p className="mt-6 text-sm">
          <Link
            href="/sign-in"
            className="font-medium text-link underline decoration-link/40 underline-offset-4 hover:decoration-link"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-sm px-4 py-16 sm:px-6">
      <div className="space-y-1.5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Create an account
        </h1>
        <p className="text-sm text-muted-foreground">
          Harvesting, scoring, and outreach all need one. Tailoring alone does
          not.
        </p>
      </div>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <Field label="Email" required>
          {(p) => (
            <Input
              {...p}
              type="email"
              required
              value={email}
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>

        <Field label="Password" required hint="At least 8 characters.">
          {(p) => (
            <Input
              {...p}
              type="password"
              required
              minLength={8}
              value={password}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>

        {error && (
          <Alert role="alert" tone="danger">
            {error}
          </Alert>
        )}

        <Button type="submit" className="w-full" loading={busy}>
          {busy ? "Creating…" : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have one?{" "}
        <Link
          href="/sign-in"
          className="font-medium text-link underline decoration-link/40 underline-offset-4 hover:decoration-link"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
