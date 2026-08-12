"use client";

import type { TailoringRun } from "@/lib/schemas";

/**
 * In-memory view cache for the run currently on screen (P1.3.8).
 *
 * Replaces lib/run-client-store.ts, which persisted to sessionStorage. That is
 * gone: the DATABASE is now the source of truth, and a run is refetchable from
 * GET /api/runs/:id. Keeping a second persistence mechanism in the browser
 * would just be a way for the two to disagree.
 *
 * Same interface as the old store, so hooks/useTailoringRun.ts changes only its
 * import — the anti-corruption layer doing its job.
 *
 * EC-P1-01: module-level state survives a sign-out, so `clearRun()` MUST be
 * called on any auth identity change. The server is correct without it, but the
 * browser would still be rendering the previous user's run.
 */

let current: TailoringRun | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function getSnapshot(): TailoringRun | null {
  return current;
}

/** Server render has no view state; the run arrives from the DB via props. */
export function getServerSnapshot(): TailoringRun | null {
  return null;
}

export function setRun(next: TailoringRun | null): void {
  current = next;
  emit();
}

/** EC-P1-01 — call on sign-out and on any user switch. */
export function clearRun(): void {
  setRun(null);
}
