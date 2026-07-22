# Implementation Plan: The Closer — Cold Email Writer + Send Bot

Phase-wise build plan derived from [problemStatement.md](./problemStatement.md) and [architecture.md](./architecture.md). Each phase is a **vertical slice**: it ends with something runnable and demoable. Phases 0–6 constitute the MVP; Phase 7 is proof/acceptance; Phase 8 is stretch.

**Guiding rules (apply to every phase):**

- `DRY_RUN=true` is the default until Phase 7.
- No secrets in code — `.env` only, never committed.
- Every phase ends with `python main.py` (or a manual test) working end-to-end for what exists so far.

---

## Phase 0 — Project Scaffold & Configuration

**Goal:** Runnable empty project with safety knobs in place before any logic exists.

**Tasks:**

1. Create repo layout per architecture §10:
   ```text
   the-closer/
   ├── main.py
   ├── config.py
   ├── models.py
   ├── input_loader.py
   ├── email_generator.py
   ├── preview.py
   ├── email_sender.py
   ├── logger.py
   ├── contacts.json
   ├── .env.example
   ├── .gitignore
   ├── requirements.txt
   └── README.md
   ```
2. `requirements.txt`: `python-dotenv` (only dependency for MVP).
3. `.env.example` with all safety defaults:
   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your_email@gmail.com
   SMTP_PASSWORD=your_app_password
   SENDER_NAME=Your Name
   DRY_RUN=true
   SEND_MODE=draft
   MAX_OUTREACH_PER_RUN=5
   INPUT_PATH=contacts.json
   ```
4. `.gitignore`: `.env`, `outreach_log.csv`, `__pycache__/`.
5. `config.py`: `AppConfig` dataclass + `load_config()` using `python-dotenv`; parse booleans/ints; fail loud with actionable message if send-mode vars are missing when needed.
6. `main.py` stub: loads config, prints it (with password masked), exits.

**Done when:** `python main.py` prints resolved config with `DRY_RUN=true`; `.env` is git-ignored.

---

## Phase 1 — Domain Models & Input Loading (FR1)

**Goal:** Load and validate outreach targets from data.

**Tasks:**

1. `models.py`: `Contact`, `EmailDraft`, `LogEntry` dataclasses exactly per architecture §6.
2. `contacts.json`: 5 sample records (acceptance criteria needs ≥5) with all required fields — `recipient_email`, `company`, `role`, `candidate_name`, `candidate_background` — plus optional fields on some records to exercise fallbacks (one record missing `recipient_name`, one missing `personalization_note`).
3. `input_loader.py` → `load_targets(path) -> list[Contact]`:
   - Parse JSON into `Contact` objects.
   - Validate per record (architecture §5.2 table): email format regex, required non-empty fields, basic URL format for optional URLs.
   - Invalid record → skip with a clear terminal warning; never abort the whole batch for one bad row.
   - Fallback: also support a hardcoded Python list (useful as live-demo Step 1).
4. Wire into `main.py`: load config → load targets → print count and a one-line summary per contact.

**Done when:** `python main.py` lists 5 valid contacts; a deliberately broken record (bad email) is skipped with a warning, not a crash.

---

## Phase 2 — Email Generator (FR2)

**Goal:** Deterministic template-based generation following the six-part email anatomy.

**Tasks:**

1. `email_generator.py` → `generate_email(contact, config) -> EmailDraft`.
2. Template implements the anatomy (problem statement §7):
   - **Subject:** `f"Quick note on the {role} role at {company}"` — short, specific.
   - **Hook:** `personalization_note` if present; else derived from `company` + `role`.
   - **Introduction:** `candidate_name` + `candidate_background`.
   - **Value/fit:** one line connecting background to role.
   - **One ask:** fixed polite CTA (quick chat / point to right person).
   - **Sign-off:** name + `portfolio_url` if present.
3. Handle optional fields gracefully: greeting falls back to "Hi there" when `recipient_name` missing; omit portfolio line when absent — no empty placeholders in output.
4. Enforce constraints in code, not just in the template:
   - Compute `word_count`; warn (and flag on the draft) if > 150.
   - Single CTA block only.
   - Interpolate only provided fields — no invented facts.
5. Wire into `main.py`: for each contact, generate and print raw subject/body.
6. Quick manual test: run against all 5 contacts, eyeball that each email differs by company/role/hook.

**Done when:** 5 distinct personalized emails print, each < 150 words, correct fallbacks for missing optional fields.

---

## Phase 3 — Preview & Confirmation Gate (FR3)

**Goal:** Human-in-the-loop review before anything can ever be delivered.

**Tasks:**

1. `preview.py`:
   - `preview_email(draft, contact)` — formatted block: recipient, company, role, subject, body, word count (highlight if > 150).
   - `prompt_action() -> Literal["send", "draft", "skip"]` — re-prompt on invalid input; accept shorthand (`s`/`d`/`k`).
2. Wire into `main.py` loop: generate → preview → prompt. For now, just print the chosen action per contact (no sender yet).
3. Rule enforced structurally: the sender (Phase 4) will only ever be called with the return value of `prompt_action()` — no code path delivers without it.

**Done when:** Running the app walks through all contacts interactively; `skip` moves on; choices are echoed back correctly.

---

## Phase 4 — Email Sender: Dry-Run First, Then SMTP (FR4)

**Goal:** Pluggable delivery behind one interface; safe path first.

**Tasks:**

1. `email_sender.py`:
   - `DeliveryResult` dataclass (`status`, `provider_message_id`, `error`) per architecture §5.5.
   - `EmailSender` protocol with `deliver(draft, contact, mode) -> DeliveryResult`.
2. **Step A — `DryRunEmailSender`:** no network; returns `status="dry_run"` success; prints "[DRY RUN] Would send to …". Selected whenever `config.dry_run` is true.
3. **Step B — `SmtpEmailSender`:**
   - `smtplib` + STARTTLS on port 587, auth from config.
   - Build MIME message: `From: SENDER_NAME <SMTP_USER>`, To, Subject, plain-text body.
   - Catch `SMTPAuthenticationError` specifically → actionable hint about Gmail App Passwords; catch other exceptions → `DeliveryResult(status="failed", error=...)`. Never let a provider exception crash the loop.
4. Factory: `get_sender(config)` returns dry-run or SMTP sender based on `DRY_RUN`.
5. Wire into `main.py`: after a `send`/`draft` confirmation, call the sender and print the result. (Draft mode via Gmail API is a Phase 8 stretch; in MVP, `draft` under SMTP is treated as dry-run-style no-op with a notice, or simply documented as send-only.)

**Done when:** With `DRY_RUN=true`, full flow runs with zero network calls; sender selection is driven entirely by config.

---

## Phase 5 — Logging (FR5)

**Goal:** Append-only audit trail for every attempt.

**Tasks:**

1. `logger.py` → `append_log(entry, path="outreach_log.csv")`:
   - Columns: `timestamp` (ISO-8601), `recipient_email`, `company`, `role`, `subject`, `status`, `error_message`, `word_count`.
   - Create file with header if missing; always append, never overwrite.
2. Wire into `main.py` — **every** outcome writes a row:
   - user skips → `skipped`
   - dry run → `dry_run` (or `generated`)
   - real send OK → `sent`
   - draft OK → `drafted`
   - provider error → `failed` + error message
3. Batch summary at end of run: counts of sent / drafted / skipped / failed / dry-run.

**Done when:** Two consecutive runs produce appended rows (header written once); statuses in the CSV match the actions taken.

---

## Phase 6 — Orchestrator Hardening & Guardrails

**Goal:** Finish `main.py` as the safety envelope (architecture §7).

**Tasks:**

1. Enforce `MAX_OUTREACH_PER_RUN` cap after loading targets (truncate with a notice).
2. Personalization guardrail: if a draft's hook is generic (no `personalization_note` and no usable company/role hook), flag it in the preview so the human sees it before confirming.
3. Identity binding: `From` always constructed from `SENDER_NAME`/`SMTP_USER` — recipient data can never alter the sender.
4. Word-count guardrail: warn in preview at > 150 words.
5. Error-handling pass per architecture §8: invalid rows skipped loudly, missing env for real send aborts that delivery (logged `failed`), user-confirmed sends never silently dropped.
6. Clean per-contact state machine in the loop: Loaded → Generated → Previewed → (Skipped | Delivering → Drafted/Sent/Failed), matching architecture §5.1.
7. README: setup, Gmail App Password instructions, how to run, safety notes.

**Done when:** With 7 contacts in the file and cap = 5, only 5 are processed; all failure paths print actionable messages and log rows.

---

## Phase 7 — Live Send & Proof (Acceptance)

**Goal:** Real delivery, verified, with submission artifacts.

**Tasks:**

1. Create real `.env` from `.env.example` with a Gmail App Password.
2. **First live test to self:** set `DRY_RUN=false`, contacts file containing only your own address; send one email; verify it in Gmail Sent folder.
3. Run the full batch of 5 personalized emails (send, or draft where applicable).
4. Collect proof: screenshot of 5 sent/drafted emails + final `outreach_log.csv`.
5. Verify every acceptance criterion (problem statement §17):

| Criterion | Verified by |
|-----------|-------------|
| ≥5 personalized emails generated | 5 contacts processed, log rows |
| Subject + body per email | preview output / Sent folder |
| Company/role personalization | distinct hooks in each email |
| Preview before send | interactive gate exercised |
| Send or draft succeeds | Gmail Sent/Drafts + `sent` statuses |
| Every attempt logged | `outreach_log.csv` |
| Proof available | screenshots |

**Done when:** All criteria pass; submission bundle ready (repo, screenshots, log, short write-up, sending-method note).

---

## Phase 8 — Stretch Goals (post-MVP, in priority order)

Each plugs in behind existing interfaces without changing the `main.py` contract:

1. **Gmail API draft mode** — `GmailApiEmailSender` (`gmail.compose` scope); makes `SEND_MODE=draft` real. Safest demo upgrade.
2. **CSV input** — `jobs.csv` parser in `input_loader.py`, columns mapped to `Contact`.
3. **Opt-out + dedup** — `do_not_contact.csv` filter and `RecipientRegistry` reading past log emails, applied before the loop.
4. **LLM rewriting** — `LLMEmailGenerator` behind the same `generate_email` interface + post-generation validator (word count, banned phrases, no fake-referral language).
5. **Multiple subject suggestions** — generator returns candidates; user picks in preview.
6. **Streamlit UI** — `ui/app.py` calling the same pipeline functions.
7. **Follow-up generator** — `followup_generator.py`, log rows linked via `parent_id`.

---

## Phase Dependency Overview

```text
Phase 0 (scaffold + config)
   └→ Phase 1 (models + input)
        └→ Phase 2 (generator)
             └→ Phase 3 (preview/confirm)
                  └→ Phase 4 (sender: dry-run → SMTP)
                       └→ Phase 5 (logging)
                            └→ Phase 6 (guardrails + hardening)
                                 └→ Phase 7 (live send + proof)
                                      └→ Phase 8 (stretch, any order)
```

Phases 0–2 are pure-local and risk-free; the confirmation gate (Phase 3) lands **before** any sender exists (Phase 4); real network sending is the very last MVP step (Phase 7) — mirroring the safety-by-default order of the architecture.
