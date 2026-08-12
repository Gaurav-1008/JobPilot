-- ============================================================================
-- Auth credentials (P1.1.2).
--
-- A separate table rather than columns on `users`, for two reasons:
--
--   1. When the provider is swapped (architecture.md §22.2 — the Supabase
--      decision is back open, since the local stack is plain Postgres), this
--      table is DROPPED and `users` is untouched. Credentials are a property of
--      the auth provider, not of the domain user.
--   2. A JOIN is required to reach a password hash, so no accidental
--      `SELECT * FROM users` leaks it into a log or an API response.
-- ============================================================================

CREATE TABLE auth_credentials (
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- scrypt, stored as `scrypt$N$r$p$<salt-b64>$<hash-b64>`. Parameters live in
  -- the string so they can be raised later without invalidating old rows.
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
