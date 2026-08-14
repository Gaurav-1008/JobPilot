/**
 * Typed job payloads shared by the producer (①) and the consumer (③).
 *
 * P2.2.5 — every job carries a DETERMINISTIC id so an at-least-once queue
 * cannot duplicate work. At-least-once is the only guarantee a queue gives you;
 * idempotency has to come from here and from the upsert at the other end.
 */

export const QUEUE_NAME = "jobpilot";

export interface HarvestRunJob {
  runId: string;
  userId: string;
  role: string;
  location: string | null;
  boards: string[];
  limit: number;
}

export interface HarvestBoardJob {
  runId: string;
  userId: string;
  board: string;
  role: string;
  location: string | null;
  limit: number;
}

export interface HydrateJobPayload {
  jobId: string;
  userId: string;
}

export interface ScoreBatchPayload {
  userId: string;
  harvestRunId: string | null;
}

export type JobName = "harvest:run" | "harvest:board" | "hydrate:job" | "score:batch";

/**
 * `harvest-{runId}-{board}` — a redelivery maps onto the same id.
 *
 * Hyphens, NOT colons: BullMQ rejects `:` in a custom job id (it namespaces
 * its own Redis keys with colons) and throws "Custom Id cannot contain :".
 * Using colons here silently costs you idempotency, because the add() throws
 * and the job is never enqueued.
 */
export function boardJobId(runId: string, board: string, attempt = 0): string {
  // P7.2.1 / EC-P7-13 — a user-initiated retry needs a DIFFERENT id.
  //
  // The determinism above is what stops a redelivered message scraping a board
  // twice, and it works because the id is derived from the run and the board.
  // A retry is the one case where repeating the work is the intent, and with
  // `removeOnComplete: 100` the finished job may still be in Redis — so reusing
  // the id makes BullMQ discard the retry as a duplicate, silently. The button
  // appears to work and nothing happens.
  //
  // Attempt 0 keeps the original id verbatim, so nothing about the first run
  // changes and existing job ids stay stable.
  return attempt === 0
    ? `harvest-${runId}-${board}`
    : `harvest-${runId}-${board}-r${attempt}`;
}

export function runJobId(runId: string): string {
  return `harvest-${runId}`;
}

/** P3.2.1 — deterministic, so a redelivery cannot re-fetch the same page. */
export function hydrateJobId(jobId: string): string {
  return `hydrate-${jobId}`;
}

/** P4.2.3 — one in-flight scoring pass per user (§10.1: concurrency 1/user). */
export function scoreBatchJobId(userId: string, runId: string | null): string {
  return `score-${userId}-${runId ?? "all"}`;
}
