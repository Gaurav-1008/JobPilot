"""Phase 8 stretch: a Gmail API sender that can create real drafts or send.

Selected with ``PROVIDER=gmail`` and ``DRY_RUN=false``. Unlike SMTP, the Gmail
API supports a true ``draft`` mode, which is the safest way to demo real
delivery. Google libraries are imported lazily so the rest of the app runs
without them installed.
"""

from __future__ import annotations

import base64
from email.message import EmailMessage
from typing import TYPE_CHECKING

from email_sender import DeliveryMode, DeliveryResult
from models import Contact, EmailDraft

if TYPE_CHECKING:
    from config import AppConfig


# gmail.compose covers both creating drafts and sending.
GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.compose"]

_MISSING_LIBS_HINT = (
    "Gmail API libraries are not installed. Run: pip install "
    "google-api-python-client google-auth-httplib2 google-auth-oauthlib"
)


class GmailApiEmailSender:
    """Create Gmail drafts or send via the Gmail REST API using OAuth."""

    def __init__(self, config: AppConfig) -> None:
        self._config = config

    def _build_service(self):
        """Authorize with OAuth (refreshing or prompting once) and return the client."""
        import os

        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from googleapiclient.discovery import build

        creds = None
        token_path = self._config.gmail_token_path
        if os.path.exists(token_path):
            creds = Credentials.from_authorized_user_file(token_path, GMAIL_SCOPES)

        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                flow = InstalledAppFlow.from_client_secrets_file(
                    self._config.gmail_credentials_path, GMAIL_SCOPES
                )
                creds = flow.run_local_server(port=0)
            with open(token_path, "w", encoding="utf-8") as token_file:
                token_file.write(creds.to_json())

        return build("gmail", "v1", credentials=creds)

    def _encode(self, draft: EmailDraft, contact: Contact) -> dict[str, str]:
        message = EmailMessage()
        # Identity comes from the authenticated account, never from contact data.
        message["From"] = f"{self._config.sender_name} <{self._config.smtp_user}>"
        message["To"] = contact.recipient_email
        message["Subject"] = draft.subject
        message.set_content(draft.body)
        raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
        return {"raw": raw}

    def deliver(
        self, draft: EmailDraft, contact: Contact, mode: DeliveryMode
    ) -> DeliveryResult:
        try:
            service = self._build_service()
            encoded = self._encode(draft, contact)
            if mode == "draft":
                created = (
                    service.users()
                    .drafts()
                    .create(userId="me", body={"message": encoded})
                    .execute()
                )
                return DeliveryResult(status="drafted", provider_message_id=created.get("id"))
            sent = service.users().messages().send(userId="me", body=encoded).execute()
            return DeliveryResult(status="sent", provider_message_id=sent.get("id"))
        except ImportError:
            return DeliveryResult(status="failed", error=_MISSING_LIBS_HINT)
        except FileNotFoundError:
            return DeliveryResult(
                status="failed",
                error=(
                    f"Gmail OAuth client file not found at "
                    f"{self._config.gmail_credentials_path}. Download it from the "
                    "Google Cloud Console (OAuth client, Desktop app) and set "
                    "GMAIL_CREDENTIALS_PATH."
                ),
            )
        except Exception as exc:
            return DeliveryResult(status="failed", error=f"Gmail API delivery failed: {exc}")
