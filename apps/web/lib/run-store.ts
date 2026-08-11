import type { TailoringRun } from "@/lib/schemas";

/**
 * In-memory run store (MVP) keyed by runId.
 *
 * Persists a run between /api/analyze and /api/tailor within a single server
 * process. On serverless this resets between invocations — acceptable for the
 * demo path; swap for SQLite/Supabase in Phase 5 (§11.2). Kept on globalThis so
 * it survives dev-server hot reloads.
 */
const globalStore = globalThis as unknown as {
  __rsRunStore?: Map<string, TailoringRun>;
};

const store: Map<string, TailoringRun> =
  globalStore.__rsRunStore ?? new Map<string, TailoringRun>();

if (!globalStore.__rsRunStore) globalStore.__rsRunStore = store;

export function saveRun(run: TailoringRun): void {
  store.set(run.id, run);
}

export function getRun(id: string): TailoringRun | undefined {
  return store.get(id);
}

export function deleteRun(id: string): void {
  store.delete(id);
}
