"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

function SignInForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/resumes";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/signin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.message ?? "Sign in failed.");
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <>
      <div className="space-y-1.5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Pick up where you left off.
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

        <Field label="Password" required>
          {(p) => (
            <Input
              {...p}
              type="password"
              required
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>

        {/* role=alert so the failure is announced, not just coloured (EC-P7-07) */}
        {error && (
          <Alert role="alert" tone="danger">
            {error}
          </Alert>
        )}

        <Button type="submit" className="w-full" loading={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        No account?{" "}
        <Link
          href="/sign-up"
          className="font-medium text-link underline decoration-link/40 underline-offset-4 hover:decoration-link"
        >
          Sign up
        </Link>
      </p>
    </>
  );
}

/**
 * useSearchParams() opts a component into client-side rendering, and Next
 * refuses to statically prerender the page without a Suspense boundary above
 * it. Caught by `next build`, not by typecheck or tests — worth remembering
 * that those two passing does not mean the app builds.
 */
export default function SignInPage() {
  return (
    <div className="mx-auto w-full max-w-sm px-4 py-16 sm:px-6">
      <Suspense
        fallback={
          <div className="space-y-4" role="status" aria-busy="true" aria-label="Loading">
            <Skeleton className="mx-auto h-8 w-32" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        }
      >
        <SignInForm />
      </Suspense>
    </div>
  );
}
