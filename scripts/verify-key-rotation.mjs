/**
 * Step 3 of docs/runbooks/encryption-key-rotation.md (P7.4.4, EC-P7-27).
 *
 * Confirms that BOTH key versions decrypt during the rotation overlap, against
 * live rows. The edge case is `ENCRYPTION_KEY` rotated while requests are in
 * flight; under a rolling deploy the overlap lasts as long as the rollout, with
 * both versions serving at once. This is the check that says the overlap is
 * real rather than assumed.
 *
 * NEVER PRINTS A CREDENTIAL. It reports counts per key version and pass/fail
 * per row id. A verification script that dumps what it decrypted in order to
 * prove it decrypted is a credential in a terminal scrollback and, more often,
 * in a CI log.
 *
 *   node --env-file=.env scripts/verify-key-rotation.mjs
 *
 * Exit code 1 if any row fails, so it can gate a deploy step.
 */

import { createDecipheriv } from "node:crypto";
import { PrismaClient } from "@prisma/client";

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

/** Mirrors keyFor() in lib/outreach/crypto.ts: version-specific wins. */
function keyFor(version, currentVersion) {
  const specific = process.env[`ENCRYPTION_KEY_V${version}`];
  if (specific?.trim()) return parseKey(specific, `ENCRYPTION_KEY_V${version}`);
  if (version === currentVersion) {
    const current = process.env.ENCRYPTION_KEY;
    if (!current?.trim()) throw new Error("ENCRYPTION_KEY is not set.");
    return parseKey(current, "ENCRYPTION_KEY");
  }
  throw new Error(
    `No key for version ${version}. Set ENCRYPTION_KEY_V${version} — without ` +
      "it, rows written before the last rotation cannot be read.",
  );
}

const currentVersion = Number(process.env.ENCRYPTION_KEY_VERSION ?? 1);

/**
 * THE CHECK THAT WOULD HAVE PREVENTED A REAL DATA LOSS.
 *
 * A rotation is only an overlap if the two keys DIFFER. Set ENCRYPTION_KEY_V1
 * to the same value as ENCRYPTION_KEY and you have performed an in-place swap
 * while every variable looks correctly configured: three env vars set, version
 * bumped, V1 present. Nothing about the shape of it is wrong.
 *
 * This happened. A script meant to preserve the outgoing key wrote the incoming
 * one into both slots, and the first symptom was every stored credential
 * failing to authenticate — by which point the old key existed nowhere.
 *
 * Checked BEFORE any row is read, because the entire point is to fail while
 * the old key is still recoverable from wherever it currently lives.
 */
for (const [name, value] of Object.entries(process.env)) {
  if (!/^ENCRYPTION_KEY_V\d+$/.test(name)) continue;
  if (value?.trim() && value.trim() === process.env.ENCRYPTION_KEY?.trim()) {
    console.error(
      `\nREFUSING TO CONTINUE: ${name} is identical to ENCRYPTION_KEY.\n\n` +
      "  That is an in-place swap wearing an overlap's clothes. The outgoing key\n" +
      "  is not saved anywhere, and every row written under it becomes\n" +
      "  permanently unreadable the moment it leaves your shell history.\n\n" +
      `  Recover the previous key and set ${name} to it — NOT to the new one.\n` +
      "  docs/runbooks/encryption-key-rotation.md\n",
    );
    process.exit(2);
  }
}

const prisma = new PrismaClient();

const rows = await prisma.senderCredential.findMany({
  select: { userId: true, ciphertext: true, iv: true, authTag: true, keyVersion: true },
});

if (rows.length === 0) {
  console.log("No stored credentials. Nothing to verify.");
  await prisma.$disconnect();
  process.exit(0);
}

const byVersion = new Map();
let failures = 0;

for (const row of rows) {
  const bucket = byVersion.get(row.keyVersion) ?? { ok: 0, failed: 0 };
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      keyFor(row.keyVersion, currentVersion),
      row.iv,
    );
    decipher.setAuthTag(row.authTag);
    // Consume the plaintext without binding it: a GCM auth failure throws on
    // final(), which is the whole signal. The value itself is never needed.
    decipher.update(row.ciphertext);
    decipher.final();
    bucket.ok += 1;
  } catch (err) {
    bucket.failed += 1;
    failures += 1;
    // The user id, not the credential. Enough to find the row, nothing to leak.
    console.error(`FAIL  user=${row.userId} keyVersion=${row.keyVersion}: ${err.message}`);
  }
  byVersion.set(row.keyVersion, bucket);
}

console.log(`\nCurrent ENCRYPTION_KEY_VERSION: ${currentVersion}`);
console.log(`Rows: ${rows.length}\n`);
for (const [version, { ok, failed }] of [...byVersion.entries()].sort()) {
  const marker = failed > 0 ? "✗" : "✓";
  console.log(`  ${marker} v${version}: ${ok} decrypted, ${failed} failed`);
}

const stragglers = byVersion.get(currentVersion === 1 ? 0 : currentVersion - 1);
if (failures === 0 && stragglers && stragglers.ok > 0) {
  console.log(
    `\n${stragglers.ok} row(s) still on the previous key. Run ` +
      "`npm run rotate:credentials`, then re-run this before retiring it.",
  );
} else if (failures === 0) {
  console.log("\nAll rows decrypt. Safe to proceed.");
}

await prisma.$disconnect();
process.exit(failures > 0 ? 1 : 0);
