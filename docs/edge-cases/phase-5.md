# Phase 5 — Edge Cases

**Evidence-seeded outreach** · [plan](../implementation-plan.md#phase-5--evidence-seeded-outreach) · [index](./README.md)

The phase where software acts on a real person's behalf, under their name, into a stranger's inbox. Every case marked 🔴 here is a case where the wrong behavior is *sending something that should not have been sent* — and unlike every other bug in this project, that one cannot be rolled back.

Read this file before P5.1, not before P5.5.

**68 cases.** 🔴 must-handle · 🟠 should-handle · 🟡 polish

---

## P5.1 — Contacts

### Address handling

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P5-01 | 🟠 | Address pasted with surrounding whitespace, a `mailto:` prefix, or as `Priya <priya@x.com>` | Normalize on ingest: strip, unwrap display-name form, lowercase the domain. Store the normalized value; a stray space defeats every dedup and opt-out check downstream | P5.1.1 |
| EC-P5-02 | 🟠 | Plus-addressing: `careers+jobs@x.com` | Valid; keep it intact. Do **not** strip the `+` tag — for opt-out matching that would be over-broad | P5.1.1 |
| EC-P5-03 | 🟠 | Unicode local part or IDN domain | Accept; normalize the domain to punycode for comparison, preserve the original for display | P5.1.1 |
| EC-P5-04 | 🟠 | Obviously invalid (`priya@`, `@x.com`, `not an email`) | Reject at ingest with `suppression_reason='invalid'` if imported, or a form error if typed | P5.1.1 |
| EC-P5-05 | 🟡 | 320-character address (the RFC maximum) | Accept; ensure the column and any hash-based index handle it | P5.1.1 |
| EC-P5-06 | 🟠 | Contact email equals the user's own sending address | **Allow** — this is the documented self-test path from The Closer's Phase 7 runbook. Do not block it | P5.1.1 |
| EC-P5-07 | 🔴 | `source` omitted from the request body | Reject with 400. The column is `NOT NULL` with no default **by design** (ADR-008). Do not add a default to make the form easier | P5.1.1 |
| EC-P5-08 | 🟠 | Client sends `source='public_profile'` (present in the problem statement's draft enum, dropped in the schema) | DB `CHECK` rejects it. Confirm the API surfaces a clear message rather than a 500 | P5.1.1 |

### Import and opt-out

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P5-09 | 🟠 | CSV with a UTF-8 BOM → first header becomes `﻿recipient_email` | Strip the BOM before header parsing. The single most common CSV import bug | P5.1.3 |
| EC-P5-10 | 🟠 | CSV uses `;` or tab delimiters, or CRLF line endings | Sniff the dialect; fall back to a clear error naming the expected format | P5.1.3 |
| EC-P5-11 | 🟠 | Quoted field containing a newline or a comma | Use a real CSV parser, never `split(',')` | P5.1.3 |
| EC-P5-12 | 🟠 | Missing required column, or headers in different case (`Recipient_Email`) | Case-insensitive header matching; explicit error naming the missing column | P5.1.3 |
| EC-P5-13 | 🟠 | 10,000-row CSV | Cap the import (e.g. 500 rows) with a clear message. Importing is not sending, but an unbounded import is a memory and UX problem | P5.1.3 |
| EC-P5-14 | 🟠 | Half the rows are invalid | Import the valid ones, report the invalid ones with row numbers. Inherited behavior: bad records skip with an actionable warning, never blocking the batch | P5.1.3 |
| EC-P5-15 | 🔴 | CSV cell begins with `=`, `+`, `-`, or `@` → formula injection when the audit log is later exported and opened in Excel | Prefix such cells with `'` on **export** (P6.3.3). Import stores them raw. The risk is downstream, in the export the user shares as proof | P5.1.3 |
| EC-P5-16 | 🟠 | Opt-out list given as a whole domain (`@company.com`) | The Closer supported per-address only. **Decide:** support domain-level suppression or reject it explicitly. Silently treating `@company.com` as a literal address means the suppression never fires | P5.1.4 |
| EC-P5-17 | 🔴 | Contact created, then added to the opt-out list afterwards | Suppression is evaluated **at send time** by the interlock chain, not at contact-creation time. A contact row created before the opt-out must still be blocked | P5.4.4 |
| EC-P5-18 | 🟠 | Opt-out entry with different casing than the contact | Both are `CITEXT`; verify the comparison actually goes through the column type and not a case-sensitive application-side compare | P5.4.4 |
| EC-P5-19 | 🟡 | Same email added as a contact on two different applications | Two rows, by design (`UNIQUE (user_id, application_id, recipient_email)`). See EC-P5-27 for why dedup must still catch this | P5.1.1 |

---

## P5.2 — Personalization payload

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P5-20 | 🟠 | No `TailoringRun` exists for the application | Payload is `null`; generation falls back to the plain six-part template with a generic-hook warning. Explicitly supported (P5.2.6) | P5.2.1 |
| EC-P5-21 | 🟠 | `TailoringRun` exists but `bulletChanges` is empty (everything was guardrail-blocked) | `strongestBullet` is `null`. The template must render without it — no `undefined` in the body | P5.2.1 |
| EC-P5-22 | 🔴 | **`topMatchedSkills` is empty** → generic hook → the warning fires | Correct behavior, and per FR7 this now signals a **bug worth investigating**, not just a weak email. Log it as a payload-quality metric | P5.2.1 |
| EC-P5-23 | 🟠 | `matchScore` is 31 — a genuinely poor fit | Generate anyway; the user decides. But the payload must not let the prompt imply a strong match. The score is context for the writer, never a claim in the body | P5.2.1 |
| EC-P5-24 | 🔴 | **`honestGaps` leaks into the email as a claim** ("I have no Kubernetes experience but...") | The prompt instruction (P5.2.5) is that gaps are what *not* to claim competence in — they are a suppression list, not content. Assert this with a fixture where a gap exists and confirm it does not appear in the body | P5.2.5 |
| EC-P5-25 | 🔴 | **Prompt injection via `jdHooks`.** `domainSignals` derives from third-party JD text (EC-P3-31); it flows into the email prompt, and the output is sent under the user's name | Delimit payload fields as data in the email prompt; validate the output through the existing validator; never let a field be interpreted as instruction. This is the end of the injection chain that starts in Phase 3 | P5.2.4 |
| EC-P5-26 | 🟠 | A payload string contains newlines, quotes, or markdown that breaks the template | Escape/normalize payload values before interpolation | P5.2.3 |
| EC-P5-27 | 🟡 | Payload built from a Tier-1 (`cheap`) run rather than a Tier-2 (`full`) one — no `bulletChanges` exist | Only build payloads from `tier='full'` runs. A cheap run has a score but no evidence | P5.2.1 |

---

## P5.3 — Generation and grounding

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P5-28 | 🟠 | `GROQ_API_KEY` missing | Template fallback, no error. Explicit acceptance criterion; inherited behavior 🟢. Note this is now the *same* key the tailoring chain needs — if it is absent, scoring is already broken upstream | P5.2.8 |
| EC-P5-29 | 🟠 | Groq returns 429 or times out | Template fallback, logged. Never surface a raw provider error on the review screen. **Single-provider consequence (§12.2):** the tailoring chain shares this quota, so a heavy batch-scoring run can rate-limit email generation. Budget the per-user LLM quota across both | P5.2.4 |
| EC-P5-30 | 🔴 | LLM returns 151 words against a 150 limit | Validator rejects → template fallback 🟢. Confirm the word-count definition matches the original (hyphenates, URLs, and em-dashes all count differently). **Raised to 🔴 by the Groq switch:** the validator was tuned against Claude output. A different model family is verbose in different ways, so expect this to fire more often — tune the prompt and `BANNED_PHRASES` first, never `WORD_LIMIT` | P5.2.4 |
| EC-P5-31 | 🟠 | LLM returns the body with a subject line embedded, or with markdown fences | Strip and validate. If the shape is wrong after one retry, fall back to the template | P5.2.4 |
| EC-P5-32 | 🟠 | LLM returns an empty body | Treat as a validation failure → template | P5.2.4 |
| EC-P5-33 | 🔴 | **Grounding BLOCKs on a named person — but the greeting is "Hi Priya," and Priya is the recipient** | Exclude `contact.recipientName` and the sender's own name from the named-person check. **Design gap**: as specified in `architecture.md` §13.3 this blocks every personalized greeting | P5.3.1 |
| EC-P5-34 | 🔴 | **Grounding FLAGs "Python" because it is not in `topMatchedSkills` — but it is in the resume.** The payload carries only the top 3 | Check claimed skills against the **full `ResumeProfile.skills`**, not the truncated payload. **Design gap**: as written, this produces false positives on almost every email | P5.3.1 |
| EC-P5-35 | 🟠 | Email mentions the company's product, which appears in neither the resume nor the payload | Not a fabrication about the sender. Do not block; this is legitimate research. Scope the checks to **claims about the sender**, not to all proper nouns | P5.3.1 |
| EC-P5-36 | 🟠 | BLOCK fires → template fallback → the template *also* contains the blocked pattern | Re-run grounding on the fallback. If the template fails too, surface the block to the user rather than looping | P5.3.3 |
| EC-P5-37 | 🔴 | **User edits the body after generation to add a fabricated claim.** Grounding ran at generate time only | State the policy explicitly: user edits are the human's own words, and they are the accountable author — so **re-run grounding and warn, do not block**. What must not happen is running no check at all and letting the review screen imply the content was verified | P5.3.6 |
| EC-P5-38 | 🔴 | User edits the body but the hash is not recomputed | Any edit recomputes the hash (P5.3.6), and approval binds to the final text. A stale hash makes interlock check 3 meaningless | P5.3.6 |
| EC-P5-39 | 🟠 | Subject options list is empty, or all three are identical | Require 2–3 distinct options; fall back to the deterministic subject | P5.2.3 |
| EC-P5-40 | 🟡 | Evidence panel has nothing to show (null payload) | Render "no tailoring evidence — this is a generic template email" rather than an empty panel | P5.3.5 |
| EC-P5-41 | 🟠 | User skips → `OutreachAttempt` written as `skipped`; then generates again for the same contact | Both rows exist. Skips are logged and never suppress future attempts (only `sent`/`drafted` do) | P5.3.7 |

---

## P5.4 — Interlocks

Every case in this section is 🔴. This is the safety core.

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P5-42 | 🔴 | `POST /deliver` with **no token** (a hand-crafted `curl`) | Blocked at check 2. Safety test 1 | P5.4.3 |
| EC-P5-43 | 🔴 | Token minted for body A, delivery attempted with body B | Blocked at check 3 on hash mismatch. Safety test 2 | P5.4.2 |
| EC-P5-44 | 🔴 | Same token replayed | Blocked — `token_used_at` is set. Safety test 3 | P5.4.7 |
| EC-P5-45 | 🔴 | **Two concurrent `/deliver` calls with the same valid token** | Atomic burn: `UPDATE ... WHERE token_used_at IS NULL RETURNING`. If two transactions can both see null, both send. Test this with real concurrency, not sequentially | P5.4.7 |
| EC-P5-46 | 🔴 | Token expired (user approved, went to lunch, returned) | Blocked at check 2. **UX matters here**: offer one-click re-approve, do not lose the drafted body | P5.4.1 |
| EC-P5-47 | 🔴 | Clock skew between app instances makes a valid token look expired (or vice versa) | Compare against the database's `now()`, never the app server's clock | P5.4.1 |
| EC-P5-48 | 🔴 | Body hash mismatches because the UI trims whitespace on display but the server hashed the untrimmed text | **Hash exactly the bytes that will be handed to the provider.** Normalize once, early, and hash after normalization | P5.4.2 |
| EC-P5-49 | 🔴 | Recipient is on the opt-out list | Blocked at check 5, `status='failed'`, reason `opt_out`. Safety test 4 | P5.4.4 |
| EC-P5-50 | 🔴 | **Same person, two applications, two contact rows.** Dedup keys on `contact_id`, so both sends pass | Dedup on **normalized email within the window**, not on the contact row. Otherwise a user emails one recruiter about five jobs in one afternoon — precisely the behavior the cap exists to prevent. **Design gap** | P5.4.5 |
| EC-P5-51 | 🔴 | Prior attempt to this contact was `failed` or `skipped` | Dedup considers only `sent` and `drafted`. A failed attempt must not permanently lock out the contact | P5.4.5 |
| EC-P5-52 | 🔴 | **Cap race**: two tabs both `COUNT` at N-1 and both insert → N+1 delivered | Count and insert inside one transaction with an advisory lock on `user_id`, or `SERIALIZABLE` isolation. A plain count-then-insert is TOCTOU. **Design gap** | P5.4.6 |
| EC-P5-53 | 🔴 | Cap boundary: exactly at N | N is allowed, N+1 blocked. Safety test 5 — assert both sides of the boundary | P5.4.6 |
| EC-P5-54 | 🔴 | The 24-hour window is implemented as "today" in server-local time | Rolling window from `now() - interval '24 hours'`. A calendar day lets a user send 2N across midnight | P5.4.6 |
| EC-P5-55 | 🔴 | User flips `dry_run` from true to false **between approve and deliver** | Check 10 reads the current value at delivery. That is correct — but the review screen said "will create a draft", so the outcome must be re-confirmed rather than silently upgraded | P5.5.10 |
| EC-P5-56 | 🔴 | An interlock throws an unexpected exception | **Fail closed.** Any error in the chain is a block, logged as `failed`, never a fall-through to delivery | P5.4.3 |
| EC-P5-57 | 🔴 | A block writes no `OutreachAttempt` row | Every block writes `status='failed'` with the specific failing check (P5.4.8). A silent block is unauditable and indistinguishable from a bug | P5.4.8 |
| EC-P5-58 | 🔴 | Interlock order changed for convenience (cheap checks first) | Order is specified in `architecture.md` §14.3 and is deliberate — dry-run is late so that dry runs exercise checks 1–9. Reordering weakens the test path | P5.4.3 |

---

## P5.5 — Delivery and credentials

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P5-59 | 🔴 | **Token burned, then the provider call fails, but Gmail actually created the draft** (lost response) | The row says `failed`; a draft exists. Record `provider_attempted_at` before the call and surface "this may have been created — check your Gmail". **Design gap**: as specified the audit trail can be wrong in the one direction that matters | P5.5.6 |
| EC-P5-60 | 🔴 | `DRY_RUN=true` and the code still opens a socket | Safety test 6 asserts **zero socket activity** at the socket layer, not by inspecting a boolean. Mock at the transport level | P5.5.7 |
| EC-P5-61 | 🔴 | Credentials appear in ④'s 422 validation error, which ① then logs | Redact request bodies in ④'s exception handler (P5.5.5) **and** in ①'s outbound-request logging. Both sides | P5.5.5 |
| EC-P5-62 | 🔴 | Credentials cached in ④ between requests "for performance" | ④ is stateless by design. Used and discarded, every request | P5.5.4 |
| EC-P5-63 | 🟠 | `preflight_ok_at` is 60 days old; the app password was revoked last week | Re-preflight after N days, and on any auth failure clear `preflight_ok_at` so the next send is blocked at check 11 rather than failing at the provider | P5.5.2 |
| EC-P5-64 | 🟠 | Gmail refresh token revoked in the user's Google account settings | Refresh fails → clear stored credentials, block at check 11, prompt re-consent. Do not retry into a revoked token | P5.5.3 |
| EC-P5-65 | 🔴 | OAuth scope granted for **drafts only**, then the user switches `send_mode` to `send` | Check the granted scope at check 12 and block with "re-authorize for sending". Discovering this at the API call means a `failed` row for a user who did everything right | P5.5.3 |
| EC-P5-66 | 🟠 | Gmail daily sending quota exceeded | `failed` with the provider reason. Do not retry — quota is not transient within the window | P5.5.4 |
| EC-P5-67 | 🔴 | `ENCRYPTION_KEY` rotated; old rows encrypted under version 1 | `key_version` on every row; keep prior keys available for decryption. Rotating without a version column bricks every stored credential | P5.5.1 |
| EC-P5-68 | 🟠 | SMTP server presents an invalid TLS certificate | Fail. Never disable verification — an app-password over an unverified connection is a credential handed to whoever answered | P5.5.4 |

---

## Traps

### The gate must fail closed

EC-P5-56 is the one that turns a safety system into decoration. A chain of twelve checks where an unexpected exception falls through to delivery is worse than no chain, because it is trusted. Wrap the whole chain: any non-explicit-pass outcome is a block.

### Three design gaps make grounding unusable as specified

EC-P5-33 (recipient's name blocks every greeting), EC-P5-34 (top-3 truncation flags real skills), and EC-P5-35 (company research read as fabrication) all point the same direction: **the grounding checks must be scoped to claims about the sender, evaluated against the full resume.** Fix the specification before writing the code, or the first ten emails will all be blocked and the check will get disabled.

### Dedup on the person, not the row

EC-P5-50 is the gap with the clearest real-world consequence. The system as specified permits emailing one recruiter five times in an afternoon — one per application — while every counter reads as compliant. The cap and the dedup must both key on the human being contacted.

### The audit trail can lie in exactly one direction

EC-P5-59: a burned token plus a lost response yields a `failed` row and a real draft. Every other failure mode over-reports (a `failed` row with nothing sent). This one under-reports, which is the direction that breaks the proof artifact and the user's trust in their own log.

### Two tabs is the whole concurrency test suite

EC-P5-45 and EC-P5-52 are both reproducible by opening the review screen twice. They are also both invisible in sequential tests. Write them with real parallel requests.

---

## Exit checklist

Beyond the plan's acceptance criteria and the eight P5.6 safety tests:

- [ ] EC-P5-33/34/35: grounding specification amended in `architecture.md` §13.3 before implementation
- [ ] EC-P5-37: policy on post-edit grounding written down and reflected in the review UI copy
- [ ] EC-P5-45: two truly concurrent deliveries with one token → exactly one send
- [ ] EC-P5-50: two applications, same recipient → the second is blocked by dedup
- [ ] EC-P5-52: two concurrent deliveries at the cap boundary → exactly N total
- [ ] EC-P5-56: an interlock that throws results in a block and a `failed` row
- [ ] EC-P5-59: `provider_attempted_at` recorded; the UI can say "may have been created"
- [ ] EC-P5-61: force a 422 from ④ and grep the full log output for the credential
- [ ] EC-P5-67: rotate the key with existing rows → old credentials still decrypt
- [ ] EC-P5-15: an exported log containing `=cmd()` is escaped
