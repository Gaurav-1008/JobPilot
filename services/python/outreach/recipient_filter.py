"""Phase 8 guardrails: opt-out suppression and recipient deduplication.

Both filters run once, before the outreach loop, so a suppressed or
already-contacted recipient never reaches the generator or the sender.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from models import Contact

if TYPE_CHECKING:
    from config import AppConfig


# Statuses that count as "already reached out" for deduplication.
_CONTACTED_STATUSES = {"sent", "drafted"}


def _normalize(email: str) -> str:
    return email.strip().lower()


def load_opt_outs(path: str | Path) -> set[str]:
    """Read suppressed addresses from a do_not_contact file (one per line or CSV).

    Accepts a plain list of emails or a CSV with a ``recipient_email`` (or
    ``email``) column. A missing file simply means no suppressions.
    """
    opt_out_path = Path(path)
    if not opt_out_path.exists():
        return set()

    emails: set[str] = set()
    try:
        with opt_out_path.open(encoding="utf-8", newline="") as file:
            reader = csv.reader(file)
            rows = list(reader)
    except OSError as exc:
        print(f"WARNING: Could not read opt-out file {opt_out_path}: {exc}")
        return set()

    if not rows:
        return set()

    header = [cell.strip().lower() for cell in rows[0]]
    email_column = None
    for candidate in ("recipient_email", "email"):
        if candidate in header:
            email_column = header.index(candidate)
            break

    data_rows = rows[1:] if email_column is not None else rows
    for row in data_rows:
        if not row:
            continue
        cell = row[email_column] if email_column is not None else row[0]
        if cell and "@" in cell:
            emails.add(_normalize(cell))
    return emails


def load_prior_recipients(log_path: str | Path) -> set[str]:
    """Return addresses already sent or drafted, read from the audit log."""
    path = Path(log_path)
    if not path.exists():
        return set()

    contacted: set[str] = set()
    try:
        with path.open(encoding="utf-8", newline="") as file:
            for row in csv.DictReader(file):
                if row.get("status", "").strip().lower() in _CONTACTED_STATUSES:
                    email = row.get("recipient_email", "")
                    if email:
                        contacted.add(_normalize(email))
    except OSError as exc:
        print(f"WARNING: Could not read log for deduplication {path}: {exc}")
    return contacted


@dataclass
class FilterResult:
    """The kept contacts plus what was removed and why."""

    kept: list[Contact]
    opted_out: list[Contact]
    duplicates: list[Contact]


def filter_contacts(contacts: list[Contact], config: AppConfig) -> FilterResult:
    """Drop opt-outs (always) and prior recipients (when DEDUPE is enabled)."""
    opt_outs = load_opt_outs(config.opt_out_path)
    prior = load_prior_recipients(config.log_path) if config.dedupe else set()

    kept: list[Contact] = []
    opted_out: list[Contact] = []
    duplicates: list[Contact] = []

    for contact in contacts:
        email = _normalize(contact.recipient_email)
        if email in opt_outs:
            opted_out.append(contact)
            print(f"Opt-out: skipping {contact.recipient_email} (on {config.opt_out_path}).")
        elif email in prior:
            duplicates.append(contact)
            print(f"Duplicate: skipping {contact.recipient_email} (already contacted).")
        else:
            kept.append(contact)

    return FilterResult(kept=kept, opted_out=opted_out, duplicates=duplicates)
