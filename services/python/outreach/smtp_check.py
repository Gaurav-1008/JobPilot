"""Phase 7 preflight: verify SMTP credentials without sending any email.

Run ``python smtp_check.py`` after filling in .env. It connects, upgrades to
TLS, and logs in — then quits. No message is ever composed or sent.
"""

from __future__ import annotations

import smtplib
import ssl

from config import ConfigurationError, load_config


def main() -> int:
    try:
        config = load_config()
    except ConfigurationError as exc:
        print(f"Configuration error: {exc}")
        return 1

    missing = config.missing_smtp_settings()
    if missing:
        print(f"Missing SMTP settings in .env: {', '.join(missing)}")
        return 1

    password = config.smtp_password
    normalized = password.replace(" ", "")
    if not (len(normalized) == 16 and normalized.isalpha()):
        print(
            "Warning: SMTP_PASSWORD does not look like a Gmail App Password "
            "(16 letters). Gmail rejects normal account passwords over SMTP. "
            "Create one at https://myaccount.google.com/apppasswords"
        )

    print(f"Connecting to {config.smtp_host}:{config.smtp_port} as {config.smtp_user} ...")
    try:
        with smtplib.SMTP(config.smtp_host, config.smtp_port, timeout=30) as smtp:
            smtp.ehlo()
            smtp.starttls(context=ssl.create_default_context())
            smtp.ehlo()
            smtp.login(config.smtp_user, config.smtp_password)
    except smtplib.SMTPAuthenticationError as exc:
        print("FAILED: Gmail rejected the credentials.")
        print(f"Provider response: {exc}")
        print(
            "Fix: enable 2-Step Verification, then create an App Password at "
            "https://myaccount.google.com/apppasswords and put it in "
            "SMTP_PASSWORD without spaces."
        )
        return 1
    except Exception as exc:
        print(f"FAILED: could not reach or negotiate with the SMTP server: {exc}")
        return 1

    print("SUCCESS: SMTP login works. No email was sent.")
    print("You can now run: python main.py  (with DRY_RUN=false)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
