"""Phase 8 stretch: a Streamlit UI over the same pipeline functions.

Run from the project root:  streamlit run ui/app.py

It reuses load_config, load_targets, the generator dispatcher, get_sender, and
append_log — the browser is just another front end for the exact same
generate -> review -> deliver -> log flow as the CLI. DRY_RUN still applies.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

# Allow importing the project modules when launched from any working directory.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import streamlit as st

from config import ConfigurationError, load_config
from email_generator import get_generator
from email_sender import get_sender
from input_loader import load_targets
from logger import append_log
from models import Contact, LogEntry


def _log_entry(contact: Contact, draft, status: str, error: str = "") -> LogEntry:
    return LogEntry(
        timestamp=datetime.now(timezone.utc).isoformat(),
        recipient_email=contact.recipient_email,
        company=contact.company,
        role=contact.role,
        subject=draft.subject,
        status=status,
        error_message=error,
        word_count=draft.word_count,
    )


st.set_page_config(page_title="The Closer", page_icon="✉️")
st.title("The Closer — Cold Email Writer")

try:
    config = load_config()
except ConfigurationError as exc:
    st.error(f"Configuration error: {exc}")
    st.stop()

mode = "DRY RUN (no email leaves your machine)" if config.dry_run else f"LIVE via {config.provider.upper()}"
st.caption(f"Mode: {mode} · generator: {'LLM' if config.use_llm else 'template'}")

contacts = load_targets(config.input_path)
if not contacts:
    st.warning(f"No valid contacts loaded from {config.input_path}.")
    st.stop()

labels = [f"{c.company} — {c.role} <{c.recipient_email}>" for c in contacts]
selection = st.selectbox("Choose a contact", range(len(contacts)), format_func=lambda i: labels[i])
contact = contacts[selection]

generate = get_generator(config)
draft = generate(contact, config)

chosen_subject = st.selectbox(
    "Subject line",
    draft.subject_options or [draft.subject],
)
draft.subject = chosen_subject

st.subheader("Preview")
st.text(f"To: {contact.recipient_name or 'there'} <{contact.recipient_email}>")
st.text(f"Subject: {chosen_subject}")
st.text_area("Body", draft.body, height=280, disabled=True)

warn = f"{draft.word_count} words"
if draft.word_limit_exceeded or draft.word_count > 150:
    st.warning(f"{warn} — over the 150-word limit.")
else:
    st.caption(warn)
if draft.generic_hook:
    st.warning("The personalization hook is generic. Add a company/role detail first.")

col_send, col_draft, col_skip = st.columns(3)


def _deliver(mode_choice: str) -> None:
    sender = get_sender(config)
    result = sender.deliver(draft, contact, mode_choice)
    append_log(_log_entry(contact, draft, result.status, result.error or ""), config.log_path)
    if result.status == "failed":
        st.error(f"{result.status}: {result.error}")
    else:
        st.success(f"{result.status} — logged to {config.log_path}")


with col_send:
    if st.button("Send"):
        _deliver("send")
with col_draft:
    if st.button("Draft"):
        _deliver("draft")
with col_skip:
    if st.button("Skip (log only)"):
        append_log(_log_entry(contact, draft, "skipped"), config.log_path)
        st.info(f"skipped — logged to {config.log_path}")
