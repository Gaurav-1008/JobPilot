-- P7.4.5 / EC-P7-25 — object-storage cleanup that survives a crash.
--
-- Account deletion is a distributed transaction nobody planned for. The user's
-- data lives in Postgres AND in object storage, and `ON DELETE CASCADE` covers
-- exactly one of those. Delete the rows first and a failure halfway through
-- storage cleanup orphans resume PDFs forever, with nothing left in the
-- database pointing at them — you cannot even enumerate what to clean up,
-- because the rows that named the keys are gone. That is a compliance problem,
-- not a housekeeping task: the user asked to be deleted and their documents are
-- still sitting in a bucket.
--
-- Doing it the other way round is worse. Delete the objects first, then fail to
-- delete the rows, and a live user has lost every file while keeping their
-- account.
--
-- So the keys are written HERE, in the same transaction as the cascade, and the
-- objects are deleted afterwards. Either both the row deletion and this record
-- happened, or neither did. A crash at any point leaves a durable, replayable
-- worklist rather than an unknowable amount of orphaned storage.
--
-- DELIBERATELY NO FOREIGN KEY TO users. This table's entire purpose is to
-- outlive the user row; a FK would cascade the worklist away at exactly the
-- moment it becomes the only record of what still needs deleting.
CREATE TABLE pending_object_deletions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Kept for correlation and for the "zero objects remain for this user" check.
  -- Not a reference: see above.
  user_id     UUID        NOT NULL,
  object_key  TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Retry accounting, so a permanently failing key (a bucket that no longer
  -- exists, a malformed key) becomes visible instead of being retried forever
  -- in silence.
  attempts    INT         NOT NULL DEFAULT 0,
  last_error  TEXT,
  last_tried_at TIMESTAMPTZ
);

-- The reaper's query: oldest outstanding first.
CREATE INDEX pending_object_deletions_created_idx
  ON pending_object_deletions (created_at);

-- Deleting the same key twice is not an error, but recording it twice makes the
-- "nothing remains" assertion ambiguous.
CREATE UNIQUE INDEX pending_object_deletions_key_idx
  ON pending_object_deletions (object_key);
