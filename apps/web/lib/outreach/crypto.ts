/**
 * Envelope encryption for sender credentials (P5.5.1, architecture.md §14.4).
 *
 * AES-256-GCM. GCM rather than CBC because it authenticates as well as
 * encrypts: a tampered ciphertext fails to decrypt instead of yielding
 * plausible garbage that then gets handed to an SMTP server.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EC-P5-67 — WHY EVERY ROW CARRIES A KEY VERSION.
 *
 * Rotating `ENCRYPTION_KEY` in place bricks every stored credential: the new
 * key cannot decrypt old rows, and because GCM authenticates, the failure is
 * total rather than partial. Each row therefore records which key encrypted it,
 * and old keys stay readable through `ENCRYPTION_KEY_V<n>`.
 *
 * Rotation is then: publish the new key, bump ENCRYPTION_KEY_VERSION, keep the
 * old one as ENCRYPTION_KEY_V1. New writes use the new key; old rows still
 * decrypt; nothing needs a migration window.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Invariant 3: with no key configured, this module throws rather than falling
 * back to storing anything in the clear. The visible consequence is that
 * credentials cannot be saved and interlock check 11 blocks every real send —
 * dry-run still works. Failing toward "cannot send" is the whole point.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
/** 96 bits is the GCM-recommended nonce size; longer gets re-hashed internally. */
const IV_BYTES = 12;
const KEY_BYTES = 32;

export class EncryptionUnavailableError extends Error {
  readonly code = "ENCRYPTION_UNAVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "EncryptionUnavailableError";
  }
}

/** Accepts 64-char hex or base64; anything not decoding to 32 bytes is rejected. */
function parseKey(raw: string, label: string): Buffer {
  const trimmed = raw.trim();
  const buffer = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");

  if (buffer.length !== KEY_BYTES) {
    throw new EncryptionUnavailableError(
      `${label} must be 32 bytes (64 hex chars or base64). Generate one with: ` +
        "openssl rand -hex 32",
    );
  }
  return buffer;
}

export function currentKeyVersion(): number {
  const version = Number(process.env.ENCRYPTION_KEY_VERSION ?? 1);
  return Number.isInteger(version) && version > 0 ? version : 1;
}

/**
 * Resolve the key for a version.
 *
 * The current version reads ENCRYPTION_KEY; older versions read
 * ENCRYPTION_KEY_V<n>. A version-specific variable wins if both are set, so a
 * half-finished rotation cannot silently decrypt with the wrong key.
 */
function keyFor(version: number): Buffer {
  const specific = process.env[`ENCRYPTION_KEY_V${version}`];
  if (specific?.trim()) return parseKey(specific, `ENCRYPTION_KEY_V${version}`);

  if (version === currentKeyVersion()) {
    const current = process.env.ENCRYPTION_KEY;
    if (!current?.trim()) {
      throw new EncryptionUnavailableError(
        "ENCRYPTION_KEY is not set, so sending credentials cannot be stored. " +
          "Generate one with `openssl rand -hex 32` and add it to .env.",
      );
    }
    return parseKey(current, "ENCRYPTION_KEY");
  }

  throw new EncryptionUnavailableError(
    `No key available for version ${version}. Set ENCRYPTION_KEY_V${version} ` +
      "to decrypt credentials written before the last rotation.",
  );
}

/** True when credentials can be stored at all — used to explain the block. */
export function encryptionAvailable(): boolean {
  try {
    keyFor(currentKeyVersion());
    return true;
  } catch {
    return false;
  }
}

export interface Envelope {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
}

/** Encrypt a credential blob (JSON) under the current key. */
export function encryptCredential(plaintext: string): Envelope {
  const keyVersion = currentKeyVersion();
  const key = keyFor(keyVersion);
  // A fresh random IV per record. Reusing one under the same key is the
  // catastrophic GCM failure — it leaks the XOR of the plaintexts.
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return { ciphertext, iv, authTag: cipher.getAuthTag(), keyVersion };
}

/**
 * Decrypt using the version recorded ON THE ROW, never the current version.
 *
 * A GCM auth failure throws, which is correct: an unauthenticated credential is
 * not a credential. Callers treat the throw as "no usable credential" and let
 * check 11 block the send.
 */
export function decryptCredential(envelope: Envelope): string {
  const key = keyFor(envelope.keyVersion);
  const decipher = createDecipheriv(ALGORITHM, key, envelope.iv);
  decipher.setAuthTag(envelope.authTag);
  return Buffer.concat([
    decipher.update(envelope.ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

/** What actually lives inside the envelope. Never logged, never returned to a client. */
export interface SenderSecret {
  provider: "smtp" | "gmail_api";
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpUser?: string | null;
  smtpPassword?: string | null;
  senderName?: string | null;
  /** Long-lived; exchanged for a short-lived access token at delivery. */
  gmailRefreshToken?: string | null;
}

export function sealSecret(secret: SenderSecret): Envelope {
  return encryptCredential(JSON.stringify(secret));
}

export function openSecret(envelope: Envelope): SenderSecret {
  return JSON.parse(decryptCredential(envelope)) as SenderSecret;
}
