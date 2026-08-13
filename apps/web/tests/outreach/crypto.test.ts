/**
 * Credential envelope (P5.5.1).
 *
 * The rotation case (EC-P5-67) is the one worth the most here: getting it wrong
 * is not a bug that shows up in testing, it is a bug that shows up months later
 * when someone rotates a key and every stored credential becomes unreadable at
 * once.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  currentKeyVersion,
  encryptionAvailable,
  openSecret,
  sealSecret,
  EncryptionUnavailableError,
} from "@/lib/outreach/crypto";

const KEY_V1 = "a".repeat(64);
const KEY_V2 = "b".repeat(64);

const saved = { ...process.env };

beforeEach(() => {
  process.env.ENCRYPTION_KEY = KEY_V1;
  process.env.ENCRYPTION_KEY_VERSION = "1";
  delete process.env.ENCRYPTION_KEY_V1;
  delete process.env.ENCRYPTION_KEY_V2;
});

afterEach(() => {
  process.env = { ...saved };
});

const secret = {
  provider: "smtp" as const,
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpUser: "me@example.com",
  smtpPassword: "hunter2-app-password",
  senderName: "Gaurav K",
};

describe("credential envelope", () => {
  it("round-trips a secret", () => {
    const envelope = sealSecret(secret);
    expect(openSecret(envelope)).toEqual(secret);
  });

  it("never leaves the password in the ciphertext", () => {
    const envelope = sealSecret(secret);
    expect(envelope.ciphertext.toString("utf8")).not.toContain("hunter2");
    expect(envelope.ciphertext.toString("base64")).not.toContain("hunter2");
  });

  it("uses a fresh IV per record", () => {
    // Reusing an IV under one key is the catastrophic GCM failure mode.
    const a = sealSecret(secret);
    const b = sealSecret(secret);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("rejects a tampered ciphertext rather than returning garbage", () => {
    const envelope = sealSecret(secret);
    envelope.ciphertext[0] ^= 0xff;
    expect(() => openSecret(envelope)).toThrow();
  });

  it("rejects a tampered auth tag", () => {
    const envelope = sealSecret(secret);
    envelope.authTag[0] ^= 0xff;
    expect(() => openSecret(envelope)).toThrow();
  });

  it("stamps the current key version on every record", () => {
    expect(sealSecret(secret).keyVersion).toBe(1);
    process.env.ENCRYPTION_KEY_VERSION = "2";
    process.env.ENCRYPTION_KEY = KEY_V2;
    expect(currentKeyVersion()).toBe(2);
    expect(sealSecret(secret).keyVersion).toBe(2);
  });

  it("still decrypts old rows after a key rotation (EC-P5-67)", () => {
    // Written under v1…
    const old = sealSecret(secret);
    expect(old.keyVersion).toBe(1);

    // …then the key rotates, with v1 retained for decryption.
    process.env.ENCRYPTION_KEY = KEY_V2;
    process.env.ENCRYPTION_KEY_VERSION = "2";
    process.env.ENCRYPTION_KEY_V1 = KEY_V1;

    // The old row must still open, and new rows use the new key.
    expect(openSecret(old)).toEqual(secret);
    expect(sealSecret(secret).keyVersion).toBe(2);
  });

  it("fails loudly when an old key was dropped instead of retained", () => {
    const old = sealSecret(secret);
    process.env.ENCRYPTION_KEY = KEY_V2;
    process.env.ENCRYPTION_KEY_VERSION = "2";
    // ENCRYPTION_KEY_V1 deliberately absent — the mistake this test documents.
    expect(() => openSecret(old)).toThrow(EncryptionUnavailableError);
  });

  it("refuses to operate with no key at all (invariant 3)", () => {
    delete process.env.ENCRYPTION_KEY;
    expect(encryptionAvailable()).toBe(false);
    // Never a silent plaintext fallback.
    expect(() => sealSecret(secret)).toThrow(EncryptionUnavailableError);
  });

  it("rejects a key that is not 32 bytes", () => {
    process.env.ENCRYPTION_KEY = "tooshort";
    expect(encryptionAvailable()).toBe(false);
    expect(() => sealSecret(secret)).toThrow(/32 bytes/);
  });
});
