-- P7.2.1 / EC-P7-13 — how many times a user has retried this run's failed boards.
--
-- Two jobs, one column.
--
-- It CAPS retries. Without a bound, a board that is down for the afternoon
-- becomes a button a frustrated user presses twenty times, and every press is a
-- real request to a site that is already struggling — the opposite of what
-- §11.4's conduct controls are for.
--
-- It also makes the queue job id unique per attempt. Board job ids are
-- deterministic by design (P2.2.5), so a redelivered message cannot scrape a
-- board twice; a retry is the one case where repeating the work IS the intent,
-- and with removeOnComplete the finished job may still be in Redis. Without an
-- attempt number in the id, BullMQ discards the retry as a duplicate and the
-- button silently does nothing.
--
-- Defaults to 0 so existing rows read as never retried, and so attempt 0 keeps
-- the original job id verbatim.
ALTER TABLE harvest_runs
  ADD COLUMN retry_count INT NOT NULL DEFAULT 0;
