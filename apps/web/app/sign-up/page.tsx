"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { MailCheck } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { safeNextPath } from "@/lib/auth/next-path";

function SignUpForm() {
  /*
   * Honouring `next` here is what makes "Just tailor a resume" on the landing
   * page mean anything. Without it this screen finished on /jobs no matter how
   * the user arrived, so someone who clicked through specifically to tailor a
   * pasted resume was dropped on the job board instead — the one screen they
   * had just declined to use.
   *
   * Validated, not raw: it is assigned to window.location.href below. See
   * safeNextPath.
   */
  const rawNext = useSearchParams().get("next");
  const next = safeNextPath(rawNext, "/jobs");
  const signInHref = rawNext ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in";

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
        window.location.href = next;
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
            href={signInHref}
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
          Harvesting, scoring, tailoring, and outreach all run against your
          account. It takes an email and a password.
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
          href={signInHref}
          className="font-medium text-link underline decoration-link/40 underline-offset-4 hover:decoration-link"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}

/**
 * useSearchParams() opts a component into client-side rendering, and Next
 * refuses to statically prerender the page without a Suspense boundary above
 * it. Caught by `next build`, not by typecheck or tests — the same boundary
 * sign-in needs, for the same reason.
 */
export default function SignUpPage() {
  return (
    <Suspense
      fallback={
        <div
          className="mx-auto w-full max-w-sm space-y-4 px-4 py-16 sm:px-6"
          role="status"
          aria-busy="true"
          aria-label="Loading"
        >
          <Skeleton className="mx-auto h-8 w-40" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      }
    >
      <SignUpForm />
    </Suspense>
  );
}
