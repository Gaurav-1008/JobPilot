"""Safe email delivery adapters: dry-run by default, SMTP when explicitly enabled."""

from __future__ import annotations

import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from typing import TYPE_CHECKING, Literal, Protocol

from models import Contact, EmailDraft

if TYPE_CHECKING:
    from config import AppConfig


DeliveryStatus = Literal["dry_run", "drafted", "sent", "failed"]
DeliveryMode = Literal["draft", "send"]


@dataclass(frozen=True)
class DeliveryResult:
    """The outcome of one requested delivery action."""

    status: DeliveryStatus
    provider_message_id: str | None = None
    error: str | None = None


class EmailSender(Protocol):
    """A provider capable of handling a user-confirmed send or draft action."""

    def deliver(
        self, draft: EmailDraft, contact: Contact, mode: DeliveryMode
    ) -> DeliveryResult:
        """Deliver the draft or return a safe, explicit non-delivery result."""


class DryRunEmailSender:
    """Never opens a network connection; used whenever ``DRY_RUN=true``."""

    def deliver(
        self, draft: EmailDraft, contact: Contact, mode: DeliveryMode
    ) -> DeliveryResult:
        del draft
        if mode == "draft":
            print(f"[DRY RUN] Would create a draft for {contact.recipient_email}.")
        else:
            print(f"[DRY RUN] Would send to {contact.recipient_email}.")
        return DeliveryResult(status="dry_run")


class SmtpEmailSender:
    """Send plain-text messages through an authenticated STARTTLS SMTP server."""

    def __init__(self, config: AppConfig) -> None:
        self._config = config

    def deliver(
        self, draft: EmailDraft, contact: Contact, mode: DeliveryMode
    ) -> DeliveryResult:
        if mode == "draft":
            error = (
                "SMTP cannot create Gmail drafts; no email was sent. "
                "Use DRY_RUN=true or a future Gmail API sender for real drafts."
            )
            print(f"[DRAFT MODE] {error}")
            return DeliveryResult(status="failed", error=error)

        missing = self._config.missing_smtp_settings()
        if missing:
            settings = ", ".join(missing)
            return DeliveryResult(
                status="failed",
                error=(
                    "Cannot send because these SMTP settings are missing: "
                    f"{settings}. Copy .env.example to .env, fill in the values, "
                    "or set DRY_RUN=true."
                ),
            )

        try:
            message = EmailMessage()
            # The authenticated configuration, never contact data, determines identity.
            message["From"] = f"{self._config.sender_name} <{self._config.smtp_user}>"
            message["To"] = contact.recipient_email
            message["Subject"] = draft.subject
            message.set_content(draft.body)

            with smtplib.SMTP(
                self._config.smtp_host,
                self._config.smtp_port,
                timeout=30,
            ) as smtp:
                smtp.ehlo()
                smtp.starttls(context=ssl.create_default_context())
                smtp.ehlo()
                smtp.login(self._config.smtp_user, self._config.smtp_password)
                smtp.send_message(message)

            return DeliveryResult(status="sent")
        except smtplib.SMTPAuthenticationError as exc:
            return DeliveryResult(
                status="failed",
                error=(
                    "SMTP authentication failed. For Gmail, use an App Password "
                    f"instead of your normal password. Provider response: {exc}"
                ),
            )
        except Exception as exc:
            return DeliveryResult(status="failed", error=f"SMTP delivery failed: {exc}")


def get_sender(config: AppConfig) -> EmailSender:
    """Choose the sender strictly from the resolved configuration.

    Dry-run always wins (no network). Otherwise the PROVIDER knob selects the
    Gmail API sender (real drafts and sends) or the SMTP sender.
    """
    if config.dry_run:
        return DryRunEmailSender()
    if config.provider == "gmail":
        from gmail_sender import GmailApiEmailSender

        return GmailApiEmailSender(config)
    return SmtpEmailSender(config)
