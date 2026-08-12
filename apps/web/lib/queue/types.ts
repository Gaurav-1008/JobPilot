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

export type JobName = "harvest:run" | "harvest:board";

/**
 * `harvest-{runId}-{board}` — a redelivery maps onto the same id.
 *
 * Hyphens, NOT colons: BullMQ rejects `:` in a custom job id (it namespaces
 * its own Redis keys with colons) and throws "Custom Id cannot contain :".
 * Using colons here silently costs you idempotency, because the add() throws
 * and the job is never enqueued.
 */
export function boardJobId(runId: string, board: string): string {
  return `harvest-${runId}-${board}`;
}

export function runJobId(runId: string): string {
  return `harvest-${runId}`;
}
