/**
 * Session resolution — Supabase Auth (P1.1.1/P1.1.2, architecture.md §22.1).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS WORKS WITHOUT A HOSTED SUPABASE PROJECT
 *
 * §22.1 recorded "Supabase Auth" with the rationale "if Postgres is already
 * Supabase". P0.4.1 then stood up plain Postgres in docker-compose, which
 * looked like it invalidated the premise.
 *
 * It does not. Supabase Auth *is* GoTrue, and GoTrue runs against any Postgres
 * — including ours. docker-compose therefore runs GoTrue as the `auth` service
 * against the same database. The decision is honoured as recorded, with no
 * hosted project required.
 *
 * Moving to hosted Supabase later is a URL change, not a rewrite: point
 * NEXT_PUBLIC_SUPABASE_URL at the project and drop the local `auth` service.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * IDENTITY MAPPING. GoTrue owns `auth.users`; the platform owns `public.users`
 * (architecture.md §7.2). We reuse the GoTrue UUID as our primary key, so the
 * two never diverge and no mapping table is needed. `ensureUser()` below
 * upserts our row on first authenticated request — chosen over the more
 * idiomatic Postgres trigger on `auth.users` because it works identically
 * against hosted Supabase and self-hosted GoTrue, and is testable without a
 * cross-schema fixture.
 *
 * EC-P1-02: session expiry mid-mutation returns 401 and writes nothing.
 * requireSession() runs before any write, so a stale session cannot
 * half-persist.
 *
 * EC-P1-03: GoTrue can return a user with no email (phone/anonymous sign-in).
 * `users.email` is NOT NULL and is the natural key, so those are rejected here
 * with a clear message rather than failing later on an insert.
 */

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { ensureUser } from "@/lib/db/users";

export interface Session {
  userId: string;
  email: string;
}

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = "Not signed in.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

function config() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    // Invariant 3: missing config fails toward NOT authenticating anyone.
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are unset. " +
        "Run `docker compose up -d auth` and copy .env.example.",
    );
  }
  return { url, key };
}

/**
 * Server-side Supabase client bound to the request's cookies.
 *
 * Cookie writes are wrapped: in a Server Component the cookie store is
 * read-only and throws. That is expected — the middleware refreshes the
 * session, so a failed write here is not an error worth propagating.
 */
export async function supabaseServer() {
  const { url, key } = config();
  const store = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) {
            store.set(name, value, options);
          }
        } catch {
          // Read-only cookie store (Server Component). Middleware handles refresh.
        }
      },
    },
  });
}

/**
 * The single seam every handler depends on.
 *
 * Uses getUser(), NOT getSession(): getSession() reads the cookie without
 * contacting the auth server, so a forged or tampered cookie would be trusted.
 * getUser() validates the JWT against GoTrue. The extra round trip is the point.
 */
export async function getSession(): Promise<Session | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const email = data.user.email;
  if (!email) return null;   // EC-P1-03

  return { userId: data.user.id, email };
}

/** Use at the top of every protected handler. Throws -> 401 before any write. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  await ensureUser(session.userId, session.email);
  return session;
}
