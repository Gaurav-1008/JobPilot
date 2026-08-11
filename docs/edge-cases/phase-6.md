# Phase 6 — Edge Cases

**Tracker and proof** · [plan](../implementation-plan.md#phase-6--tracker-and-proof) · [index](./README.md)

Two hazards here. The status machine has automatic and manual writers that will fight each other. And the follow-up sweep is the only scheduled, unattended thing in the entire product that touches the outreach path — the one place where §12.3's "automating outreach is spam" line could be crossed by accident.

**35 cases.** 🔴 must-handle · 🟠 should-handle · 🟡 polish

---

## P6.1 — Status transitions

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P6-01 | 🔴 | User marks an application `rejected`; later re-tailors it → the automatic transition pushes it back to `tailored`, erasing their record | **Manual terminal statuses are sticky.** `replied`, `interviewing`, `rejected`, `closed` are never overwritten by an automatic transition. Define this as a rule in code, not as a convention | P6.1.3 |
| EC-P6-02 | 🟠 | Automatic transitions move a status **backwards** (`emailed` → `tailored` after a second tailoring run) | Auto-transitions only advance. Re-tailoring an emailed application updates `active_tailoring_run_id` without touching status | P6.1.3 |
| EC-P6-03 | 🟠 | Two automatic transitions race (tailoring completes as the email delivers) | Both write; last wins. Guard with a status-rank comparison in the update (`WHERE rank(new) > rank(current)`) rather than a blind set | P6.1.3 |
| EC-P6-04 | 🟠 | User manually sets `emailed` when no outreach attempt exists | Allow — users track things outside the app. But the timeline shows no attempts, which must read as "recorded manually", not as a missing row | P6.1.4 |
| EC-P6-05 | 🟠 | User moves an application backwards manually (`emailed` → `saved`) | Allow; log the transition. Manual overrides are the user's call | P6.1.4 |
| EC-P6-06 | 🟠 | Application has no contact and no tailoring run — created by scoring only | Tracker row renders with empty columns, not a crash. This is the majority state right after a harvest | P6.1.1 |
| EC-P6-07 | 🟠 | `active_tailoring_run_id` points at a deleted run | Nullable FK with `ON DELETE SET NULL`, and the UI handles null | P6.1.1 |
| EC-P6-08 | 🟠 | Tracker query fans out across five tables for 200 applications → N+1 | One query with joins, or explicit batching. This page loads on every visit | P6.1.1 |
| EC-P6-09 | 🟡 | Timestamps render in server time, confusing a user in another timezone | Store `TIMESTAMPTZ` (already specified); render in the browser's zone | P6.1.5 |
| EC-P6-10 | 🟡 | Notes field accepts 100 KB of text | Cap it; it is a note, not a document | P6.1.6 |

---

## P6.2 — The follow-up sweep

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P6-11 | 🔴 | **`applications.status='emailed'` includes drafts the user never actually sent.** The sweep follows up on an email that was never delivered | Sweep on `outreach_attempts.status='sent'`, not on application status. **Design gap** — following up on an unsent email is the most embarrassing failure this feature can produce | P6.2.1 |
| EC-P6-12 | 🔴 | **"No reply after N days" — nothing in the system can detect a reply.** There is no IMAP connection, no webhook, no inbox read | The condition is really *"no response recorded by the user"*. Rename it in the UI and the code. **Design gap**: as worded in FR10 the feature promises inbox awareness the architecture does not have | P6.2.1 |
| EC-P6-13 | 🔴 | Sweep generates a follow-up and **delivers it** | The sweep creates `status='generated'` rows only. There must be no code path from the sweep handler to `/deliver`. The exit gate greps for it — write the grep as a test | P6.2.3 |
| EC-P6-14 | 🔴 | Cron overlap: the sweep runs twice in one day → duplicate follow-ups for every application | Idempotency key per `(application_id, sweep_date)`. Concurrency 1, and a deterministic job ID | P6.2.1 |
| EC-P6-15 | 🔴 | Sweep runs daily; the user never reviews the generated follow-up → a new one is generated every day | Skip any application that already has a `generated` follow-up pending review. Otherwise the review queue fills with identical drafts | P6.2.3 |
| EC-P6-16 | 🔴 | Contact was added to the opt-out list after the original send | Sweep must skip suppressed contacts at **generation** time, not only at the interlock. Generating a draft to someone who opted out invites a mis-click | P6.2.1 |
| EC-P6-17 | 🟠 | Parent attempt's `body_snapshot` is a legacy import with no body (EC-P6-24) | Skip, or generate without quoting the original. Never render `null` into the follow-up | P6.2.2 |
| EC-P6-18 | 🟠 | Parent attempt deleted, or its application deleted | `parent_id` is nullable with `ON DELETE SET NULL`; the sweep skips orphans | P6.2.3 |
| EC-P6-19 | 🟠 | Follow-up chains: a follow-up to a follow-up to a follow-up | Cap the chain depth (2 follow-ups maximum). Unbounded chains are indistinguishable from pestering | P6.2.1 |
| EC-P6-20 | 🟠 | The follow-up counts against the 24-hour volume cap | It should — it is an email to a human. Confirm the interlock does not special-case follow-ups | P6.2.4 |
| EC-P6-21 | 🟠 | Sweep generates 40 follow-ups at once, exceeding any plausible daily cap | Cap generation per sweep to roughly the daily send cap. Generating far more than can be sent creates a queue the user will clear carelessly | P6.2.1 |
| EC-P6-22 | 🟡 | `N` changed from 7 to 3 → applications that were already swept become eligible again | Track `last_followup_generated_at` per application, not just the age of the parent | P6.2.5 |
| EC-P6-23 | 🟠 | Sweep runs while the user is asleep and the review queue has no notification | Acceptable for MVP, but the tracker must show a pending-review count. A queue nobody knows about is a queue nobody clears | P6.2.4 |

---

## P6.3 — Proof export

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P6-24 | 🔴 | **Legacy `outreach_log.csv` rows have no application and no contact, but both FKs are `NOT NULL`** | Make both nullable for `legacy_import` rows, or synthesize placeholder application/contact rows. **Design gap** — as specified in `architecture.md` §7.2, the legacy import in P6.4.2 cannot insert a single row | P6.4.2 |
| EC-P6-25 | 🔴 | Exported CSV cell begins with `=`, `+`, `-`, or `@` → formula injection when opened in Excel | Prefix with `'` on export. The bundle is explicitly the artifact users share as proof — it will be opened in a spreadsheet | P6.3.3 |
| EC-P6-26 | 🟠 | Bundle for 200 applications with 400 PDFs → multi-minute build, request timeout | Queue it like any long job (§10.1 lists `export:bundle` at a 3-minute timeout). Do not build it in a request handler | P6.3.1 |
| EC-P6-27 | 🟠 | A referenced PDF is missing from object storage | Include a manifest noting the omission rather than failing the whole bundle | P6.3.1 |
| EC-P6-28 | 🟠 | Bundle includes `body_snapshot` for every email — real recipient addresses in a file the user may post publicly | Warn on export, or offer a redacted variant. The original projects' proof artifact was screenshots the user chose; this one is automatic and complete | P6.3.1 |
| EC-P6-29 | 🟠 | Pipeline summary counts double after a re-harvest finds the same jobs | Count distinct jobs, not job-run pairs (relates to EC-P2-19) | P6.3.2 |
| EC-P6-30 | 🟡 | Empty bundle (new user, nothing done) | Produce a valid zip with a README explaining there is nothing yet, not a 500 | P6.3.1 |
| EC-P6-31 | 🟡 | Truthfulness disclaimer missing from the bundle README | Required (P6.3.4) and inherited from all three source projects. Assert its presence in a test | P6.3.4 |

---

## P6.4 — Legacy import

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P6-32 | 🟠 | Import run twice → duplicate rows | Deterministic natural key per row (timestamp + recipient + subject) with an upsert. Imports get re-run; assume it | P6.4.1 |
| EC-P6-33 | 🟠 | `jobs.csv` has no `user_id` | Assign to the importing user; create a synthetic `harvest_runs` row marked `legacy_import` | P6.4.1 |
| EC-P6-34 | 🟠 | Legacy `jobs.csv` rows collide with existing dedupe keys | Upsert on `(user_id, dedupe_key)` — the existing row wins, the legacy row is skipped and counted | P6.4.1 |
| EC-P6-35 | 🟠 | `outreach_log.csv` from an early phase has no `parent_id` column (added in The Closer's Phase 8) | Handle both shapes; missing `parent_id` becomes null. The original code upgraded the file in place, so both variants exist in the wild | P6.4.2 |

---

## Traps

### The sweep is the only unattended thing that touches outreach

EC-P6-13 is the phase's defining constraint, and the plan already calls it out. Worth restating in terms of what would have to go wrong: someone adds "auto-send follow-ups when the user has enabled it" as a convenience, and the product becomes an automated cold-email engine — the exact thing [`problemStatement.md`](../problemStatement.md) §12.3 was written to prevent. The structural defense is that `followup-sweep.ts` must not import the delivery module at all.

### `emailed` is not `sent`

EC-P6-11 comes from a genuine ambiguity in the status vocabulary. `applications.status='emailed'` is set when delivery succeeds — but in draft mode, "delivery succeeded" means *a draft was created in Gmail*, which the user may never send. Following up on that is worse than not following up. The attempt-level status is the source of truth; the application-level status is a summary.

### The feature cannot do what its name says

EC-P6-12 is not a bug to fix, it is a promise to correct. There is no inbox integration anywhere in the architecture, so "no reply after N days" can only mean "you have not marked this as replied". Naming it honestly in the UI costs nothing; naming it dishonestly means every user eventually discovers the system was never watching.

### The legacy import cannot run as specified

EC-P6-24 is a hard schema conflict, not a subtlety: `outreach_attempts.application_id` and `contact_id` are `NOT NULL`, and the CSV being imported has neither column. Decide the shape before writing P6.4.2, because the fix is a migration.

### The proof bundle is a publication

EC-P6-25 and EC-P6-28 both stem from the same observation: this artifact exists to be shared. That makes it an export surface with the usual export-surface problems — formula injection, and third-party personal data leaving the system in a file the user will attach to something.

---

## Exit checklist

Beyond the plan's acceptance criteria:

- [ ] EC-P6-01: mark an application `rejected`, re-tailor it, confirm the status holds
- [ ] EC-P6-11: sweep keys off `outreach_attempts.status='sent'`; a draft-only application is not swept
- [ ] EC-P6-12: UI and code renamed to "no response recorded"
- [ ] EC-P6-13: `followup-sweep.ts` does not import the delivery module (assert in a test, not by inspection)
- [ ] EC-P6-14/15: run the sweep twice in one day → zero duplicate follow-ups
- [ ] EC-P6-16: an opted-out contact generates no follow-up
- [ ] EC-P6-24: schema decision made and migrated before the legacy import is written
- [ ] EC-P6-25: an exported log containing `=cmd()` opens inertly in a spreadsheet
- [ ] EC-P6-28: export warns about recipient addresses in the bundle
