"""
Email generation (P5.2.3).

A thin wrapper over The Closer's `email_generator.py` and `llm_generator.py`.
Per ADR-002 this service is a PURE FUNCTION service: no database, no queue, no
cross-call state. The contact, the sender identity, and the evidence all arrive
in the request body; ① owns every row that results.

THE PIPELINE NEVER REQUIRES THE LLM TO WORK. A missing key, a missing
dependency, a rate limit, a timeout, a truncated completion, or a draft that
fails validation all resolve the same way: the deterministic six-part template,
reported honestly as `source="template"`. That is inherited behavior (🟢) and
it is the reason a Groq outage degrades the emails instead of stopping outreach
(EC-P5-28, EC-P5-29).
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel, Field

# Same shape as boards.py/hydrate.py: the source project is a flat set of
# modules with a CLI at its root, so the directory goes on sys.path and the
# modules import directly (EC-P0-07).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "outreach"))

from email_generator import generate_email, subject_options  # noqa: E402
from llm_generator import llm_generate_email  # noqa: E402
from models import Contact  # noqa: E402

log = logging.getLogger("jobpilot.worker.email")

router = APIRouter(prefix="/email", tags=["email"])


class WireContact(BaseModel):
    recipient_email: str
    recipient_name: str | None = None
    company: str
    role: str
    job_url: str | None = None
    personalization_note: str | None = None


class SenderIdentity(BaseModel):
    candidate_name: str
    candidate_background: str
    portfolio_url: str | None = None
    linkedin_url: str | None = None


class WirePersonalization(BaseModel):
    top_matched_skills: list[str] = Field(default_factory=list)
    strongest_bullet: str | None = None
    jd_hooks: list[str] = Field(default_factory=list)
    match_score: int = 0
    honest_gaps: list[str] = Field(default_factory=list)


class EmailGenerateRequest(BaseModel):
    contact: WireContact
    sender: SenderIdentity
    # EC-P5-20: null is a supported, ordinary state — not an error. It means no
    # tailoring run exists, so the template runs and the caller is warned.
    personalization: WirePersonalization | None = None
    use_llm: bool = True
    word_limit: int = 150


class EmailGenerateResponse(BaseModel):
    subject_options: list[str]
    body: str
    word_count: int
    source: str
    warnings: list[str]


class _GenConfig:
    """
    The four settings the generators actually read.

    Deliberately NOT `config.AppConfig`: that loads and validates a `.env` for
    SMTP credentials, paths, and send modes — none of which exist in a stateless
    service, and all of which would be per-process state in a service that must
    not have any. The generators only touch these four attributes.
    """

    def __init__(self) -> None:
        self.use_llm = True
        self.groq_api_key = os.getenv("GROQ_API_KEY", "")
        self.groq_base_url = os.getenv(
            "GROQ_BASE_URL", "https://api.groq.com/openai/v1"
        )
        # EC-P0-04: the email model is its own setting. Sharing one LLM_MODEL
        # with the tailoring chain was the original collision.
        self.llm_model = os.getenv("EMAIL_LLM_MODEL", "llama-3.1-8b-instant")


def _to_legacy_contact(body: EmailGenerateRequest) -> Contact:
    """Map the wire shape onto the dataclass the generators already expect."""
    return Contact(
        recipient_email=body.contact.recipient_email,
        company=body.contact.company,
        role=body.contact.role,
        candidate_name=body.sender.candidate_name,
        candidate_background=body.sender.candidate_background,
        recipient_name=body.contact.recipient_name,
        job_url=body.contact.job_url,
        portfolio_url=body.sender.portfolio_url,
        personalization_note=body.contact.personalization_note,
        linkedin_url=body.sender.linkedin_url,
    )


@router.post("/generate", response_model=EmailGenerateResponse)
def generate(body: EmailGenerateRequest) -> EmailGenerateResponse:
    contact = _to_legacy_contact(body)
    config = _GenConfig()

    personalization = (
        body.personalization.model_dump() if body.personalization else None
    )

    # P5.2.8 / EC-P5-28: an absent key is not an error condition here. It is the
    # template path, and the caller is told which path ran via `source`.
    use_llm = body.use_llm and bool(config.groq_api_key)

    if use_llm:
        draft = llm_generate_email(contact, config, personalization)
    else:
        draft = generate_email(contact, config)

    warnings: list[str] = []

    # P5.2.6 / EC-P5-22 — a generic hook with a payload available is a payload
    # BUG, not merely a weak email, and ① logs it as a quality metric. Reported
    # separately from the plain no-payload case so the two stay distinguishable.
    if draft.generic_hook:
        warnings.append("generic_hook")
    if personalization is None:
        warnings.append("no_personalization")
    elif not personalization.get("top_matched_skills"):
        warnings.append("empty_matched_skills")

    # The request's word_limit drives this WARNING. The hard gate that triggers
    # a template fallback stays at llm_generator's own WORD_LIMIT, unchanged —
    # EC-P5-30 says to tune the prompt and BANNED_PHRASES, never the limit.
    if draft.word_count > body.word_limit:
        warnings.append("word_limit_exceeded")

    # EC-P5-39: 2-3 DISTINCT options, or the review screen offers a fake choice.
    options = [o for o in (draft.subject_options or []) if o.strip()]
    deduped: list[str] = []
    for option in options:
        if option not in deduped:
            deduped.append(option)
    if len(deduped) < 2:
        deduped = subject_options(contact)

    # No recipient address, no body, no credentials — path and outcome only.
    log.info(
        "email.generate source=%s words=%d warnings=%s",
        draft.source,
        draft.word_count,
        ",".join(warnings) or "none",
    )

    return EmailGenerateResponse(
        subject_options=deduped,
        body=draft.body,
        word_count=draft.word_count,
        source=draft.source,
        warnings=warnings,
    )
