"""
Preflight and delivery (P5.5.2, P5.5.4).

═══════════════════════════════════════════════════════════════════════════
CREDENTIALS ARRIVE PER REQUEST, ARE USED, AND ARE DISCARDED.

Not cached, not written to disk, not held in a module global, not logged
(§14.4, EC-P5-62). ④ is stateless by design, and "for performance" is not a
reason to keep an app password in memory between two HTTP requests.

This is deliberately NOT a wrapper over `email_sender.py` / `gmail_sender.py`.
Those read credentials from `AppConfig` and a `token.json` on disk — the single
-user CLI model. P5.5.3 says never to migrate `token.json`, so the transport
logic is reimplemented here against per-request credentials. The SMTP handshake
mirrors `smtp_check.py` exactly; only where the secret comes from has changed.
═══════════════════════════════════════════════════════════════════════════

EC-P5-60 — `mode="dry_run"` must open ZERO sockets. The dry-run branch returns
before any transport object is constructed, and the safety suite asserts this at
the socket layer rather than by trusting this comment.
"""

from __future__ import annotations

import base64
import json
import logging
import smtplib
import ssl
import urllib.error
import urllib.request
from email.message import EmailMessage

from fastapi import APIRouter
from pydantic import BaseModel

log = logging.getLogger("jobpilot.worker.delivery")

router = APIRouter(prefix="/email", tags=["email"])

GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"


class WireCredentials(BaseModel):
    provider: str
    smtp_host: str | None = None
    smtp_port: int | None = None
    smtp_user: str | None = None
    smtp_password: str | None = None
    sender_name: str | None = None
    gmail_access_token: str | None = None


class PreflightRequest(BaseModel):
    credentials: WireCredentials


class PreflightResponse(BaseModel):
    ok: bool
    reason: str | None = None


class EmailDeliverRequest(BaseModel):
    credentials: WireCredentials
    to: str
    subject: str
    body: str
    mode: str


class EmailDeliverResponse(BaseModel):
    status: str
    provider_message_id: str | None = None
    error: str | None = None


def _smtp_connect(creds: WireCredentials) -> smtplib.SMTP:
    """
    Connect, STARTTLS, and log in.

    EC-P5-68 — `create_default_context()` verifies the certificate chain and the
    hostname, and that is never relaxed. An app password sent over an unverified
    TLS connection is a credential handed to whoever answered the socket, and a
    "just for testing" flag here would be the most dangerous line in the file.
    """
    smtp = smtplib.SMTP(creds.smtp_host, creds.smtp_port or 587, timeout=30)
    smtp.ehlo()
    smtp.starttls(context=ssl.create_default_context())
    smtp.ehlo()
    smtp.login(creds.smtp_user or "", creds.smtp_password or "")
    return smtp


@router.post("/preflight", response_model=PreflightResponse)
def preflight(body: PreflightRequest) -> PreflightResponse:
    """
    Verify credentials without composing or sending anything (P5.5.2).

    A port of `smtp_check.py`'s handshake. ① records `preflight_ok_at` on
    success; interlock check 11 refuses to send without it, so a revoked app
    password blocks at the gate rather than failing at the provider (EC-P5-63).
    """
    creds = body.credentials

    if creds.provider == "gmail_api":
        if not creds.gmail_access_token:
            return PreflightResponse(ok=False, reason="No Google authorization.")
        try:
            request = urllib.request.Request(
                f"{GMAIL_API}/profile",
                headers={"Authorization": f"Bearer {creds.gmail_access_token}"},
            )
            with urllib.request.urlopen(request, timeout=30) as response:
                json.load(response)
            return PreflightResponse(ok=True, reason=None)
        except urllib.error.HTTPError as exc:
            # The status is safe to report; the response body may echo the token.
            return PreflightResponse(
                ok=False, reason=f"Google rejected the authorization ({exc.code})."
            )
        except Exception:
            return PreflightResponse(ok=False, reason="Could not reach Google.")

    missing = [
        name
        for name, value in (
            ("SMTP host", creds.smtp_host),
            ("SMTP user", creds.smtp_user),
            ("SMTP password", creds.smtp_password),
        )
        if not value
    ]
    if missing:
        return PreflightResponse(ok=False, reason=f"Missing: {', '.join(missing)}.")

    try:
        with _smtp_connect(creds) as smtp:
            smtp.noop()
    except smtplib.SMTPAuthenticationError:
        # Inherited guidance from smtp_check.py — the single most common cause.
        return PreflightResponse(
            ok=False,
            reason=(
                "The mail server rejected these credentials. For Gmail you need "
                "an App Password (16 letters), not your account password."
            ),
        )
    except ssl.SSLError:
        return PreflightResponse(
            ok=False, reason="The server's TLS certificate could not be verified."
        )
    except Exception as exc:  # noqa: BLE001 - reported to the user, not raised
        return PreflightResponse(ok=False, reason=f"Could not connect: {type(exc).__name__}.")

    return PreflightResponse(ok=True, reason=None)


def _build_message(body: EmailDeliverRequest) -> EmailMessage:
    message = EmailMessage()
    message["To"] = body.to
    message["Subject"] = body.subject
    sender = body.credentials.sender_name
    if sender and body.credentials.smtp_user:
        message["From"] = f"{sender} <{body.credentials.smtp_user}>"
    elif body.credentials.smtp_user:
        message["From"] = body.credentials.smtp_user
    message.set_content(body.body)
    return message


def _gmail_call(path: str, token: str, payload: dict) -> dict:
    request = urllib.request.Request(
        f"{GMAIL_API}/{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        return json.load(response)


@router.post("/deliver", response_model=EmailDeliverResponse)
def deliver(body: EmailDeliverRequest) -> EmailDeliverResponse:
    # ── EC-P5-60: dry run returns before ANY transport exists ──────────────
    # No socket, no SMTP object, no urllib request. This branch is first so
    # that no later edit can accidentally construct a connection above it.
    if body.mode == "dry_run":
        log.info("email.deliver mode=dry_run (no network)")
        return EmailDeliverResponse(
            status="drafted", provider_message_id=None, error=None
        )

    creds = body.credentials

    try:
        if creds.provider == "gmail_api":
            if not creds.gmail_access_token:
                return EmailDeliverResponse(
                    status="failed", provider_message_id=None,
                    error="No Google authorization.",
                )
            raw = base64.urlsafe_b64encode(
                _build_message(body).as_bytes()
            ).decode("ascii")

            if body.mode == "send":
                result = _gmail_call("messages/send", creds.gmail_access_token, {"raw": raw})
                return EmailDeliverResponse(
                    status="sent", provider_message_id=result.get("id"), error=None
                )

            result = _gmail_call(
                "drafts", creds.gmail_access_token, {"message": {"raw": raw}}
            )
            return EmailDeliverResponse(
                status="drafted", provider_message_id=result.get("id"), error=None
            )

        # ── SMTP ───────────────────────────────────────────────────────────
        # SMTP has no concept of a remote draft. `draft` mode therefore cannot
        # be honored here, and silently sending instead would be the single
        # worst possible behavior in this file — the user asked for a draft.
        if body.mode == "draft":
            return EmailDeliverResponse(
                status="failed",
                provider_message_id=None,
                error=(
                    "SMTP cannot create drafts. Connect Google to use draft mode, "
                    "or switch send mode to 'send'."
                ),
            )

        with _smtp_connect(creds) as smtp:
            smtp.send_message(_build_message(body))
        # SMTP returns no durable message id; the audit row records the attempt.
        return EmailDeliverResponse(status="sent", provider_message_id=None, error=None)

    except smtplib.SMTPAuthenticationError:
        # EC-P5-64/63: ① clears preflight_ok_at on this, so the next send is
        # blocked at check 11 instead of failing here again.
        return EmailDeliverResponse(
            status="failed", provider_message_id=None,
            error="auth_failed: the mail server rejected these credentials.",
        )
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            return EmailDeliverResponse(
                status="failed", provider_message_id=None,
                error="auth_failed: Google rejected the authorization.",
            )
        # EC-P5-66: quota is not transient within the window — never retried.
        if exc.code == 429:
            return EmailDeliverResponse(
                status="failed", provider_message_id=None,
                error="quota_exceeded: the provider's sending limit was reached.",
            )
        return EmailDeliverResponse(
            status="failed", provider_message_id=None,
            error=f"provider_error: {exc.code}",
        )
    except ssl.SSLError:
        return EmailDeliverResponse(
            status="failed", provider_message_id=None,
            error="tls_error: the server's certificate could not be verified.",
        )
    except Exception as exc:  # noqa: BLE001
        # Type name only. The exception's string form can carry the address, the
        # body, or in some client libraries the credentials themselves.
        return EmailDeliverResponse(
            status="failed", provider_message_id=None,
            error=f"delivery_failed: {type(exc).__name__}",
        )
