"""Configuration loading and validation for The Closer."""

from __future__ import annotations

import os
from dataclasses import dataclass, replace
from typing import Literal

from dotenv import load_dotenv


class ConfigurationError(ValueError):
    """Raised when an environment setting is invalid or unsafe to use."""


@dataclass(frozen=True)
class AppConfig:
    """Resolved application configuration, loaded exclusively from environment."""

    smtp_host: str
    smtp_port: int
    smtp_user: str
    smtp_password: str
    sender_name: str
    dry_run: bool
    send_mode: Literal["draft", "send"]
    max_outreach_per_run: int
    input_path: str
    # Phase 8 stretch settings.
    provider: Literal["smtp", "gmail"]
    log_path: str
    opt_out_path: str
    dedupe: bool
    use_llm: bool
    llm_model: str
    # Groq is the platform's single LLM provider, reached through its
    # OpenAI-compatible endpoint. Replaces the Anthropic key this project
    # originally used for email rewriting.
    groq_api_key: str
    groq_base_url: str
    gmail_credentials_path: str
    gmail_token_path: str

    def missing_smtp_settings(self) -> tuple[str, ...]:
        """Return the configuration values required for an actual SMTP send."""
        return tuple(
            name
            for name, value in {
                "SMTP_HOST": self.smtp_host,
                "SMTP_USER": self.smtp_user,
                "SMTP_PASSWORD": self.smtp_password,
                "SENDER_NAME": self.sender_name,
            }.items()
            if not value
        )

    def masked_values(self) -> dict[str, object]:
        """Return values suitable for terminal output without exposing credentials."""
        return {
            "SMTP_HOST": self.smtp_host,
            "SMTP_PORT": self.smtp_port,
            "SMTP_USER": self.smtp_user or "(not set)",
            "SMTP_PASSWORD": "********" if self.smtp_password else "(not set)",
            "SENDER_NAME": self.sender_name or "(not set)",
            "DRY_RUN": self.dry_run,
            "SEND_MODE": self.send_mode,
            "MAX_OUTREACH_PER_RUN": self.max_outreach_per_run,
            "INPUT_PATH": self.input_path,
        }


def _read(name: str, default: str = "") -> str:
    """Read and trim an environment value, retaining explicit empty values."""
    return os.getenv(name, default).strip()


def _parse_bool(name: str, value: str) -> bool:
    accepted_true = {"1", "true", "yes", "on"}
    accepted_false = {"0", "false", "no", "off"}
    normalized = value.lower()

    if normalized in accepted_true:
        return True
    if normalized in accepted_false:
        return False
    raise ConfigurationError(
        f"{name} must be one of true/false, yes/no, on/off, or 1/0; got {value!r}."
    )


def _parse_int(name: str, value: str, *, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise ConfigurationError(f"{name} must be an integer; got {value!r}.") from exc

    if not minimum <= parsed <= maximum:
        raise ConfigurationError(
            f"{name} must be between {minimum} and {maximum}; got {parsed}."
        )
    return parsed


def load_config() -> AppConfig:
    """Load ``.env`` values and parse all safety knobs before a run begins."""
    load_dotenv()

    send_mode = _read("SEND_MODE", "draft").lower()
    if send_mode not in {"draft", "send"}:
        raise ConfigurationError(
            f"SEND_MODE must be 'draft' or 'send'; got {send_mode!r}."
        )

    provider = _read("PROVIDER", "smtp").lower()
    if provider not in {"smtp", "gmail"}:
        raise ConfigurationError(
            f"PROVIDER must be 'smtp' or 'gmail'; got {provider!r}."
        )

    config = AppConfig(
        smtp_host=_read("SMTP_HOST", "smtp.gmail.com"),
        smtp_port=_parse_int("SMTP_PORT", _read("SMTP_PORT", "587"), minimum=1, maximum=65535),
        smtp_user=_read("SMTP_USER"),
        smtp_password=_read("SMTP_PASSWORD"),
        sender_name=_read("SENDER_NAME"),
        dry_run=_parse_bool("DRY_RUN", _read("DRY_RUN", "true")),
        send_mode=send_mode,
        max_outreach_per_run=_parse_int(
            "MAX_OUTREACH_PER_RUN",
            _read("MAX_OUTREACH_PER_RUN", "5"),
            minimum=1,
            maximum=10_000,
        ),
        input_path=_read("INPUT_PATH", "contacts.json"),
        provider=provider,
        log_path=_read("LOG_PATH", "outreach_log.csv"),
        opt_out_path=_read("OPT_OUT_PATH", "do_not_contact.csv"),
        dedupe=_parse_bool("DEDUPE", _read("DEDUPE", "false")),
        use_llm=_parse_bool("USE_LLM", _read("USE_LLM", "false")),
        # EC-P0-04: renamed from LLM_MODEL. Resume-Builder uses that same name
        # for its Groq tailoring model; in a merged deployment whichever service
        # read it last won, and the failure was a wrong-model call, not a crash.
        # The default is now a Groq model — the platform is single-provider.
        llm_model=_read("EMAIL_LLM_MODEL", "llama-3.3-70b-versatile"),
        groq_api_key=_read("GROQ_API_KEY"),
        groq_base_url=_read("GROQ_BASE_URL", "https://api.groq.com/openai/v1"),
        gmail_credentials_path=_read("GMAIL_CREDENTIALS_PATH", "credentials.json"),
        gmail_token_path=_read("GMAIL_TOKEN_PATH", "token.json"),
    )

    if not config.input_path:
        raise ConfigurationError("INPUT_PATH cannot be empty.")
    if not config.log_path:
        raise ConfigurationError("LOG_PATH cannot be empty.")

    config = _force_dry_run_in_unsafe_environments(config)
    return config


# Environments that must never be able to email a real person, whatever the
# operator or a stray .env says. Production is deliberately absent.
_FORCED_DRY_RUN_ENVS = frozenset({"local", "test", "ci", "staging"})


def _force_dry_run_in_unsafe_environments(config: AppConfig) -> AppConfig:
    """Override DRY_RUN=false outside production (P0.4.4, EC-P0-27, EC-P7-23).

    The override is applied here, at the end of ``load_config()``, rather than
    at module import — a value captured at import time cannot be exercised by a
    test that patches the environment afterwards, which is the specific trap
    EC-P0-27 describes.

    Staging is included on purpose: architecture.md §17 requires staging to force
    dry-run at the platform level, ignoring per-user settings, so that a staging
    bug cannot reach a real inbox.
    """
    env = _read("JOBPILOT_ENV", "local").strip().lower()
    if env in _FORCED_DRY_RUN_ENVS and not config.dry_run:
        return replace(config, dry_run=True)
    return config
