"""Load and validate outreach targets from JSON or a demo-friendly Python list."""

from __future__ import annotations

import csv
import json
import re
from collections.abc import Mapping, Sequence
from pathlib import Path
from urllib.parse import urlparse

from models import Contact


REQUIRED_FIELDS = (
    "recipient_email",
    "company",
    "role",
    "candidate_name",
    "candidate_background",
)
OPTIONAL_TEXT_FIELDS = (
    "recipient_name",
    "personalization_note",
)
OPTIONAL_URL_FIELDS = (
    "job_url",
    "portfolio_url",
    "linkedin_url",
    "resume_link",
)
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# Use ``load_targets()`` with no path to use this small in-code data source in a
# live demo. Normal runs use the JSON file selected by INPUT_PATH.
HARDCODED_CONTACTS: list[dict[str, str]] = [
    {
        "recipient_name": "Priya",
        "recipient_email": "priya@example.com",
        "company": "Acme AI",
        "role": "Backend Engineering Intern",
        "candidate_name": "Alex Morgan",
        "candidate_background": "Python development for automation tools and AI-assisted workflows",
        "personalization_note": "I enjoyed reading about Acme AI's workflow automation tools.",
    },
    {
        "recipient_email": "devon@example.com",
        "company": "Northstar Labs",
        "role": "Software Engineering Intern",
        "candidate_name": "Alex Morgan",
        "candidate_background": "Python development for practical automation projects",
    },
]


class ContactValidationError(ValueError):
    """Raised when one contact record cannot safely be used for outreach."""


def _text_value(record: Mapping[str, object], field: str, *, required: bool) -> str | None:
    value = record.get(field)
    if value is None:
        if required:
            raise ContactValidationError(f"missing required field '{field}'")
        return None
    if not isinstance(value, str):
        raise ContactValidationError(f"'{field}' must be text")

    value = value.strip()
    if not value:
        if required:
            raise ContactValidationError(f"required field '{field}' cannot be empty")
        return None
    return value


def _validate_url(field: str, value: str | None) -> str | None:
    if value is None:
        return None

    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ContactValidationError(
            f"'{field}' must be an absolute http(s) URL; got {value!r}"
        )
    return value


def contact_from_record(record: Mapping[str, object]) -> Contact:
    """Validate one mapping and return its normalized ``Contact`` representation."""
    required = {field: _text_value(record, field, required=True) for field in REQUIRED_FIELDS}
    email = required["recipient_email"]
    if email is None or not EMAIL_PATTERN.fullmatch(email):
        raise ContactValidationError(f"'recipient_email' is not valid: {email!r}")

    optional_text = {
        field: _text_value(record, field, required=False) for field in OPTIONAL_TEXT_FIELDS
    }
    optional_urls = {
        field: _validate_url(field, _text_value(record, field, required=False))
        for field in OPTIONAL_URL_FIELDS
    }

    return Contact(
        recipient_email=email,
        company=required["company"] or "",
        role=required["role"] or "",
        candidate_name=required["candidate_name"] or "",
        candidate_background=required["candidate_background"] or "",
        recipient_name=optional_text["recipient_name"],
        personalization_note=optional_text["personalization_note"],
        job_url=optional_urls["job_url"],
        portfolio_url=optional_urls["portfolio_url"],
        linkedin_url=optional_urls["linkedin_url"],
        resume_link=optional_urls["resume_link"],
    )


def _load_json_records(path: Path) -> list[object]:
    try:
        with path.open(encoding="utf-8") as file:
            data = json.load(file)
    except FileNotFoundError:
        print(f"WARNING: Input file not found: {path}. No contacts were loaded.")
        return []
    except OSError as exc:
        print(f"WARNING: Could not read input file {path}: {exc}")
        return []
    except json.JSONDecodeError as exc:
        print(f"WARNING: Invalid JSON in {path}: {exc.msg}. No contacts were loaded.")
        return []

    if not isinstance(data, list):
        print(f"WARNING: Input file {path} must contain a JSON array. No contacts were loaded.")
        return []
    return data


def _load_csv_records(path: Path) -> list[object]:
    """Read a jobs.csv-style file into per-row mappings (Phase 8 stretch)."""
    try:
        with path.open(encoding="utf-8", newline="") as file:
            reader = csv.DictReader(file)
            # Drop empty optional cells so they fall back to Contact defaults
            # instead of failing the non-empty validation as blank strings.
            return [
                {key: value for key, value in row.items() if key and value not in (None, "")}
                for row in reader
            ]
    except FileNotFoundError:
        print(f"WARNING: Input file not found: {path}. No contacts were loaded.")
        return []
    except OSError as exc:
        print(f"WARNING: Could not read input file {path}: {exc}")
        return []


def _validated_contacts(records: Sequence[object], source: str) -> list[Contact]:
    contacts: list[Contact] = []
    for record_number, record in enumerate(records, start=1):
        if not isinstance(record, Mapping):
            print(f"WARNING: Skipping {source} record {record_number}: record must be an object.")
            continue

        try:
            contacts.append(contact_from_record(record))
        except ContactValidationError as exc:
            print(f"WARNING: Skipping {source} record {record_number}: {exc}.")
    return contacts


def load_targets(path: str | Path | None = None) -> list[Contact]:
    """Load valid contacts from ``path`` or from the in-code fallback when omitted.

    Invalid records issue a terminal warning and are skipped; one bad record never
    prevents other valid outreach targets from being loaded.
    """
    if path is None:
        return _validated_contacts(HARDCODED_CONTACTS, "hardcoded contacts")

    input_path = Path(path)
    if input_path.suffix.lower() == ".csv":
        records = _load_csv_records(input_path)
    else:
        records = _load_json_records(input_path)
    return _validated_contacts(records, str(input_path))
