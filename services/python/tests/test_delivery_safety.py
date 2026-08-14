"""
Safety tests 6 and 9 for ④ (architecture.md §19, P5.6.6 / P5.6.8).

These live in Python rather than alongside the TypeScript suite because this is
where a socket would actually be opened. Asserting "dry run does not send" from
① proves only that ① did not call ④; the claim that matters is that ④ itself
opens nothing, and that can only be checked here.

EC-P5-60 is explicit that the assertion must be made AT THE SOCKET LAYER, not
by inspecting a boolean. So `socket.socket` is patched and counted, rather than
trusting `mode == "dry_run"` to have been honored.
"""

from __future__ import annotations

import os
import socket
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402

SECRET = "hunter2SuperSecretAppPassword"


@pytest.fixture(name="client")
def _client() -> TestClient:
    """
    A client that carries the service token, when one is configured.

    main.py now loads the repo `.env`, so WORKER_SERVICE_TOKEN is usually set
    and the middleware enforces it — as it always intended to. These tests
    exercise the HANDLERS, not the gate, so they authenticate rather than
    disable it: sending the real header keeps the auth middleware in the path
    (a regression that broke it would still surface) without every assertion
    turning into a 403.

    Falls back to no header when no token is configured, which is the valid
    local setup outside production.
    """
    token = os.getenv("WORKER_SERVICE_TOKEN", "")
    headers = {"x-service-token": token} if token else {}
    return TestClient(app, raise_server_exceptions=False, headers=headers)


def _credentials() -> dict:
    return {
        "provider": "smtp",
        "smtp_host": "smtp.example.com",
        "smtp_port": 587,
        "smtp_user": "me@example.com",
        "smtp_password": SECRET,
        "sender_name": "Gaurav K",
        "gmail_access_token": None,
    }


def _count_sockets(fn) -> int:
    """Run `fn`, returning how many sockets were constructed while it ran."""
    original = socket.socket
    opened: list[tuple] = []

    def spy(*args, **kwargs):
        opened.append(args)
        return original(*args, **kwargs)

    socket.socket = spy
    try:
        fn()
    finally:
        socket.socket = original
    return len(opened)


class TestSafetyTest6DryRunOpensNoSocket:
    """`DRY_RUN=true` → zero network activity, asserted at the transport."""

    def test_dry_run_opens_no_socket_beyond_the_test_client_baseline(self, client):
        # The in-process TestClient constructs sockets of its own for every
        # request, so the meaningful assertion is RELATIVE: a dry-run delivery
        # must cost exactly what a trivial GET costs, and not one socket more.
        baseline = _count_sockets(lambda: client.get("/health"))

        during_dry_run = _count_sockets(
            lambda: client.post(
                "/email/deliver",
                json={
                    "credentials": _credentials(),
                    "to": "priya@acme.com",
                    "subject": "Quick note",
                    "body": "Hi Priya,\n\nBest,\nGaurav K",
                    "mode": "dry_run",
                },
            )
        )

        assert during_dry_run == baseline, (
            "dry run opened a socket: delivery code ran before the mode check"
        )

    def test_dry_run_still_reports_an_outcome(self, client):
        # Zero network must not mean zero audit. The row still gets written by
        # ①, so ④ has to answer with a real status rather than an error.
        response = client.post(
            "/email/deliver",
            json={
                "credentials": _credentials(),
                "to": "priya@acme.com",
                "subject": "Quick note",
                "body": "Hi Priya,",
                "mode": "dry_run",
            },
        )
        assert response.status_code == 200
        assert response.json()["status"] == "drafted"
        assert response.json()["error"] is None

    def test_dry_run_works_with_no_credentials_at_all(self, client):
        # A user who has never connected an account must still be able to
        # exercise the whole pipeline. This is the self-test path.
        response = client.post(
            "/email/deliver",
            json={
                "credentials": {
                    "provider": "smtp",
                    "smtp_host": None, "smtp_port": None,
                    "smtp_user": None, "smtp_password": None,
                    "sender_name": None, "gmail_access_token": None,
                },
                "to": "priya@acme.com",
                "subject": "s",
                "body": "b",
                "mode": "dry_run",
            },
        )
        assert response.status_code == 200
        assert response.json()["status"] == "drafted"


class TestCredentialsNeverLeak:
    """EC-P5-61 — force a 422 and grep the whole response for the secret."""

    def test_validation_error_does_not_echo_the_credential(self, client):
        response = client.post(
            "/email/deliver",
            json={
                "credentials": {**_credentials(), "smtp_port": "NOT_AN_INT"},
                "to": "priya@acme.com",
                "subject": "s",
                "body": "b",
                "mode": "send",
            },
        )
        assert response.status_code == 422
        # FastAPI's default handler puts the offending value in `input`. Ours
        # keeps only the field location and the error type.
        assert SECRET not in response.text
        assert "input" not in response.json()["detail"][0]

    def test_validation_error_is_still_useful_for_debugging(self, client):
        response = client.post(
            "/email/deliver",
            json={
                "credentials": {**_credentials(), "smtp_port": "NOT_AN_INT"},
                "to": "a@b.com", "subject": "s", "body": "b", "mode": "send",
            },
        )
        detail = response.json()["detail"][0]
        # Redaction that removes the field name too would make 422s unfixable.
        assert "smtp_port" in detail["loc"]
        assert detail["type"]


class TestSafetyTest9TemplateFallback:
    """
    An email claiming an unsupported credential falls back to the template.

    ① owns the grounding BLOCK (§13.3) and the fallback decision; ④'s half of
    the guarantee is that the template path is always reachable and never
    depends on the LLM. Without a GROQ key it must still return a usable body.
    """

    def test_generation_without_an_llm_key_still_produces_an_email(
        self, client, monkeypatch
    ):
        monkeypatch.delenv("GROQ_API_KEY", raising=False)

        response = client.post(
            "/email/generate",
            json={
                "contact": {
                    "recipient_email": "priya@acme.com",
                    "recipient_name": "Priya",
                    "company": "Acme",
                    "role": "Platform Engineer",
                    "job_url": None,
                    "personalization_note": None,
                },
                "sender": {
                    "candidate_name": "Gaurav K",
                    "candidate_background": "backend systems",
                    "portfolio_url": None,
                    "linkedin_url": None,
                },
                "personalization": None,
                "use_llm": True,
                "word_limit": 150,
            },
        )

        assert response.status_code == 200
        body = response.json()
        # EC-P5-28: a missing key is the template path, never an error.
        assert body["source"] == "template"
        assert body["body"].strip()
        assert len(body["subject_options"]) >= 2

    def test_honest_gaps_never_appear_in_the_generated_body(self, client):
        # EC-P5-24: gaps are a SUPPRESSION list, not content. An email that
        # names them ("I have no Kubernetes experience, but...") has leaked the
        # one thing the payload exists to keep out.
        response = client.post(
            "/email/generate",
            json={
                "contact": {
                    "recipient_email": "priya@acme.com",
                    "recipient_name": "Priya",
                    "company": "Acme",
                    "role": "Platform Engineer",
                    "job_url": None,
                    "personalization_note": None,
                },
                "sender": {
                    "candidate_name": "Gaurav K",
                    "candidate_background": "backend systems",
                    "portfolio_url": None,
                    "linkedin_url": None,
                },
                "personalization": {
                    "top_matched_skills": ["Python"],
                    "strongest_bullet": "Built an ingestion pipeline",
                    "jd_hooks": ["fintech payments"],
                    "match_score": 78,
                    "honest_gaps": ["Kubernetes", "Terraform"],
                },
                "use_llm": False,
                "word_limit": 150,
            },
        )

        body = response.json()["body"]
        assert "Kubernetes" not in body
        assert "Terraform" not in body

    def test_a_null_payload_is_reported_rather_than_hidden(self, client):
        # EC-P5-20/22: the caller must be able to tell a generic email from a
        # personalized one, because per FR7 the former can indicate a bug.
        response = client.post(
            "/email/generate",
            json={
                "contact": {
                    "recipient_email": "priya@acme.com",
                    "recipient_name": "Priya",
                    "company": "Acme",
                    "role": "Platform Engineer",
                    "job_url": None,
                    "personalization_note": None,
                },
                "sender": {
                    "candidate_name": "Gaurav K",
                    "candidate_background": "backend",
                    "portfolio_url": None,
                    "linkedin_url": None,
                },
                "personalization": None,
                "use_llm": False,
                "word_limit": 150,
            },
        )
        assert "no_personalization" in response.json()["warnings"]
