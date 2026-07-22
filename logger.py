"""Append-only CSV audit logging for outreach actions."""

from __future__ import annotations

import csv
from pathlib import Path

from models import LogEntry


LOG_COLUMNS = (
    "timestamp",
    "recipient_email",
    "company",
    "role",
    "subject",
    "status",
    "error_message",
    "word_count",
    # Phase 8: empty for original outreach, set for follow-ups.
    "parent_id",
)


def _row(entry: LogEntry) -> dict[str, object]:
    return {
        "timestamp": entry.timestamp,
        "recipient_email": entry.recipient_email,
        "company": entry.company,
        "role": entry.role,
        "subject": entry.subject,
        "status": entry.status,
        "error_message": entry.error_message,
        "word_count": entry.word_count,
        "parent_id": entry.parent_id,
    }


def _upgrade_header_if_needed(log_path: Path) -> None:
    """Add any newly introduced columns to an older log without losing history.

    Reads every existing row, then rewrites the file with the full current
    header and the same rows (missing fields default to empty). This preserves
    all prior audit history; it only widens the schema in place.
    """
    with log_path.open(encoding="utf-8", newline="") as file:
        reader = csv.reader(file)
        rows = list(reader)

    if not rows:
        return
    existing_header = rows[0]
    if existing_header == list(LOG_COLUMNS):
        return

    data_rows = rows[1:]
    with log_path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=LOG_COLUMNS)
        writer.writeheader()
        for values in data_rows:
            record = dict(zip(existing_header, values))
            writer.writerow({column: record.get(column, "") for column in LOG_COLUMNS})


def append_log(entry: LogEntry, path: str | Path = "outreach_log.csv") -> None:
    """Append one audit row, creating the CSV and header only when necessary."""
    log_path = Path(path)
    if log_path.exists() and log_path.stat().st_size > 0:
        _upgrade_header_if_needed(log_path)
        needs_header = False
    else:
        needs_header = True

    with log_path.open("a", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=LOG_COLUMNS)
        if needs_header:
            writer.writeheader()
        writer.writerow(_row(entry))
