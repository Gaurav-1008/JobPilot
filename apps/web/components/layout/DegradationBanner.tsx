"use client";

/**
 * Graceful-degradation banner (P7.2.4, EC-P7-10).
 *
 * §18's promise is that a Redis or ④ outage costs you harvesting and sending,
 * and leaves tailoring, review, and PDF export working. A user cannot benefit
 * from that promise unless they are told which half is down — otherwise the
 * first failed harvest reads as "the app is broken" and they close the tab with
 * a perfectly usable tailoring flow behind it.
 *
 * So the copy names the degraded capability AND the surviving one. That comes
 * from `degradationNotice()` server-side, where the §18 blast radii live, so the
 * banner cannot drift out of step with the failure matrix.
 *
 * POLLING. 30s, and only while the page is visible. The server answers from a
 * TTL cache (EC-P7-11), so this costs a cheap JSON round trip rather than a
 * probe — but pausing on a hidden tab still matters: a user with a dozen tabs
 * open should not be polling from all of them overnight.
 */

import { AlertTriangle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface HealthResponse {
  ok: boolean;
  redis: boolean;
  worker: boolean;
  notice: string | null;
}

export function DegradationBanner() {
  const { data } = useQuery<HealthResponse>({
    queryKey: ["system-health"],
    queryFn: async () => (await fetch("/api/health")).json(),
    refetchInterval: 30_000,
    // Don't poll a tab nobody is looking at.
    refetchIntervalInBackground: false,
    // A failed health check is NOT a degradation signal. The most likely cause
    // is the user's own connectivity, and announcing "the queue is unreachable"
    // because a fetch failed would be a confident statement about someone
    // else's infrastructure based on evidence about our own.
    retry: false,
  });

  if (!data || data.ok || !data.notice) return null;

  return (
    /*
     * role="status" with aria-live="polite": the banner is important context,
     * but it is not urgent and must not interrupt whatever a screen-reader user
     * is currently reading. That is the opposite of the review screen's
     * warnings (EC-P7-07), which use role="alert" precisely because they gate a
     * decision the user is about to make.
     */
    <div
      role="status"
      aria-live="polite"
      className="border-t border-warning-border bg-warning-soft text-warning"
    >
      <p className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-2 text-center text-sm sm:px-6">
        <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
        {data.notice}
      </p>
    </div>
  );
}
