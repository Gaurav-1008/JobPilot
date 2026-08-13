/**
 * Sender credential persistence (P5.5.1, architecture.md §14.4).
 *
 * Plaintext credentials exist in exactly two places and nowhere else: inside
 * this module's function bodies, and inside one ④ request. They are never
 * returned to a client, never logged, and never stored unencrypted.
 *
 * Note what is deliberately absent: there is no `getCredentialForDisplay`. The
 * UI shows whether an account is connected and whether it passed preflight —
 * never the values. A "reveal password" affordance would put the secret in a
 * response body, a browser cache, and probably a screenshot.
 */

import { openSecret, sealSecret, type SenderSecret } from "@/lib/outreach/crypto";
import { grantAllowsSend, revokeToken } from "@/lib/outreach/google-oauth";
import { prisma } from "../client";

export interface SaveCredentialInput {
  userId: string;
  secret: SenderSecret;
  /** EC-P5-65: what the OAuth consent actually granted. Null for SMTP. */
  grantedScopes?: string | null;
}

/**
 * Store (or replace) the user's sending credential.
 *
 * `preflightOkAt` is explicitly NULL on every write. New credentials are
 * unverified by definition, and interlock check 11 refuses to send without a
 * successful preflight — so replacing a working password with a typo blocks
 * sending rather than failing at the provider (EC-P5-63).
 */
export async function saveCredential(input: SaveCredentialInput) {
  const envelope = sealSecret(input.secret);

  return prisma.senderCredential.upsert({
    where: { userId: input.userId },
    create: {
      userId: input.userId,
      provider: input.secret.provider,
      ciphertext: envelope.ciphertext,
      iv: envelope.iv,
      authTag: envelope.authTag,
      keyVersion: envelope.keyVersion,
      grantedScopes: input.grantedScopes ?? null,
      preflightOkAt: null,
    },
    update: {
      provider: input.secret.provider,
      ciphertext: envelope.ciphertext,
      iv: envelope.iv,
      authTag: envelope.authTag,
      keyVersion: envelope.keyVersion,
      grantedScopes: input.grantedScopes ?? null,
      preflightOkAt: null,
    },
  });
}

/**
 * Decrypt the stored credential.
 *
 * Returns null rather than throwing when the row is missing OR undecryptable.
 * An undecryptable row (rotated key with the old one dropped, or a tampered
 * ciphertext) must behave exactly like "no credential": check 11 blocks, the
 * user is told to reconnect. Throwing here would surface a crypto error to
 * someone who can only act on "reconnect your account".
 */
export async function getDecryptedCredential(
  userId: string,
): Promise<(SenderSecret & { preflightOkAt: Date | null; grantedScopes: string | null }) | null> {
  const row = await prisma.senderCredential.findUnique({ where: { userId } });
  if (!row) return null;

  try {
    const secret = openSecret({
      ciphertext: Buffer.from(row.ciphertext),
      iv: Buffer.from(row.iv),
      authTag: Buffer.from(row.authTag),
      keyVersion: row.keyVersion,
    });
    return {
      ...secret,
      preflightOkAt: row.preflightOkAt,
      grantedScopes: row.grantedScopes,
    };
  } catch (err) {
    // Never log the row — only that it failed and why, by type.
    console.error(
      JSON.stringify({
        event: "credential.undecryptable",
        keyVersion: row.keyVersion,
        error: err instanceof Error ? err.name : "unknown",
      }),
    );
    return null;
  }
}

/** Record a successful preflight — the precondition for interlock check 11. */
export async function markPreflightOk(userId: string) {
  await prisma.senderCredential.updateMany({
    where: { userId },
    data: { preflightOkAt: new Date() },
  });
}

/**
 * EC-P5-63/64 — clear verification on ANY auth failure.
 *
 * The next send then blocks at check 11 with "reconnect your account" instead
 * of hammering a revoked app password or a withdrawn OAuth grant. Called from
 * the delivery path when the provider reports an auth failure.
 */
export async function clearPreflight(userId: string) {
  await prisma.senderCredential.updateMany({
    where: { userId },
    data: { preflightOkAt: null },
  });
}

/**
 * Disconnect the sending account.
 *
 * For Google, the grant is revoked at Google FIRST, then the row goes. Deleting
 * only our row would leave JobPilot listed in the user's third-party access
 * page indefinitely — the platform could no longer send, but the user's account
 * would still say it could, which is a promise broken quietly.
 *
 * Revocation is best-effort: the local row is deleted either way, because the
 * user's instruction was "stop being able to send" and that must not depend on
 * Google being reachable.
 */
export async function deleteCredential(userId: string) {
  const secret = await getDecryptedCredential(userId);
  if (secret?.provider === "gmail_api" && secret.gmailRefreshToken) {
    await revokeToken(secret.gmailRefreshToken);
  }
  await prisma.senderCredential.deleteMany({ where: { userId } });
}

/** Safe status for the settings screen. Contains no secret material. */
export async function credentialStatus(userId: string) {
  const row = await prisma.senderCredential.findUnique({
    where: { userId },
    select: {
      provider: true,
      preflightOkAt: true,
      grantedScopes: true,
      createdAt: true,
    },
  });
  if (!row) return null;
  return {
    provider: row.provider,
    preflightOk: row.preflightOkAt !== null,
    preflightOkAt: row.preflightOkAt?.toISOString() ?? null,
    // SMTP can always send and can never draft; Google is the reverse until
    // the send scope is granted (EC-P5-65).
    canSend: row.provider === "smtp" || grantAllowsSend(row.grantedScopes),
    canDraft: row.provider === "gmail_api",
    connectedAt: row.createdAt.toISOString(),
  };
}
