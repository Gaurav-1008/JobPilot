"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Error boundary for the tailor flow — recover without losing the session. */
export default function TailorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("tailor flow error:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-[color-mix(in_srgb,var(--danger)_15%,transparent)] text-danger">
        <AlertTriangle className="size-6" />
      </span>
      <h2 className="mt-4 text-lg font-semibold">Something went wrong</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        The tailoring flow hit an unexpected error. Your inputs are safe — try
        again.
      </p>
      <div className="mt-6">
        <Button onClick={reset}>
          <RotateCcw className="size-4" />
          Try again
        </Button>
      </div>
    </div>
  );
}
