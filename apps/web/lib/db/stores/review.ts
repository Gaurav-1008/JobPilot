/**
 * Approval tokens and the atomic operations the interlock chain depends on
 * (P5.4.1, P5.4.2, P5.4.6, P5.4.7).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THERE IS RAW SQL IN HERE
 *
 * Three of these operations cannot be expressed safely through the ORM:
 *
 *   EC-P5-47  Expiry must be compared against the DATABASE's clock. An app
 *             server with a skewed clock would otherwise accept an expired
 *             token, or reject a fresh one — and with several instances the
 *             behavior depends on which one answered.
 *
 *   EC-P5-45  The token burn must be one conditional UPDATE. Read-then-write
 *             lets two concurrent deliveries both observe `token_used_at IS
 *             NULL` and both send. `UPDATE ... WHERE token_used_at IS NULL
 *             RETURNING` makes the database pick exactly one winner.
 *
 *   EC-P5-52  The volume cap is a TOCTOU race: two tabs both count N-1 and
 *             both proceed. A transaction-scoped advisory lock on the user
 *             serializes the count-and-reserve so the cap holds.
 *
 * All three are races that sequential tests pass and two browser tabs fail.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { createHash, randomBytes } from "node:crypto";

import { prisma } from "../client";

/** §14.3: 10 minutes. Long enough to re-read the email, short enough to matter. */
export const TOKEN_TTL_MINUTES = 10;

export interface MintedToken {
  /** Returned to the client ONCE. Only its hash is stored. */
  token: string;
  expiresInMinutes: number;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Mint an approval token bound to a specific body hash (P5.4.1, P5.4.2).
 *
 * The raw token is returned to the caller and never stored — only its sha256.
 * A database leak therefore yields no usable approvals, and the token behaves
 * like a password rather than a lookup key.
 *
 * Any previous approval for this attempt is deleted first: two live tokens for
 * one attempt would mean the "single-use" guarantee applies per token rather
 * than per approval, which is not what a human clicking Approve believes.
 */
export async function mintApprovalToken(
  userId: string,
  attemptId: string,
  subjectChosen: string,
  bodyHash: string,
): Promise<MintedToken> {
  const token = randomBytes(32).toString("hex");

  await prisma.$transaction(async (tx) => {
    await tx.reviewEvent.deleteMany({ where: { attemptId, userId } });
    // Expiry is computed by the DATABASE (EC-P5-47), not by this process.
    await tx.$executeRaw`
      INSERT INTO review_events
        (attempt_id, user_id, subject_chosen, body_hash, token_hash, token_expires_at)
      VALUES (
        ${attemptId}::uuid,
        ${userId}::uuid,
        ${subjectChosen},
        ${bodyHash},
        ${hashToken(token)},
        now() + (${TOKEN_TTL_MINUTES} || ' minutes')::interval
      )
    `;
  });

  return { token, expiresInMinutes: TOKEN_TTL_MINUTES };
}

export interface ValidReview {
  id: string;
  attemptId: string;
  bodyHash: string;
  subjectChosen: string;
}

/**
 * Interlock check 2 — read half.
 *
 * Existence, expiry, and un-usedness in ONE query, all evaluated by the
 * database. Returns null for every failure mode without distinguishing them:
 * telling a caller whether a token was wrong versus expired versus already
 * used is an oracle, and none of those answers changes what they should do.
 */
export async function findValidReview(
  userId: string,
  token: string,
): Promise<ValidReview | null> {
  const rows = await prisma.$queryRaw<
    { id: string; attempt_id: string; body_hash: string; subject_chosen: string }[]
  >`
    SELECT id, attempt_id, body_hash, subject_chosen
    FROM review_events
    WHERE token_hash = ${hashToken(token)}
      AND user_id = ${userId}::uuid
      AND token_used_at IS NULL
      AND token_expires_at > now()
    LIMIT 1
  `;
  const row = rows[0];
  return row
    ? {
        id: row.id,
        attemptId: row.attempt_id,
        bodyHash: row.body_hash,
        subjectChosen: row.subject_chosen,
      }
    : null;
}

/**
 * Burn the token (P5.4.7, EC-P5-44/45).
 *
 * The conditions are repeated here deliberately — this UPDATE, not the earlier
 * SELECT, is the authority. Between check 2 and here sit ten more checks, and
 * a concurrent request may have burned the token in that window. Returns false
 * when another request won, and the caller must treat that as a block.
 */
export async function burnToken(userId: string, token: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE review_events
    SET token_used_at = now()
    WHERE token_hash = ${hashToken(token)}
      AND user_id = ${userId}::uuid
      AND token_used_at IS NULL
      AND token_expires_at > now()
    RETURNING id
  `;
  return rows.length > 0;
}

/**
 * Interlock check 7 — the rolling 24h cap, counted and reserved atomically
 * (P5.4.6, EC-P5-52/53/54).
 *
 * Three things this gets right that the obvious implementation does not:
 *
 *   - It is a QUERY over `created_at`, not a counter. Counters do not survive
 *     restarts, and they diverge across tabs and devices.
 *   - The window is `now() - interval '24 hours'`, not "today". A calendar day
 *     in server-local time lets a user send 2N across midnight (EC-P5-54).
 *   - The count and the reservation share one transaction under an advisory
 *     lock keyed on the user, so two tabs cannot both read N-1 (EC-P5-52).
 *
 * The reservation is the status flip to `drafted`. That is a real state in the
 * CHECK constraint and it is what the count looks for, so a concurrent request
 * sees the slot taken immediately. If delivery then fails, the caller marks the
 * row `failed` and the slot returns.
 *
 * Over-reporting on a crash (a `drafted` row with no draft) is the SAFE
 * direction — EC-P5-59 is explicit that the audit trail must never under-report.
 */
export async function reserveCapSlot(
  userId: string,
  attemptId: string,
  cap: number,
): Promise<{ ok: boolean; used: number }> {
  return prisma.$transaction(async (tx) => {
    // Transaction-scoped: released on commit or rollback, no leak on error.
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${userId}::text))
    `;

    const rows = await tx.$queryRaw<{ count: bigint }[]>`
      SELECT count(*)::bigint AS count
      FROM outreach_attempts
      WHERE user_id = ${userId}::uuid
        AND status IN ('sent', 'drafted')
        AND created_at > now() - interval '24 hours'
    `;
    const used = Number(rows[0]?.count ?? 0);

    // EC-P5-53: N is allowed, N+1 is not. Asserted on both sides in the suite.
    if (used >= cap) return { ok: false, used };

    await tx.$executeRaw`
      UPDATE outreach_attempts
      SET status = 'drafted'
      WHERE id = ${attemptId}::uuid AND user_id = ${userId}::uuid
    `;
    return { ok: true, used };
  });
}

/** Release a reservation when delivery did not happen (see reserveCapSlot). */
export async function releaseCapSlot(
  userId: string,
  attemptId: string,
  check: string,
  message: string,
): Promise<void> {
  await prisma.outreachAttempt.updateMany({
    where: { id: attemptId, userId },
    data: { status: "failed", errorMessage: `${check}: ${message}` },
  });
}
