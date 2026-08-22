/**
 * "Which jobs came from this run?" — one definition, four call sites.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE BUG THIS FIXES: A SEARCH REPORTING 20 JOBS AND A BOARD SHOWING NONE.
 *
 * A job row carries two run references, and they mean different things:
 *
 *   harvestRunId   the run that FIRST saw this posting. Never changes.
 *   lastSeenRunId  the most recent run that saw it. Updated on every sighting.
 *
 * That split is deliberate and correct (EC-P2-19): "which run first found
 * this?" has to stay answerable, so a re-harvest must not rewrite history.
 *
 * The mistake was reading it back. Every "jobs from this run" query filtered on
 * `harvestRunId`, which silently means "jobs this run discovered FOR THE FIRST
 * TIME". Run the same search twice and the second run discovers nothing new —
 * every row already exists, so each one gets `lastSeenRunId = run2` while
 * `harvestRunId` stays on run1. The board filtered to run2 and returned zero.
 *
 * Observed exactly that way: board_results said naukri 20, remoteok 20,
 * wellfound 20, the run finished `partial`, and /jobs?runId= showed nothing.
 * 55 rows carried `lastSeenRunId` for that run. The scrape worked perfectly;
 * the read was asking a different question than the user was.
 *
 * The two failure modes are worth naming because only one is visible:
 *   · Repeat the same search  → 0 results, obviously wrong, user reports it.
 *   · Overlapping searches    → PARTIAL results. "AI Engineer" then "ML
 *     Engineer" shows only the postings unique to the second, and looks
 *     entirely plausible. Nobody reports that one.
 *
 * So: a run SURFACED a job if it either discovered it or saw it again. That is
 * what every caller meant, and now it is written down once.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Deliberately dependency-free — a plain object, no Prisma import — so the
 * orchestrator (③) can share it without pulling ①'s database client into its
 * module graph, which would create a second connection pool.
 */

export interface RunScopedJobFilter {
  OR: Array<{ harvestRunId: string } | { lastSeenRunId: string }>;
}

/** Jobs this run surfaced: discovered for the first time, or saw again. */
export function jobsSurfacedByRun(runId: string): RunScopedJobFilter {
  return { OR: [{ harvestRunId: runId }, { lastSeenRunId: runId }] };
}

/**
 * Spread into a `where` clause, collapsing to nothing when no run is given.
 *
 * The no-run case means "every job this user has", and must stay an empty
 * object rather than a filter that matches nothing — the unscoped board is the
 * default view.
 */
export function scopeToRun(runId?: string | null): RunScopedJobFilter | Record<string, never> {
  return runId ? jobsSurfacedByRun(runId) : {};
}
