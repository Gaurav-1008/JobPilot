"""Domain models shared across The Closer pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Contact:
    """A validated outreach target and the candidate details used to contact them."""

    recipient_email: str
    company: str
    role: str
    candidate_name: str
    candidate_background: str
    recipient_name: str | None = None
    job_url: str | None = None
    portfolio_url: str | None = None
    personalization_note: str | None = None
    linkedin_url: str | None = None
    resume_link: str | None = None


@dataclass
class EmailDraft:
    """A generated email, ready for preview in a later phase."""

    subject: str
    body: str
    word_count: int
    word_limit_exceeded: bool = False
    generic_hook: bool = False
    # Phase 8: alternate subject lines the operator can choose from at preview.
    subject_options: list[str] = field(default_factory=list)
    # Phase 8: how the body was produced ("template" or "llm").
    source: str = "template"


@dataclass
class LogEntry:
    """A single audit-log record, written by the Phase 5 logger."""

    timestamp: str
    recipient_email: str
    company: str
    role: str
    subject: str
    status: str
    error_message: str = ""
    word_count: int = 0
    # Phase 8: links a follow-up back to the original outreach it references.
    parent_id: str = ""
