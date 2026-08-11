"""Deterministic, safety-first cold-email generation."""

from __future__ import annotations

import warnings
from typing import TYPE_CHECKING

from models import Contact, EmailDraft

if TYPE_CHECKING:
    from config import AppConfig


WORD_LIMIT = 150
CTA_BLOCK = "Would you be open to a quick chat about the {role} opportunity?"


def subject_options(contact: Contact) -> list[str]:
    """Offer a few short, specific subject lines for the operator to choose from."""
    options = [f"Quick note on the {contact.role} role at {contact.company}"]
    if contact.company.strip():
        options.append(f"{contact.candidate_name} — interested in {contact.company}'s {contact.role} role")
    options.append(f"Reaching out about the {contact.role} opening")
    # Preserve order while removing accidental duplicates.
    seen: set[str] = set()
    unique = []
    for option in options:
        if option not in seen:
            seen.add(option)
            unique.append(option)
    return unique


def _personalization_hook(contact: Contact) -> str:
    """Use a supplied detail when available, otherwise derive a truthful fallback."""
    if contact.personalization_note:
        return contact.personalization_note
    if contact.company.strip() and contact.role.strip():
        return f"I noticed {contact.company} is hiring for the {contact.role} role."
    return "I'm reaching out about a relevant opportunity."


def _has_generic_hook(contact: Contact) -> bool:
    """Flag drafts without a supplied note or a usable company-and-role fallback."""
    return not contact.personalization_note and not (
        contact.company.strip() and contact.role.strip()
    )


def _body_for(contact: Contact) -> str:
    """Build the six-part email body using only supplied contact data."""
    greeting = f"Hi {contact.recipient_name}," if contact.recipient_name else "Hi there,"
    hook = _personalization_hook(contact)
    cta = CTA_BLOCK.format(role=contact.role)

    sections = [
        greeting,
        hook,
        (
            f"I'm {contact.candidate_name}, with a background in "
            f"{contact.candidate_background}."
        ),
        (
            f"The {contact.role} opportunity at {contact.company} feels closely "
            "connected to the practical work in my background."
        ),
        cta,
        f"Best,\n{contact.candidate_name}",
    ]
    if contact.portfolio_url:
        sections[-1] = f"{sections[-1]}\n{contact.portfolio_url}"

    body = "\n\n".join(sections)
    if body.count(cta) != 1:
        raise RuntimeError("Email template must contain exactly one call-to-action block.")
    return body


def generate_email(contact: Contact, config: AppConfig) -> EmailDraft:
    """Create a personalized email draft without adding facts not present in input.

    ``config`` is accepted now so later generators can share the same interface;
    the deterministic Phase 2 template intentionally needs no configuration.
    """
    del config

    options = subject_options(contact)
    subject = options[0]
    body = _body_for(contact)
    word_count = len(body.split())
    word_limit_exceeded = word_count > WORD_LIMIT
    generic_hook = _has_generic_hook(contact)

    if word_limit_exceeded:
        warnings.warn(
            f"Email for {contact.recipient_email} is {word_count} words; "
            f"the recommended maximum is {WORD_LIMIT}.",
            UserWarning,
            stacklevel=2,
        )

    return EmailDraft(
        subject=subject,
        body=body,
        word_count=word_count,
        word_limit_exceeded=word_limit_exceeded,
        generic_hook=generic_hook,
        subject_options=options,
        source="template",
    )


def get_generator(config: AppConfig):
    """Return the active generator callable, honoring the USE_LLM stretch flag.

    Both generators share the ``generate_email(contact, config) -> EmailDraft``
    signature, so the orchestrator does not need to know which one it received.
    The LLM generator falls back to this template internally on any failure.
    """
    if config.use_llm:
        from llm_generator import llm_generate_email

        return llm_generate_email
    return generate_email
