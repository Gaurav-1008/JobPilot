"use client";

import { TailoringRunSchema, type TailoringRun } from "@/lib/schemas";

/**
 * Tiny client-side store for the current TailoringRun, backed by sessionStorage
 * and exposed through the useSyncExternalStore contract. This keeps restore
 * logic out of effects (no setState-in-effect) and survives refresh.
 */

const CURRENT_KEY = "rs:current-run-id";
const runKey = (id: string) => `rs:run:${id}`;

// `undefined` = not yet loaded from storage; `null` = loaded, no run.
let current: TailoringRun | null | undefined = undefined;
const listeners = new Set<() => void>();

function loadFromStorage(): TailoringRun | null {
  try {
    const id = sessionStorage.getItem(CURRENT_KEY);
    if (!id) return null;
    const raw = sessionStorage.getItem(runKey(id));
    if (!raw) return null;
    const parsed = TailoringRunSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/** Client snapshot — cached reference so useSyncExternalStore stays stable. */
export function getSnapshot(): TailoringRun | null {
  if (current === undefined) {
    current = typeof window === "undefined" ? null : loadFromStorage();
  }
  return current;
}

/** Server snapshot — always null (no sessionStorage during SSR). */
export function getServerSnapshot(): TailoringRun | null {
  return null;
}

export function setRun(next: TailoringRun | null): void {
  current = next;
  try {
    if (next) {
      sessionStorage.setItem(CURRENT_KEY, next.id);
      sessionStorage.setItem(runKey(next.id), JSON.stringify(next));
    } else {
      sessionStorage.removeItem(CURRENT_KEY);
    }
  } catch {
    // storage unavailable — keep in-memory value only
  }
  listeners.forEach((l) => l());
}
