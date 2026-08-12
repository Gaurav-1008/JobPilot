/**
 * Session resolution — the auth provider seam (P1.1.2).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ON THE PROVIDER DECISION
 *
 * architecture.md §22.1 settled on Supabase Auth, with the stated rationale
 * "if Postgres is already Supabase". P0.4.1 then stood up plain Postgres 16 in
 * docker-compose, so that premise no longer holds — and wiring Supabase Auth
 * requires a Supabase project that does not exist.
 *
 * Rather than guess, this module is the SEAM. Everything downstream depends on
 * `getSession()` and nothing else, so swapping the provider is one file:
 *
 *   dev      credential provider below — local Postgres, scrypt, signed cookie
 *   later    Supabase / NextAuth / Clerk — implement resolveSession() and go
 *
 * The dev provider is genuinely usable locally and in tests. It is NOT a
 * production auth system: no email verification, no password reset, no rate
 * limiting on login, no MFA. Do not ship it. See §22.2 — this decision is
 * back open.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * EC-P1-02: session expiry mid-mutation must return 401 and write nothing.
 * Handlers call requireSession() BEFORE any write, so a stale session cannot
 * half-persist.
 */

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

export interface Session {
  userId: string;
  email: string;
}

const COOKIE = "jobpilot_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s || s.length < 16) {
    // Invariant 3: missing config fails toward NOT working, never toward a
    // guessable signing key.
    throw new Error(
      "NEXTAUTH_SECRET is unset or too short. Set it in .env (>=16 chars).",
    );
  }
  return s;
}

/** `<payload>.<hmac>`, base64url. Payload is `${userId}:${email}:${expiresAt}`. */
export function signSession(session: Session, now = Date.now()): string {
  const expiresAt = now + MAX_AGE_SECONDS * 1000;
  const payload = Buffer.from(
    `${session.userId}:${session.email}:${expiresAt}`,
  ).toString("base64url");
  const mac = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

/** Returns null for anything malformed, mis-signed, or expired. Never throws. */
export function verifySessionToken(token: string, now = Date.now()): Session | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);

  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
  // Constant-time compare — a fast-exit strcmp leaks the signature byte by byte.
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const decoded = Buffer.from(payload, "base64url").toString("utf8");
  const sep = decoded.lastIndexOf(":");
  if (sep <= 0) return null;

  const expiresAt = Number(decoded.slice(sep + 1));
  if (!Number.isFinite(expiresAt) || expiresAt < now) return null;

  const rest = decoded.slice(0, sep);
  const idSep = rest.indexOf(":");
  if (idSep <= 0) return null;

  return { userId: rest.slice(0, idSep), email: rest.slice(idSep + 1) };
}

/** The single seam. Swap the body to change auth provider. */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

/**
 * Use at the top of every mutating handler. Throws {@link UnauthorizedError},
 * which the route error mapper turns into a 401 — before anything is written.
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return session;
}

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("Not signed in.");
    this.name = "UnauthorizedError";
  }
}

export const SESSION_COOKIE = COOKIE;
export const SESSION_MAX_AGE = MAX_AGE_SECONDS;
