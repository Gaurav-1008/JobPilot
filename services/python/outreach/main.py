"""CLI entry point for The Closer."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone

from config import ConfigurationError, load_config
from email_generator import get_generator
from email_sender import get_sender
from input_loader import load_targets
from logger import append_log
from models import Contact, EmailDraft, LogEntry
from preview import choose_subject, preview_email, prompt_action
from recipient_filter import filter_contacts


def _log_entry(
    contact: Contact, draft: EmailDraft, status: str, error_message: str = ""
) -> LogEntry:
    """Create a complete audit row from the state of one contact pipeline run."""
    return LogEntry(
        timestamp=datetime.now(timezone.utc).isoformat(),
        recipient_email=contact.recipient_email,
        company=contact.company,
        role=contact.role,
        subject=draft.subject,
        status=status,
        error_message=error_message,
        word_count=draft.word_count,
    )


def _print_summary(counts: Counter[str]) -> None:
    """Print every Phase 5 outcome count, including zero-value categories."""
    print("\nBatch summary")
    print(f"Sent: {counts['sent']}")
    print(f"Drafted: {counts['drafted']}")
    print(f"Skipped: {counts['skipped']}")
    print(f"Failed: {counts['failed']}")
    print(f"Dry-run: {counts['dry_run']}")


def main() -> int:
    """Generate, review, deliver safely, and audit every contact outcome."""
    try:
        config = load_config()
    except ConfigurationError as exc:
        print(f"Configuration error: {exc}")
        return 1

    contacts = load_targets(config.input_path)
    loaded_count = len(contacts)
    print(f"Loaded {loaded_count} valid contact(s) from {config.input_path}.")

    # Phase 8: suppress opt-outs (always) and prior recipients (when DEDUPE=true).
    filtered = filter_contacts(contacts, config)
    contacts = filtered.kept
    if filtered.opted_out or filtered.duplicates:
        print(
            f"Filtered out {len(filtered.opted_out)} opt-out(s) and "
            f"{len(filtered.duplicates)} duplicate(s)."
        )

    if len(contacts) > config.max_outreach_per_run:
        capped_from = len(contacts)
        contacts = contacts[: config.max_outreach_per_run]
        print(
            "MAX_OUTREACH_PER_RUN cap applied: processing "
            f"{len(contacts)} of {capped_from} eligible contact(s)."
        )

    generate = get_generator(config)
    sender = get_sender(config)
    counts: Counter[str] = Counter()
    for contact in contacts:
        draft = generate(contact, config)
        preview_email(draft, contact)
        draft.subject = choose_subject(draft)
        action = prompt_action()
        if action == "skip":
            append_log(_log_entry(contact, draft, status="skipped"), config.log_path)
            counts["skipped"] += 1
            print(f"Selected action for {contact.recipient_email}: skip")
            continue

        result = sender.deliver(draft, contact, action)
        append_log(
            _log_entry(
                contact,
                draft,
                status=result.status,
                error_message=result.error or "",
            ),
            config.log_path,
        )
        counts[result.status] += 1
        print(f"Delivery result for {contact.recipient_email}: {result.status}")
        if result.error:
            print(f"Delivery detail: {result.error}")
    _print_summary(counts)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
