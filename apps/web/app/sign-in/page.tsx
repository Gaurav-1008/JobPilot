"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

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
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm">Email</span>
          <input
            type="email" required value={email} autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-sm">Password</span>
          <input
            type="password" required value={password} autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </label>
        {/* role=alert so the failure is announced, not just coloured (EC-P7-07) */}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button
          type="submit" disabled={busy}
          className="w-full rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="mt-6 text-sm">
        No account? <Link href="/sign-up" className="underline">Sign up</Link>
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
    <main className="mx-auto max-w-sm px-6 py-16">
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
        <SignInForm />
      </Suspense>
    </main>
  );
}
