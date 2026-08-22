# Runbook — rotating `ENCRYPTION_KEY`

**P7.4.4 · EC-P7-27 · EC-P5-67 ·** [architecture.md §14.4](../architecture.md) ·
[implementation-plan.md](../implementation-plan.md#p74--deployment)

`ENCRYPTION_KEY` protects one thing: the sender credentials in
`sender_credentials` — SMTP app passwords and Gmail refresh tokens, sealed with
AES-256-GCM by [`lib/outreach/crypto.ts`](../../apps/web/lib/outreach/crypto.ts).

---

## The rule

> **Add a version. Never swap in place.**

Rotating in place bricks every stored credential. The new key cannot decrypt old
rows, and because GCM *authenticates* as well as encrypts, the failure is total
rather than partial — there is no garbled-but-recoverable state. Every user's
sending account silently stops working, and the first symptom is a `failed`
outreach row for someone who did nothing wrong.

Every row therefore records the key version that encrypted it, and
`decryptCredential()` resolves the key **from the row**, never from the current
setting. This is what makes an overlap window possible.

### Why an overlap window is not optional (EC-P7-27)

The edge case is `ENCRYPTION_KEY` rotated *while requests are in flight*. Even a
perfectly atomic deploy has a window: a request that read a credential row a
moment before the swap will decrypt it a moment after. Under a rolling deploy
the window is not milliseconds but the length of the whole rollout, with both
versions serving simultaneously.

So both keys must decrypt for the duration. That is not a nicety of this
procedure — it is the procedure.

---

## Rotation

### 1 · Generate the new key

```bash
openssl rand -hex 32
```

32 bytes. The validator at startup rejects anything else
([`lib/config/require-env.ts`](../../apps/web/lib/config/require-env.ts)), which
is deliberate: a wrong-length key fails identically to a missing one, and both
would otherwise surface as a failed send hours after the deploy.

### 2 · Publish the new key alongside the old one

Set **all three**, together, in one config change:

| Variable | Value |
|----------|-------|
| `ENCRYPTION_KEY_V1` | the **current** key, verbatim |
| `ENCRYPTION_KEY` | the **new** key |
| `ENCRYPTION_KEY_VERSION` | `2` |

`ENCRYPTION_KEY_V1` is what keeps existing rows readable. Setting the other two
without it is the in-place swap this runbook exists to prevent.

> A version-specific variable wins over `ENCRYPTION_KEY` when both are set, so a
> half-finished rotation cannot silently decrypt with the wrong key
> (`keyFor()` in `crypto.ts`).

### 3 · Deploy, and confirm the overlap

After the rollout, both key versions must decrypt. Confirm it against live
data rather than assuming:

```bash
npm run verify:key-rotation
```

This reads every `sender_credentials` row, decrypts it with the key its own
`key_version` names, and reports the version spread. It never prints a
credential — only counts per version. **Do not proceed while any row fails.**

### 4 · Re-encrypt in the background

```bash
npm run rotate:credentials
```

Reads each row, decrypts under its recorded version, re-seals under the current
one. Idempotent and resumable: rows already at the current version are skipped,
so an interrupted run is re-run rather than repaired.

Users are unaffected — a re-encrypted credential decrypts identically.

### 5 · Retire the old key

Only once step 3 reports **zero** rows at version 1:

- remove `ENCRYPTION_KEY_V1`
- keep `ENCRYPTION_KEY` and `ENCRYPTION_KEY_VERSION=2`

Removing it earlier makes every remaining v1 row permanently unreadable. There
is no recovery — that is what an authenticated cipher with a discarded key
means.

---

## If a credential will not decrypt

Symptom: interlock check 11 blocks with *"Your sending account has not passed
its connection check"*, or `openSecret()` throws.

| Cause | Check | Fix |
|-------|-------|-----|
| Old key not published | Is `ENCRYPTION_KEY_V1` set? | Set it and redeploy. Rows are intact and still readable. |
| Version not bumped | `ENCRYPTION_KEY_VERSION` still `1` while `ENCRYPTION_KEY` holds the new key | This is the in-place swap. Restore the old key to `ENCRYPTION_KEY` immediately; nothing is lost, because the rows were never rewritten. |
| Old key discarded | `ENCRYPTION_KEY_V1` unrecoverable, rows still at v1 | Unrecoverable. Clear the affected rows so users re-enter credentials — a visible, actionable failure beats a permanent silent block. |
| **`V1` set to the NEW key** | `ENCRYPTION_KEY_V1` == `ENCRYPTION_KEY` | An in-place swap wearing an overlap's clothes. Both `npm run verify:key-rotation` and service startup now REFUSE on this — but only the old key can undo it. See below. |

### The failure this runbook did not previously describe

It is possible to perform every step correctly and still destroy the old key,
by writing the **new** key into `ENCRYPTION_KEY_V1` instead of the outgoing one.
Nothing looks wrong: three variables set, version bumped, `V1` present. The
first symptom is `Unsupported state or unable to authenticate data` on every
credential — at which point the old key exists nowhere.

This happened once, during Phase 7, to exactly one stored credential. It was
caused by automating step 2 with a script that read `ENCRYPTION_KEY` after
overwriting it rather than before.

Two guards now exist, and both fail while the old key may still be recoverable:

- `npm run verify:key-rotation` exits non-zero **before reading any row**
- ① and ③ refuse to boot (`lib/config/require-env.ts`)

**Do step 2 by hand.** It is three variables. The minute saved by scripting it
is not worth the failure mode, and the guards above only catch the case where
the two values are identical — not the case where `V1` is set to some third,
wrong value.

**Never** delete `sender_credentials` rows to "fix" a decryption error before
confirming which of these applies. A key that is merely unpublished is a config
change away from working.

---

## What rotation does *not* cover

`ENCRYPTION_KEY` protects sender credentials only. It is **not** used for:

- Supabase session JWTs — rotated in Supabase, independent of this
- `WORKER_SERVICE_TOKEN` — a shared secret with no stored ciphertext; rotate by
  setting it on ④ and ① together, ④ first, since ④ accepts the token it is
  given while ① is the one that presents it
- object storage — server-side encryption, managed by the provider

Rotating those is a separate change with a different blast radius, and lumping
them into one "rotate the secrets" task is how a routine credential rotation
turns into an outage.
