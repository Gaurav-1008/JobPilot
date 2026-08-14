"use client";

/**
 * Error boundary for every dashboard screen (P7.1.3).
 *
 * ═════════════════════════════════════════════════════════════════════════
 * EC-P7-05 — "TRY AGAIN" IS NOT SAFE FOR EVERY OPERATION.
 *
 * The edge case: an error boundary offers retry, and retry re-runs a mutation
 * that partially succeeded. Next.js's `reset()` re-renders the segment, which
 * re-runs the render path — including any request a component fires on mount.
 * On this dashboard those include enqueueing a harvest and starting a scoring
 * run, and a mutation that succeeded server-side while failing on the way back
 * would be submitted a second time.
 *
 * So the primary action here is RELOAD, not retry. A full navigation re-reads
 * state from the server first, so whatever the user does next is decided
 * against what actually happened rather than against what they last saw.
 * `reset()` is still offered, deliberately secondary and labelled for what it
 * is, because for a purely presentational failure it is the cheaper recovery.
 *
 * The distinction is stated in the copy rather than hidden, because the user is
 * the only one who knows whether they had just pressed something.
 * ═════════════════════════════════════════════════════════════════════════
 */

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is what correlates this screen with the server log line;
    // Next.js redacts the message itself in production, so the digest is the
    // only handle there is. The error object is passed as a value, never
    // interpolated — see lib/obs/redact.ts on why that distinction matters.
    console.error("dashboard error", { digest: error.digest });
  }, [error]);

  return (
    <main className="mx-auto max-w-lg px-6 py-20 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-[color-mix(in_srgb,var(--danger)_15%,transparent)] text-danger">
        <AlertTriangle className="size-6" />
      </span>

      <h1 className="mt-4 text-lg font-semibold">This screen hit an error</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Your data is safe — nothing was deleted, and anything already saved is
        still saved.
      </p>

      <div className="mt-6 flex flex-col items-center gap-3">
        <button
          onClick={() => window.location.reload()}
          className="rounded bg-black px-4 py-2 text-sm text-white"
        >
          Reload this page
        </button>

        {/*
         * Secondary, and labelled honestly. If the user had just started a
         * harvest or a scoring run when this appeared, re-rendering could
         * repeat it — so the label says what the button does rather than
         * promising it is safe.
         */}
        <button
          onClick={reset}
          className="text-sm text-muted-foreground underline"
        >
          Or retry without reloading — avoid this if you had just started
          something
        </button>
      </div>

      {error.digest && (
        <p className="mt-8 font-mono text-xs text-muted-foreground">
          Reference: {error.digest}
        </p>
      )}
    </main>
  );
}
