# Phase 1 — Edge Cases

**Persistence and auth** · [plan](../implementation-plan.md#phase-1--persistence-and-auth) · [index](./README.md)

Phase 1 turns a single-user, session-scoped tool into a multi-user, persistent one. Two categories dominate: **files users upload are hostile by default**, and **anything that was previously impossible to do twice is now a race**.

**43 cases.** 🔴 must-handle · 🟠 should-handle · 🟡 polish

---

## P1.1 — Authentication

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P1-01 | 🔴 | User signs out and a different user signs in **in the same tab** — TanStack Query cache still holds the previous user's resumes and runs | Clear the entire query cache on any auth identity change. This renders another user's data in the browser; it is a leak even though the server was correct | P1.1.2 |
| EC-P1-02 | 🔴 | Session expires mid-request on a mutation (upload, tailor) | Return 401, never a partial write. The client re-authenticates and retries; nothing half-persists | P1.1.3 |
| EC-P1-03 | 🟠 | OAuth provider returns a profile with no email | Reject sign-up with a clear message. `users.email` is `NOT NULL` and is the natural key | P1.1.2 |
| EC-P1-04 | 🟠 | Same person signs up with `Gaurav@X.com` then `gaurav@x.com` | `CITEXT` handles the DB side, but the auth provider may treat them as distinct identities and create two rows | P1.1.2 |
| EC-P1-05 | 🟠 | Middleware protects `/(dashboard)/*` but a new route group is added later outside it | Default-deny: protect everything, allow-list the public routes. Never the reverse | P1.1.3 |
| EC-P1-06 | 🟠 | `candidate_background` is empty and the user reaches P5 — email generation has nothing to say | Not a P1 error, but P1 must persist `NULL` cleanly and P5 must handle it. Do not default it to an empty string that reads as "provided" | P1.1.4 |
| EC-P1-07 | 🟡 | Settings page shows `dry_run` read-only in P1; a user toggles it via devtools | Server ignores the field entirely until P5.5.10. Read-only in the UI must mean not-writable on the server | P1.1.5 |
| EC-P1-42 | 🔴 | **Supabase Auth rejects `@example.com`** with `email_address_invalid`. EC-P0-26 mandates exactly that domain for seed data, so a seeded user can NEVER have a matching auth identity and can never sign in | The two rules are both right and directly conflict. Resolution: the seed's `public.users` row is **data-only** — useful for exercising queries, never for signing in. To seed data against a REAL account, pass `SEED_USER_ID`/`SEED_USER_EMAIL` from an account created through the UI. Do not "fix" this by seeding a deliverable domain: EC-P0-26 exists so seed data cannot email a real person | P0.3.5 |
| EC-P1-43 | 🟠 | `mailer_autoconfirm: false` on a hosted project means every signup sends a **real confirmation email**, so dev signups need a real inbox and cannot be scripted against arbitrary addresses | Fine for production, awkward for development. Either enable autoconfirm on a dev project, use the local GoTrue profile (which sets `GOTRUE_MAILER_AUTOCONFIRM=true`), or sign up manually with a real address. **Never** script signups against invented domains — that mails whoever owns them | P1.1.2 |

---

## P1.2 — Resume library

### Upload and extraction

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P1-08 | 🔴 | **Scanned-image PDF** — valid PDF, zero extractable text | Detect near-empty extraction (< ~200 chars) and reject with "we could not read text from this file — paste it instead". Do **not** send an empty resume to the parse prompt | P1.2.1 |
| EC-P1-09 | 🔴 | **PDF extraction emits `\x00`.** Postgres `text` rejects null bytes with `invalid byte sequence` | Strip `\x00` and other C0 control characters (except `\n`, `\t`) in `document-extract` before anything touches the DB. **This is a design gap** — the existing extractor never hit it because it never persisted | P1.2.3 |
| EC-P1-10 | 🟠 | Password-protected / encrypted PDF | Catch the library error and surface "this PDF is protected", not a 500 | P1.2.1 |
| EC-P1-11 | 🟠 | File extension says `.pdf`, magic bytes say something else | Content-type sniffing (P1.2.5) must run on **bytes**, not the filename or the client-supplied MIME type | P1.2.5 |
| EC-P1-12 | 🟠 | A `.docx` that is a zip bomb — 2 KB expanding to 2 GB | Cap the decompressed size, not just the upload size | P1.2.5 |
| EC-P1-13 | 🟠 | 0-byte file, or a valid file with only whitespace | Reject before the parse prompt. Same path as EC-P1-08 | P1.2.1 |
| EC-P1-14 | 🟠 | 400-page PDF extracts to 2 MB of text → parse prompt exceeds the model's context | Cap extracted text (e.g. 50 KB) with a visible warning that the resume was truncated. Silent truncation produces a wrong parse the user cannot explain | P1.2.1 |
| EC-P1-15 | 🔴 | Upload is 4.6 MB with `MAX_UPLOAD_MB=5` — the **platform's** body limit (Vercel: 4.5 MB) rejects it before your check runs | The user sees an opaque 413 instead of your message. Either keep `MAX_UPLOAD_MB` below the platform limit, or upload direct-to-storage with a presigned URL | P1.2.5 |
| EC-P1-16 | 🟠 | Multi-column resume parses with interleaved text (a known limitation from the source project) | `raw_text` is preserved (P1.2.3) and the paste fallback stays available. Warn when heuristics detect column interleaving | P1.2.1 |
| EC-P1-17 | 🟡 | Resume in a non-English language | The parse prompt may return an unexpected shape. Zod validation catches it; the error message should be honest about the limitation | P1.2.1 |
| EC-P1-18 | 🟠 | Filename contains path traversal (`../../etc/passwd`) or unicode RTL override | Never use the client filename as a storage key. Generate opaque keys (P1.2.2); store the original name as a display-only column | P1.2.2 |

### Versioning and defaults

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P1-19 | 🔴 | **Two concurrent uploads** both compute `version = MAX(version) + 1` → unique violation on `(user_id, version)` | Allocate the version inside the insert transaction, or catch the violation and retry. Two browser tabs make this trivially reproducible | P1.2.4 |
| EC-P1-20 | 🔴 | **Two concurrent "set as default"** → both set `is_default = true` → partial unique index violation | Single transaction: unset all, then set one. Not two statements from the app | P1.2.4 |
| EC-P1-21 | 🟠 | First resume uploaded is not marked default → user has resumes but no default, and P4's scoring has nothing to score | First resume for a user is default automatically | P1.2.4 |
| EC-P1-22 | 🟠 | User deletes the default resume | Either block deletion of the default, or promote the most recent remaining one. Never leave a user with resumes and no default | P1.2.4 |
| EC-P1-23 | 🔴 | User deletes a resume that a `tailoring_run` references — the audit trail loses "which resume did I actually send?" | FK is `RESTRICT`, not `CASCADE`. Offer soft-delete (hide from the picker, keep the row). The whole point of FR3 is answering that question later | P1.2.4 |
| EC-P1-24 | 🟠 | Deleting a resume leaves its object in storage | Delete the object in the same operation, or run a reaper. Track orphans deliberately — do not hope | P1.2.2 |
| EC-P1-25 | 🔴 | **Object uploaded to storage, then the DB insert fails** → orphaned object with no row | Write the DB row first (status `pending`), upload, then mark `ready`. A failed upload leaves a `pending` row a reaper can clean. The reverse order leaks storage forever | P1.2.2 |

---

## P1.3 — Rewiring tailoring onto the database

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P1-26 | 🔴 | **Cross-tenant read**: `GET /api/runs/:id` with another user's valid UUID | Return **404, not 403**. A 403 confirms the ID exists, which is an enumeration oracle | P1.3.5 |
| EC-P1-27 | 🔴 | Same for `/api/export/pdf` and every `exported_documents` object key | Storage keys must be unguessable **and** every fetch must still be tenant-checked. Do not rely on key entropy alone | P1.3.6 |
| EC-P1-28 | 🟠 | User closes the browser mid-tailoring; the LLM chain is server-side and completes | The run persists and appears on reload. If the chain instead dies with the request, the row is stuck non-terminal — give `tailoring_runs` a status and reap stale ones | P1.3.3 |
| EC-P1-29 | 🟠 | Two tabs tailor the same JD simultaneously → two `tailoring_runs` | Allowed. But `applications.active_tailoring_run_id` must resolve deterministically (latest wins) rather than racing | P1.3.3 |
| EC-P1-30 | 🟠 | `sessionStorage` had no size limit worth worrying about; `TailoredResume` JSONB for a 20-page resume is large | Fine for Postgres (TOAST), but cap the API response or paginate bullet changes in the UI | P1.3.3 |
| EC-P1-31 | 🔴 | A prompt is edited after runs exist → `prompt_version` on old rows references a version whose text is gone | Keep prompt text versioned in-repo (never edit in place — add a new version). Otherwise "why did it say that?" is unanswerable for any historical run | P1.3.4 |
| EC-P1-32 | 🟠 | `prompt_version` not bumped when a prompt is edited | Derive it from a content hash of the prompt file, not a hand-maintained string. Humans forget; hashes do not | P1.3.4 |
| EC-P1-33 | 🟠 | The anti-corruption layer (P1.3.1) keeps `run-client-store`'s synchronous interface, but DB reads are async | The interface **will** change shape here. Budget for it — P1.3.2's "interface unchanged" holds for call sites, not for sync/async | P1.3.1 |
| EC-P1-34 | 🟠 | `GET /api/runs/:id` for a run whose resume was soft-deleted | Render the run — the snapshot is in the run row. Show the resume as "deleted version 2" rather than failing | P1.3.5 |
| EC-P1-35 | 🟡 | PDF export requested twice concurrently for the same run | Two `exported_documents` rows, two objects. Harmless but wasteful — dedupe on `(run_id, kind)` | P1.3.6 |
| EC-P1-36 | 🟠 | A leftover `sessionStorage` read path survives in an untouched component | The exit gate greps for it. Run the grep across `components/` and `hooks/`, not just `lib/` | P1.3.8 |

---

## P1.4 — Guardrails server-side

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P1-37 | 🔴 | Guardrails run **after** persistence, so an unchecked rewrite exists in the DB for a moment | Check then write, in that order, in one transaction. A window where fabricated content is persisted is a window where it can be read and exported | P1.4.1 |
| EC-P1-38 | 🟠 | Every bullet is blocked → `tailored_resume` equals the original | Legitimate outcome. Show it honestly ("no changes passed verification") rather than presenting an unchanged resume as tailored | P1.4.2 |
| EC-P1-39 | 🟠 | Guardrail report is empty because the run had zero bullet changes | Distinguish "nothing to check" from "everything passed" in the UI | P1.4.3 |
| EC-P1-40 | 🟠 | A blocked change is dropped from the response entirely, so the UI shows nothing | Blocked changes must be **present and marked rejected**, with the reason. Silent removal is the failure mode P1.4.2 exists to prevent | P1.4.2 |
| EC-P1-41 | 🟡 | Guardrail flags a legitimate metric the user actually had (false positive) | Flags are warn-level, not blocks, for metrics. Preserve the existing warn-first tuning from the source project | P1.4.2 |

---

## Traps

### Everything that was single-user is now a race

The source project could not have two uploads, two default-sets, or two tailoring runs in flight. Now it can, and the cheapest reproduction is two browser tabs. EC-P1-19, -20, -29, and -35 are all the same bug shape. When you add any "compute from current state, then write" logic in this phase, assume two tabs.

### The query cache is a data-leak surface

EC-P1-01 is the one people miss because the server is doing everything right. TanStack Query keys on query name, not on identity. Sign-out must clear the cache — not invalidate, clear.

### 404 versus 403

EC-P1-26 seems pedantic until you realize a 403 lets someone enumerate valid run IDs across the whole platform. The rule: **for tenant-scoped resources, unauthorized and nonexistent are the same response.**

### `raw_text` is the thing that saves you later

P1.2.3 is one line in the plan and easy to skip. Every parse-quality complaint, every "the AI got my job title wrong", and every future re-parse with a better prompt depends on having kept the original. Keep it even when the parse succeeded.

---

## Exit checklist

Beyond the plan's acceptance criteria:

- [ ] EC-P1-01: sign out → sign in as user B in the same tab → no user A data renders
- [ ] EC-P1-09: a PDF containing null bytes uploads and persists without a DB error
- [ ] EC-P1-19/20: two concurrent uploads and two concurrent set-defaults both succeed or fail cleanly, never violating an index
- [ ] EC-P1-25: kill the storage service mid-upload → no orphaned object, or a reapable `pending` row
- [ ] EC-P1-26: another user's run ID returns 404
- [ ] EC-P1-31: edit a prompt, then load a run created before the edit — it still renders with its original explanations
- [ ] EC-P1-37: a fabricated employer never appears in `tailoring_runs.tailored_resume`, only in `guardrail_report` as rejected
- [ ] EC-P1-08/13: a scanned PDF and a 0-byte file both produce a helpful message, not a 500
