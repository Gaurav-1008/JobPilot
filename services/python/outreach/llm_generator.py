"""Phase 8 stretch: an LLM-backed generator behind the template interface.

``llm_generate_email`` has the same ``(contact, config) -> EmailDraft``
signature as the deterministic template generator. It rewrites only the body,
validates the result against the same safety constraints the template enforces,
and falls back to the template on any failure (missing dependency, missing key,
API error, refusal, or a draft that fails validation). This keeps the pipeline
runnable with no API key configured.

Provider: Groq, via its OpenAI-compatible endpoint and the ``openai`` client —
the same provider and client style ① already uses for the tailoring chain. The
platform is deliberately single-provider: one key, one rate limiter, one failure
mode to reason about.

Note for anyone tuning this: the validator below was written against Claude's
output. A different model family fails differently (more verbose, different
stock phrasings), so the validator is now doing more work than it used to. If
you see the template fallback firing often, tune BANNED_PHRASES and the prompt
before raising WORD_LIMIT.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from email_generator import WORD_LIMIT, generate_email, subject_options
from models import Contact, EmailDraft

if TYPE_CHECKING:
    from config import AppConfig


# Language that would imply a relationship or referral the candidate never had.
# The template never produces these; the validator blocks the LLM from doing so.
BANNED_PHRASES = (
    "as discussed",
    "as we discussed",
    "per our conversation",
    "referred by",
    "referred me",
    "was referred",
    "our mutual friend",
    "we met",
    "as promised",
    "following up on our call",
    "great speaking with you",
)

SYSTEM_PROMPT = (
    "You write short, honest cold outreach emails for a job seeker. "
    "Follow every rule exactly:\n"
    "- Use only the facts provided. Never invent experience, referrals, prior "
    "conversations, or relationships.\n"
    "- Keep the whole email under 150 words.\n"
    "- Include exactly one clear ask (a quick chat or pointer to the right person).\n"
    "- Professional but natural; no exaggerated claims.\n"
    "- Output only the email body, starting with the greeting and ending with the "
    "sign-off. No subject line, no preamble, no explanation."
)


def _build_user_prompt(contact: Contact) -> str:
    lines = [
        f"Recipient name: {contact.recipient_name or 'unknown'}",
        f"Company: {contact.company}",
        f"Role: {contact.role}",
        f"Candidate name: {contact.candidate_name}",
        f"Candidate background: {contact.candidate_background}",
    ]
    if contact.personalization_note:
        lines.append(f"Personalization note: {contact.personalization_note}")
    if contact.portfolio_url:
        lines.append(f"Portfolio URL (include in sign-off): {contact.portfolio_url}")
    return "Write the cold email body using these details:\n" + "\n".join(lines)


def _extract_text(response) -> str:
    """Pull the body text out of an OpenAI-compatible chat completion."""
    choices = getattr(response, "choices", None) or []
    if not choices:
        return ""
    return (getattr(choices[0].message, "content", None) or "").strip()


def _validation_error(body: str, contact: Contact) -> str | None:
    """Return a reason the LLM body is unsafe to use, or None if it passes."""
    if not body:
        return "empty response"
    word_count = len(body.split())
    if word_count > WORD_LIMIT:
        return f"{word_count} words exceeds the {WORD_LIMIT}-word limit"
    lowered = body.lower()
    for phrase in BANNED_PHRASES:
        if phrase in lowered:
            return f"contains fabricated-relationship phrase {phrase!r}"
    if contact.candidate_name and contact.candidate_name.lower() not in lowered:
        return "omits the candidate's name"
    return None


def llm_generate_email(contact: Contact, config: AppConfig) -> EmailDraft:
    """Generate the body with Groq; fall back to the template on any problem."""
    try:
        from openai import OpenAI
    except ImportError:
        print("LLM fallback: 'openai' is not installed; using the template.")
        return generate_email(contact, config)

    if not config.groq_api_key:
        print("LLM fallback: GROQ_API_KEY is not set; using the template.")
        return generate_email(contact, config)

    try:
        client = OpenAI(
            api_key=config.groq_api_key,
            base_url=config.groq_base_url,
        )
        response = client.chat.completions.create(
            model=config.llm_model,
            max_tokens=1024,
            temperature=0.5,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": _build_user_prompt(contact)},
            ],
        )
    except Exception as exc:  # network, auth, rate limit, or configuration failure
        print(f"LLM fallback for {contact.recipient_email}: request failed ({exc}). Using template.")
        return generate_email(contact, config)

    # A truncated completion is not a usable email — treat it like a refusal.
    if getattr(response.choices[0], "finish_reason", None) not in (None, "stop"):
        print(f"LLM fallback for {contact.recipient_email}: incomplete response. Using template.")
        return generate_email(contact, config)

    body = _extract_text(response)
    # Normalize any stray triple newlines the model may emit.
    body = re.sub(r"\n{3,}", "\n\n", body).strip()

    problem = _validation_error(body, contact)
    if problem:
        print(f"LLM fallback for {contact.recipient_email}: draft rejected ({problem}). Using template.")
        return generate_email(contact, config)

    options = subject_options(contact)
    word_count = len(body.split())
    return EmailDraft(
        subject=options[0],
        body=body,
        word_count=word_count,
        word_limit_exceeded=word_count > WORD_LIMIT,
        generic_hook=not contact.personalization_note
        and not (contact.company.strip() and contact.role.strip()),
        subject_options=options,
        source="llm",
    )
