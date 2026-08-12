-- ============================================================================
-- JobPilot initial schema (P0.3.2)
--
-- Hand-written, NOT generated from schema.prisma. This is deliberate:
--
--   EC-P0-22  the partial unique index `one_default_resume_per_user` cannot be
--             expressed in Prisma's schema DSL.
--   EC-P0-23  CHECK constraints are likewise not expressible, and would be
--             silently dropped if Prisma ever regenerated the schema from its
--             own model.
--
-- The database is the LAST line of defence, not the only one. Application
-- validation (Zod) is the first. Both must exist: a bug in one is caught by the
-- other, and a direct psql session is only caught by this file.
--
-- Verify after any `prisma migrate` run that these objects still exist —
-- Prisma can drop objects it does not know about.
-- ============================================================================

-- EC-P0-20 / EC-P0-21: extensions FIRST. citext is used by every email column;
-- gen_random_uuid() needs pgcrypto below PG 13. On managed Postgres, confirm
-- both are on the allowed-extension list before relying on them.
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Identity ───────────────────────────────────────────────────────────────
CREATE TABLE users (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                CITEXT UNIQUE NOT NULL,
  -- Sender identity, hoisted out of The Closer's per-contact rows: these are
  -- properties of the sender, not of each recipient.
  candidate_name       TEXT,
  candidate_background TEXT,
  portfolio_url        TEXT,
  linkedin_url         TEXT,
  -- Safe defaults live in the schema, not only in .env. A row created by a
  -- migration, a seed, or a direct INSERT is still dry-run by default.
  dry_run              BOOLEAN NOT NULL DEFAULT TRUE,
  send_mode            TEXT    NOT NULL DEFAULT 'draft'
                       CHECK (send_mode IN ('draft', 'send')),
  max_outreach_per_day INT     NOT NULL DEFAULT 5
                       CHECK (max_outreach_per_day > 0 AND max_outreach_per_day <= 25),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Resume library (FR3) ───────────────────────────────────────────────────
CREATE TABLE resumes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version      INT  NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('master', 'tailored')),
  derived_from_run_id UUID,               -- FK added after tailoring_runs exists
  profile      JSONB NOT NULL,            -- ResumeProfile
  -- EC-P1-08 / P1.2.3: the original text is NEVER discarded. Every future
  -- re-parse with a better prompt, and every "the AI got my title wrong"
  -- complaint, depends on still having this.
  raw_text     TEXT  NOT NULL,
  file_key     TEXT,
  original_filename TEXT,                 -- EC-P1-18: display only, never a path
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- EC-P1-19: makes the concurrent-upload race a constraint violation the app
  -- can retry, rather than two rows silently sharing a version.
  UNIQUE (user_id, version)
);

-- EC-P0-22 / EC-P1-20: partial unique index. Turns "two tabs both set default"
-- into a violation instead of two defaults. Prisma cannot express this.
CREATE UNIQUE INDEX one_default_resume_per_user
  ON resumes (user_id) WHERE is_default;

-- ─── Discovery ──────────────────────────────────────────────────────────────
CREATE TABLE harvest_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_query    TEXT NOT NULL,
  location      TEXT,
  boards        TEXT[] NOT NULL,
  status        TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'running', 'complete', 'partial', 'failed')),
  -- Durable per-board progress. EC-P2-42/45: this is the SOURCE OF TRUTH for
  -- the UI; the SSE stream is an optimisation that may drop at any time.
  board_results JSONB NOT NULL DEFAULT '{}',
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ
);
-- EC-P2-30: lets the stale-run reaper find runs stuck in 'running'.
CREATE INDEX harvest_runs_stale ON harvest_runs (status, started_at)
  WHERE status = 'running';

CREATE TABLE jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  harvest_run_id   UUID NOT NULL REFERENCES harvest_runs(id) ON DELETE CASCADE,
  -- EC-P2-19: harvest_run_id is the run that FIRST saw this job. Because the
  -- upsert keeps the original row, a single FK could never answer "what did
  -- run 3 find?". last_seen_run_id closes that.
  last_seen_run_id UUID REFERENCES harvest_runs(id) ON DELETE SET NULL,
  -- These six are EXACTLY the harvester's jobs.csv columns, so the board
  -- adapters need no rewrite.
  source           TEXT NOT NULL
                   CHECK (source IN ('naukri', 'remoteok', 'wellfound', 'manual')),
  title            TEXT NOT NULL,
  company          TEXT NOT NULL,
  location         TEXT,
  link             TEXT NOT NULL,
  posted_at        TEXT,                  -- verbatim: "2 days ago", "Today"
  -- EC-P2-51: best-effort and NULLABLE. A job row must never fail because a
  -- board's date string did not parse.
  posted_at_parsed TIMESTAMPTZ,
  dedupe_key       TEXT NOT NULL,
  hydration_status TEXT NOT NULL DEFAULT 'pending'
                   CHECK (hydration_status IN ('pending', 'hydrated', 'failed', 'blocked')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- FR1 / EC-P2-26: dedupe works ACROSS runs, and is scoped per user — without
-- user_id here, one user's harvest would silently suppress another's jobs.
CREATE UNIQUE INDEX jobs_dedupe ON jobs (user_id, dedupe_key);
CREATE INDEX jobs_by_run ON jobs (harvest_run_id);
CREATE INDEX jobs_by_user_status ON jobs (user_id, hydration_status);

-- ─── Hydration (closes Breakage 1) ──────────────────────────────────────────
CREATE TABLE job_descriptions (
  job_id            UUID PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  raw_text          TEXT NOT NULL,
  extraction_method TEXT NOT NULL
                    CHECK (extraction_method IN ('firecrawl', 'playwright', 'manual_paste')),
  profile           JSONB NOT NULL,       -- JobDescriptionProfile
  extracted_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cross-user cache. A job posting is PUBLIC content, so sharing it reduces load
-- on the source sites for everyone.
--
-- EC-P3-05: manual pastes MUST NOT be written here. A paste is whatever the
-- user typed and carries no public-content guarantee. The cache is for
-- machine-fetched public pages only. "Cache more things" is the natural and
-- wrong instinct at this table.
--
-- EC-P3-02: fetched_at gates REFRESH eligibility. Entries are never evicted —
-- an evicted entry means a JD we can no longer show for an old application.
CREATE TABLE jd_cache (
  url_hash   TEXT PRIMARY KEY,            -- sha256(normalised url)
  url        TEXT NOT NULL,
  raw_text   TEXT NOT NULL,
  method     TEXT NOT NULL CHECK (method IN ('firecrawl', 'playwright')),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── System of record (closes Breakage 3) ───────────────────────────────────
CREATE TABLE applications (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id                  UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status                  TEXT NOT NULL DEFAULT 'saved' CHECK (status IN
                          ('saved', 'scored', 'tailored', 'contact_added',
                           'emailed', 'replied', 'interviewing', 'rejected', 'closed')),
  active_tailoring_run_id UUID,           -- FK added after tailoring_runs
  -- EC-P1-23: RESTRICT, not CASCADE. FR3's whole point is answering "which
  -- resume did I actually send to this company?" — deleting the resume must
  -- not silently erase the answer.
  resume_id               UUID REFERENCES resumes(id) ON DELETE RESTRICT,
  original_score          INT CHECK (original_score BETWEEN 0 AND 100),
  tailored_score          INT CHECK (tailored_score BETWEEN 0 AND 100),
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- EC-P4-23: makes concurrent score-batch runs an upsert, not duplicates.
  UNIQUE (user_id, job_id)
);
CREATE INDEX applications_by_status ON applications (user_id, status);

-- ─── Tailoring (shapes unchanged; now persisted) ────────────────────────────
CREATE TABLE tailoring_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id   UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  resume_id        UUID NOT NULL REFERENCES resumes(id) ON DELETE RESTRICT,
  -- EC-P4-25: which tier produced this score. Sorting across mixed tiers is
  -- approximate, and the UI badge depends on this column.
  tier             TEXT NOT NULL CHECK (tier IN ('heuristic', 'cheap', 'full')),
  match_score      JSONB NOT NULL,
  tailored_resume  JSONB,                 -- NULL for scoring-only (cheap) runs
  gaps             JSONB NOT NULL DEFAULT '[]',
  bullet_changes   JSONB NOT NULL DEFAULT '[]',
  -- EC-P1-40: blocked rewrites are stored here as rejected-with-reason. They
  -- are never silently dropped — that is the failure mode this column exists
  -- to prevent.
  guardrail_report JSONB NOT NULL DEFAULT '{}',
  model            TEXT NOT NULL,
  -- EC-P1-31/32: reproducibility. Without this, "why did it say that?" about a
  -- two-week-old run is unanswerable. Derive from a content hash of the prompt
  -- file, not a hand-maintained string — humans forget, hashes do not.
  prompt_version   TEXT NOT NULL,
  token_usage      JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tailoring_runs_by_application ON tailoring_runs (application_id, created_at DESC);

-- Deferred FKs, now that tailoring_runs exists.
ALTER TABLE applications
  ADD CONSTRAINT applications_active_run_fk
  FOREIGN KEY (active_tailoring_run_id) REFERENCES tailoring_runs(id) ON DELETE SET NULL;
ALTER TABLE resumes
  ADD CONSTRAINT resumes_derived_from_run_fk
  FOREIGN KEY (derived_from_run_id) REFERENCES tailoring_runs(id) ON DELETE SET NULL;

CREATE TABLE exported_documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tailoring_run_id UUID NOT NULL REFERENCES tailoring_runs(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('tailored_resume', 'side_by_side')),
  file_key         TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- EC-P1-35: dedupe concurrent exports of the same run.
  UNIQUE (tailoring_run_id, kind)
);

-- ─── Outreach (closes Breakage 2) ───────────────────────────────────────────
CREATE TABLE contacts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id       UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  recipient_email      CITEXT NOT NULL,
  recipient_name       TEXT,
  -- ADR-008 / EC-P5-07: provenance is MANDATORY and has NO DEFAULT. Every
  -- contact must declare where it came from. 'public_profile' is deliberately
  -- absent: at review time it is indistinguishable from scraped-individual
  -- sourcing, which defeats the point of recording provenance at all.
  source               TEXT NOT NULL CHECK (source IN
                       ('user_entered', 'company_careers_page', 'imported_csv')),
  personalization_note TEXT,
  linkedin_url         TEXT,
  suppressed           BOOLEAN NOT NULL DEFAULT FALSE,
  suppression_reason   TEXT CHECK (suppression_reason IN
                       ('opt_out', 'already_contacted', 'invalid')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, application_id, recipient_email)
);
-- EC-P5-50: dedup must key on the PERSON, not the contact row. The same
-- recruiter across five applications is five contact rows; without this index
-- the cap and dedup both read as compliant while one human gets five emails.
CREATE INDEX contacts_by_email ON contacts (user_id, recipient_email);

CREATE TABLE opt_out_entries (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email      CITEXT NOT NULL,
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, email)
);

-- ─── The human gate (P5.4) ──────────────────────────────────────────────────
-- EC-P5-43/48: approval binds to SPECIFIC CONTENT. body_hash is the hash of
-- exactly the bytes that will be handed to the provider. Without it, a client
-- could approve benign copy and deliver something else.
CREATE TABLE review_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id       UUID NOT NULL,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  subject_chosen   TEXT NOT NULL,
  body_hash        TEXT NOT NULL,
  token_hash       TEXT NOT NULL UNIQUE,
  -- EC-P5-47: compared against the DATABASE's now(), never an app server's
  -- clock, so instance skew cannot expire or extend a token.
  token_expires_at TIMESTAMPTZ NOT NULL,
  -- EC-P5-44/45: single use. The burn is
  --   UPDATE ... WHERE token_used_at IS NULL RETURNING
  -- so two concurrent deliveries cannot both win.
  token_used_at    TIMESTAMPTZ
);

CREATE TABLE outreach_attempts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- EC-P6-24: nullable ONLY so The Closer's outreach_log.csv can be imported —
  -- that file has no application and no contact. With NOT NULL here the legacy
  -- import (P6.4.2) could not insert a single row. The CHECK below keeps
  -- platform rows complete.
  application_id        UUID REFERENCES applications(id) ON DELETE CASCADE,
  contact_id            UUID REFERENCES contacts(id) ON DELETE CASCADE,
  origin                TEXT NOT NULL DEFAULT 'platform'
                        CHECK (origin IN ('platform', 'legacy_import')),
  parent_id             UUID REFERENCES outreach_attempts(id) ON DELETE SET NULL,
  subject               TEXT NOT NULL,
  body_snapshot         TEXT,             -- what was actually sent
  body_hash             TEXT,
  word_count            INT NOT NULL DEFAULT 0,
  generation_source     TEXT NOT NULL CHECK (generation_source IN ('template', 'llm')),
  status                TEXT NOT NULL CHECK (status IN
                        ('generated', 'drafted', 'sent', 'skipped', 'failed')),
  provider              TEXT NOT NULL CHECK (provider IN ('dry_run', 'smtp', 'gmail_api')),
  provider_message_id   TEXT,
  -- EC-P5-59: stamped BEFORE the provider call. A burned token plus a lost
  -- response otherwise leaves a 'failed' row while a real draft exists — the
  -- one direction in which the audit trail can under-report.
  provider_attempted_at TIMESTAMPTZ,
  error_message         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT platform_rows_are_complete CHECK (
    origin = 'legacy_import' OR (
      application_id IS NOT NULL AND
      contact_id     IS NOT NULL AND
      body_snapshot  IS NOT NULL AND
      body_hash      IS NOT NULL
    )
  )
);
-- EC-P5-52/54: the volume cap is a rolling-window QUERY, not a counter. A
-- counter would not survive restarts, concurrent tabs, or multiple devices.
CREATE INDEX outreach_cap_window ON outreach_attempts (user_id, created_at)
  WHERE status IN ('sent', 'drafted');
-- EC-P5-51: dedup considers only sent/drafted. A failed or skipped attempt
-- must not permanently lock out a contact.
CREATE INDEX outreach_dedupe ON outreach_attempts (user_id, contact_id, status);
-- EC-P6-11: the follow-up sweep keys off SENT attempts, never off
-- applications.status='emailed' — which includes drafts never sent.
CREATE INDEX outreach_sent_for_sweep ON outreach_attempts (user_id, created_at)
  WHERE status = 'sent';

-- ─── Per-user credentials ───────────────────────────────────────────────────
CREATE TABLE sender_credentials (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL CHECK (provider IN ('smtp', 'gmail_api')),
  ciphertext      BYTEA NOT NULL,         -- AES-256-GCM envelope
  iv              BYTEA NOT NULL,
  auth_tag        BYTEA NOT NULL,
  -- EC-P5-67 / EC-P7-27: rotation needs versioning. Swapping the key in place
  -- without this column bricks every stored credential.
  key_version     INT NOT NULL,
  -- EC-P5-63: interlock check 11 reads this. Cleared on any auth failure so a
  -- revoked app password blocks at the gate rather than failing at the provider.
  preflight_ok_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
