"use client";

import { LogOut } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { clearRun } from "@/lib/run-view-store";

/**
 * EC-P1-01 — the ONLY correct way to sign out in this app.
 *
 * The server is already correct: every read is tenant-scoped, so user B can
 * never fetch user A's rows. But TanStack Query keys on query name, not on
 * identity, and lib/run-view-store holds module-level state. Sign out without
 * clearing both and the browser keeps rendering the previous user's resumes and
 * tailoring run — a real leak, even though no request was ever mis-scoped.
 *
 * clear() and not invalidateQueries(): invalidate REFETCHES, which briefly
 * re-renders stale data and fires requests as the wrong user.
 */
export function SignOutButton() {
  const queryClient = useQueryClient();
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth/signout", { method: "POST" });
    queryClient.clear();   // not invalidate — see above
    clearRun();
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={signOut}
      className="w-full justify-start md:w-auto md:justify-center"
    >
      <LogOut className="size-4" aria-hidden="true" />
      Sign out
    </Button>
  );
}
