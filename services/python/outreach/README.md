# The Closer

A safety-first CLI for generating, reviewing, and sending personalized cold
outreach emails. This repository implements through **Phase 8**: project
configuration, validated contact loading, deterministic email generation,
human review, dry-run-first sending, audit logging, safety guardrails, a
verified live-send path with an SMTP preflight check, and the stretch goals
(CSV input, opt-out/dedup, LLM rewriting, multiple subjects, follow-ups, a
Gmail API sender, and a Streamlit UI).

## Setup

1. Use Python 3.10 or newer.
2. Install the dependency:

   ```bash
   python -m pip install -r requirements.txt
   ```

3. Optionally copy `.env.example` to `.env` and customize its values. The
   application is safe without a `.env` file: it defaults to `DRY_RUN=true`.
4. Run the scaffold:

   ```bash
   python main.py
   ```

The command loads valid records from `contacts.json`, shows a complete preview
for each, and waits for an explicit `send`, `draft`, or `skip` decision. This
phase routes a confirmed action to the sender. With the default `DRY_RUN=true`,
the sender only prints what it would do and never opens a network connection.
Bad records are skipped with an actionable warning, so they cannot block the
rest of a batch. Call `load_targets()` without an input path to use the small
hardcoded demo list in `input_loader.py`.

Generated emails use a deterministic six-part template. They use a supplied
personalization note when available and otherwise mention the supplied company
and role. Missing recipient names become `Hi there`, and a missing portfolio
URL is omitted. Drafts over 150 words are visibly flagged.

SMTP sending is available only for an explicitly confirmed `send` action with
`DRY_RUN=false`. Such a run requires `SMTP_USER`, `SMTP_PASSWORD`, and
`SENDER_NAME`. Missing settings fail that confirmed delivery clearly and are
written to the audit log; they never open a provider connection. Set
`DRY_RUN=false` only after configuring valid SMTP credentials. SMTP does not
create Gmail drafts, so a real `draft` action is safely reported as unsupported
and sends nothing.

## Audit log

Every preview decision is appended to `outreach_log.csv`, including skips,
dry-runs, and failed attempts. It records the UTC timestamp, recipient,
company, role, subject, final status, error (if any), and word count. The file
is append-only and ignored by Git.

## Safety defaults

- `DRY_RUN=true`
- `SEND_MODE=draft`
- `MAX_OUTREACH_PER_RUN=5`
- `.env` and `outreach_log.csv` are excluded from Git

## Gmail App Password setup

For a real Gmail SMTP send, keep `DRY_RUN=true` while configuring the account:

1. Enable two-step verification on the Google account that will send mail.
2. Create a Gmail App Password for Mail in Google Account security settings.
3. Copy `.env.example` to `.env`, then set `SMTP_USER` to the sending Gmail
   address, `SMTP_PASSWORD` to the App Password, and `SENDER_NAME` to the
   sender's display name.
4. Test one self-addressed email with `DRY_RUN=false` before using any other
   contact.

The app caps each run at `MAX_OUTREACH_PER_RUN`, requires a preview decision,
and warns about generic personalization or drafts exceeding 150 words.

## Phase 7 — live send runbook

Phase 7 turns off dry-run and proves the real Gmail path works. Do the steps in
order; the self-test comes before any outreach to real contacts.

1. **Preflight the credentials (no email sent).** `smtp_check.py` connects to
   Gmail over STARTTLS and logs in, then quits without composing a message:

   ```bash
   python smtp_check.py
   ```

   It prints `SUCCESS: SMTP login works.` when the App Password is valid, or a
   specific fix if Gmail rejects the credentials.

2. **Send one self-test.** Point `INPUT_PATH` at a one-record file containing
   only your own address and confirm `send` at the prompt with `DRY_RUN=false`.
   Verify the message in your Gmail **Sent** folder and confirm a `sent` row was
   appended to `outreach_log.csv`.

3. **Run the real batch** only after the self-test lands, respecting
   `MAX_OUTREACH_PER_RUN` and reviewing every preview before confirming.

4. **Collect proof** for submission: a screenshot of the sent/drafted emails and
   the `outreach_log.csv` rows.

### Acceptance criteria status

| Criterion | Status |
|-----------|--------|
| Generate ≥5 personalized emails | Met — 5 records in `contacts.json`, distinct per company/role |
| Subject line and body per email | Met — six-part template |
| Company/role-specific personalization | Met — note or company+role hook, generic hooks flagged |
| Preview before send | Met — mandatory `send/draft/skip` gate |
| Send or draft successfully | Met — verified live self-send returned `sent` |
| Log each attempt | Met — every outcome appended to `outreach_log.csv` |
| Proof available | Operator step — screenshot Sent folder + attach the log |

## Phase 8 — stretch goals

All stretch features are off by default and plug in behind the existing
interfaces, so the core `load → generate → preview → confirm → deliver → log`
flow is unchanged. Enable them via `.env`. Optional dependencies are commented
in `requirements.txt` — install only the ones you use.

| Feature | Enable with | Notes |
|---------|-------------|-------|
| CSV input | `INPUT_PATH=jobs.csv` | A `.csv` file is parsed and validated the same way as JSON; columns map to contact fields. |
| Opt-out suppression | `OPT_OUT_PATH=do_not_contact.csv` | Always applied when the file exists. Accepts a plain email-per-line list or a CSV with a `recipient_email` column. |
| Deduplication | `DEDUPE=true` | Skips recipients already marked `sent`/`drafted` in `LOG_PATH`. |
| Multiple subject lines | (always on) | The generator offers 2–3 subjects; the operator picks one at preview. |
| LLM rewriting | `USE_LLM=true` (+ `GROQ_API_KEY`) | **Changed in the JobPilot merge:** rewriting now goes through Groq (default `llama-3.3-70b-versatile`, set `EMAIL_LLM_MODEL`), not Anthropic — the platform is single-provider, see `docs/architecture.md` §12.2. The post-generation validator is unchanged: it enforces the ≤150-word limit and blocks fabricated-relationship language; any failure falls back to the template, so runs never break without a key. |
| Gmail API sender | `PROVIDER=gmail` + `DRY_RUN=false` | Real drafts (safest) or sends via OAuth. Needs `credentials.json` (Desktop OAuth client from Google Cloud) — first run opens a browser and stores `token.json`. Both files are git-ignored. |
| Streamlit UI | `streamlit run ui/app.py` | A browser front end over the same pipeline functions; respects `DRY_RUN`. |
| Follow-ups | `python followup_generator.py` | Finds contacts already sent/drafted in the log, generates a short follow-up referencing the original, and logs it with `parent_id` linking the two rows. |

The audit log gains a `parent_id` column in Phase 8. An existing log written by
an earlier phase is upgraded in place on the next write — all prior rows are
preserved and get an empty `parent_id`.
