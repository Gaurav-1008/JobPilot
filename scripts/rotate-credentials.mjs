/**
 * Step 4 of docs/runbooks/encryption-key-rotation.md (P7.4.4, EC-P7-27).
 *
 * Re-encrypts every sender credential under the current key version, so the old
 * key can be retired. Reads each row, decrypts with the version RECORDED ON THE
 * ROW, re-seals with the current one.
 *
 * IDEMPOTENT AND RESUMABLE. Rows already at the current version are skipped, so
 * an interrupted run is re-run rather than repaired. That property is the
 * difference between a routine maintenance task and one nobody wants to start.
 *
 * ONE ROW PER TRANSACTION, deliberately. A single transaction over every
 * credential would be atomic but would hold locks across the whole table while
 * doing CPU-bound crypto; per-row means a failure leaves a mix of versions,
 * which is exactly the state the version column exists to make safe.
 *
 *   node --env-file=.env scripts/rotate-credentials.mjs
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

function parseKey(raw, label) {
  const trimmed = raw.trim();
  const buffer = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  if (buffer.length !== KEY_BYTES) {
    throw new Error(`${label} must be 32 bytes (64 hex chars or base64).`);
  }
  return buffer;
}

function keyFor(version, currentVersion) {
  const specific = process.env[`ENCRYPTION_KEY_V${version}`];
  if (specific?.trim()) return parseKey(specific, `ENCRYPTION_KEY_V${version}`);
  if (version === currentVersion) {
    const current = process.env.ENCRYPTION_KEY;
    if (!current?.trim()) throw new Error("ENCRYPTION_KEY is not set.");
    return parseKey(current, "ENCRYPTION_KEY");
  }
  throw new Error(`No key for version ${version}. Set ENCRYPTION_KEY_V${version}.`);
}

const currentVersion = Number(process.env.ENCRYPTION_KEY_VERSION ?? 1);
const currentKey = keyFor(currentVersion, currentVersion);
const prisma = new PrismaClient();

const stale = await prisma.senderCredential.findMany({
  where: { keyVersion: { not: currentVersion } },
  select: { userId: true, ciphertext: true, iv: true, authTag: true, keyVersion: true },
});

if (stale.length === 0) {
  console.log(`Every credential is already at v${currentVersion}. Nothing to do.`);
  await prisma.$disconnect();
  process.exit(0);
}

console.log(`Re-encrypting ${stale.length} credential(s) to v${currentVersion}…\n`);

let rotated = 0;
let failed = 0;

for (const row of stale) {
  try {
    const decipher = createDecipheriv(ALGORITHM, keyFor(row.keyVersion, currentVersion), row.iv);
    decipher.setAuthTag(row.authTag);
    const plaintext = Buffer.concat([decipher.update(row.ciphertext), decipher.final()]);

    // A FRESH IV. Reusing the row's existing IV under a new key would be
    // harmless, but reusing one under the SAME key is the catastrophic GCM
    // failure — it leaks the XOR of the plaintexts — and a rotation script is
    // the last place to establish a habit of carrying IVs forward.
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, currentKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

    await prisma.senderCredential.update({
      where: { userId: row.userId },
      data: {
        ciphertext,
        iv,
        authTag: cipher.getAuthTag(),
        keyVersion: currentVersion,
        // preflight_ok_at is deliberately UNTOUCHED. The credential is
        // byte-identical after re-encryption, so the connection check it
        // already passed is still valid. Clearing it would block every user's
        // sends behind a re-verification they have no reason to expect.
      },
    });
    rotated += 1;
  } catch (err) {
    failed += 1;
    console.error(`FAIL  user=${row.userId} v${row.keyVersion}: ${err.message}`);
  }
}

console.log(`\nRotated: ${rotated}   Failed: ${failed}`);
if (failed > 0) {
  console.log("Re-run after fixing. Rows already rotated are skipped.");
} else {
  console.log("Run `npm run verify:key-rotation` before retiring the old key.");
}

await prisma.$disconnect();
process.exit(failed > 0 ? 1 : 0);
