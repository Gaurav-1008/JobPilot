"""Phase 8 stretch: generate short follow-ups for prior outreach.

Run ``python followup_generator.py``. It loads the same contacts, finds those
already sent or drafted in the audit log, generates a brief, polite follow-up
that references the original note, and (after the usual preview + confirm)
delivers and logs it with ``parent_id`` set to the original subject so the two
rows are linked in ``outreach_log.csv``.
"""

from __future__ import annotations

import csv
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from config import AppConfig, ConfigurationError, load_config
from email_generator import WORD_LIMIT, subject_options
from email_sender import get_sender
from input_loader import load_targets
from logger import append_log
from models import Contact, EmailDraft, LogEntry
from preview import preview_email, prompt_action

_CONTACTED_STATUSES = {"sent", "drafted"}
_FOLLOWUP_CTA = "Would a brief chat about the {role} role still be possible?"


def prior_outreach(log_path: str | Path) -> dict[str, str]:
    """Map lower-cased recipient email -> most recent sent/drafted subject."""
    path = Path(log_path)
    if not path.exists():
        return {}

    latest: dict[str, str] = {}
    with path.open(encoding="utf-8", newline="") as file:
        for row in csv.DictReader(file):
            if row.get("status", "").strip().lower() in _CONTACTED_STATUSES:
                email = row.get("recipient_email", "").strip().lower()
                if email:
                    # Later rows overwrite earlier ones -> keeps the most recent.
                    latest[email] = row.get("subject", "")
    return latest


def generate_followup(contact: Contact, config: AppConfig) -> EmailDraft:
    """Build a short follow-up that references, but does not repeat, the original."""
    del config
    greeting = f"Hi {contact.recipient_name}," if contact.recipient_name else "Hi there,"
    sections = [
        greeting,
        (
            f"I wanted to follow up on my earlier note about the {contact.role} "
            f"role at {contact.company}."
        ),
        (
            "I know inboxes get busy, so no worries if the timing isn't right — "
            "I remain genuinely interested in the opportunity."
        ),
        _FOLLOWUP_CTA.format(role=contact.role),
        f"Best,\n{contact.candidate_name}",
    ]
    if contact.portfolio_url:
        sections[-1] = f"{sections[-1]}\n{contact.portfolio_url}"

    body = "\n\n".join(sections)
    word_count = len(body.split())
    options = [f"Following up: {opt}" for opt in subject_options(contact)]
    return EmailDraft(
        subject=options[0],
        body=body,
        word_count=word_count,
        word_limit_exceeded=word_count > WORD_LIMIT,
        subject_options=options,
        source="template",
    )


def _log_followup(
    contact: Contact, draft: EmailDraft, status: str, parent_id: str, error: str = ""
) -> LogEntry:
    return LogEntry(
        timestamp=datetime.now(timezone.utc).isoformat(),
        recipient_email=contact.recipient_email,
        company=contact.company,
        role=contact.role,
        subject=draft.subject,
        status=status,
        error_message=error,
        word_count=draft.word_count,
        parent_id=parent_id,
    )


def main() -> int:
    try:
        config = load_config()
    except ConfigurationError as exc:
        print(f"Configuration error: {exc}")
        return 1

    contacts = load_targets(config.input_path)
    contacted = prior_outreach(config.log_path)
    targets = [c for c in contacts if c.recipient_email.strip().lower() in contacted]

    if not targets:
        print(
            "No prior sent/drafted outreach found in "
            f"{config.log_path} for the current contacts. Nothing to follow up on."
        )
        return 0

    print(f"Found {len(targets)} contact(s) eligible for a follow-up.")
    sender = get_sender(config)
    counts: Counter[str] = Counter()
    for contact in targets:
        parent_id = contacted[contact.recipient_email.strip().lower()]
        draft = generate_followup(contact, config)
        preview_email(draft, contact)
        action = prompt_action()
        if action == "skip":
            append_log(_log_followup(contact, draft, "skipped", parent_id), config.log_path)
            counts["skipped"] += 1
            print(f"Selected action for {contact.recipient_email}: skip")
            continue

        result = sender.deliver(draft, contact, action)
        append_log(
            _log_followup(contact, draft, result.status, parent_id, result.error or ""),
            config.log_path,
        )
        counts[result.status] += 1
        print(f"Follow-up result for {contact.recipient_email}: {result.status}")
        if result.error:
            print(f"Delivery detail: {result.error}")

    print("\nFollow-up summary")
    for status in ("sent", "drafted", "skipped", "failed", "dry_run"):
        print(f"{status}: {counts[status]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
