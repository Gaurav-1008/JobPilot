"use client";

import { useState } from "react";
import Link from "next/link";

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
    setBusy(false);
    if (!res.ok) {
      setError(data.message ?? "Sign up failed.");
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <main className="mx-auto max-w-sm px-6 py-16">
        <h1 className="text-2xl font-semibold">Check your email</h1>
        {/* EC-P1-43: this project has mailer_autoconfirm=false, so a real
            confirmation email is sent and sign-in fails until it is clicked.
            Saying so beats letting the user think sign-up silently failed. */}
        <p className="mt-4 text-sm text-neutral-600">
          We sent a confirmation link. You need to click it before you can sign in.
        </p>
        <p className="mt-6 text-sm">
          <Link href="/sign-in" className="underline">Back to sign in</Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold">Create an account</h1>
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
            type="password" required minLength={8} value={password}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded border px-3 py-2"
          />
        </label>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button
          type="submit" disabled={busy}
          className="w-full rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create account"}
        </button>
      </form>
      <p className="mt-6 text-sm">
        Already have one? <Link href="/sign-in" className="underline">Sign in</Link>
      </p>
    </main>
  );
}
