"""
Single-URL JD hydration (P3.1.1) — closes Breakage 1.

Firecrawl first, Playwright as fallback, and `blocked` as an honest terminal
state that routes the user to manual paste. There is no third attempt and no
evasion ladder (§12.4).

THE QUIET FAILURE THIS FILE EXISTS TO PREVENT (EC-P3-22/23): a login wall or an
expired-posting page answers HTTP 200 with perfectly readable text. Everything
downstream then "succeeds" — the JD parses into near-empty fields, the score
computes low, the tailoring runs unhelpfully, and the user blames the AI. It has
to be caught HERE, at the fetch boundary, where the evidence still exists.
"""

from __future__ import annotations

import logging
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

# services/python (for lib.*) and services/python/harvester (for conduct).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from conduct import RobotsDisallowed, USER_AGENT, check_allowed  # noqa: E402
from lib.ssrf_guard import (  # noqa: E402
    MAX_REDIRECTS,
    MAX_RESPONSE_BYTES,
    SsrfBlocked,
    TOTAL_TIMEOUT_SEC,
    validate_url,
)

log = logging.getLogger("jobpilot.worker.fetcher")

# EC-P3-24: no real job description is shorter than this. A "page" this small is
# a redirect stub, a cookie wall, or an error.
MIN_JD_CHARS = 300

# EC-P3-25: a whole page including nav, footer, cookie banner and twelve other
# job cards. Cap before the extraction prompt or it costs real money and
# overflows context.
MAX_JD_CHARS = 60_000

# EC-P3-22/23 — markers of a page that is NOT a job description, checked only
# when the text is also suspiciously short. Requiring both keeps a JD that
# merely mentions "sign in to apply" from being thrown away.
_WALL_MARKERS = re.compile(
    r"(sign in to continue|log in to continue|create an account to|"
    r"enable javascript|verify you are human|access denied|are you a robot|"
    r"this job (?:posting )?(?:is )?no longer|position has been filled|"
    r"job not found|expired)",
    re.I,
)


@dataclass
class FetchResult:
    raw_text: str
    method: str            # "firecrawl" | "playwright"
    blocked: bool
    reason: str | None


def _classify(text: str) -> tuple[bool, str | None]:
    """Return ``(blocked, reason)`` for text we managed to retrieve."""
    stripped = text.strip()

    if len(stripped) < MIN_JD_CHARS:
        # Short AND wall-shaped is a wall; short alone is still unusable.
        if _WALL_MARKERS.search(stripped):
            return True, "login_or_bot_wall"
        return True, "too_short"

    # A long page that is mostly a wall marker near the top is still a wall.
    if _WALL_MARKERS.search(stripped[:600]) and len(stripped) < MIN_JD_CHARS * 4:
        return True, "login_or_bot_wall"

    return False, None


def _truncate(text: str) -> str:
    return text[:MAX_JD_CHARS] if len(text) > MAX_JD_CHARS else text


def _via_firecrawl(url: str) -> str | None:
    """Primary path. Returns markdown text, or None if unavailable."""
    api_key = os.getenv("FIRECRAWL_API_KEY")
    if not api_key:
        return None
    try:
        import firecrawl

        # EC-P3-20 — Firecrawl fetches from THEIR infrastructure, which can
        # reach hosts we cannot. Delegating the fetch does not delegate the
        # responsibility, so the URL is validated before we hand it over.
        client = firecrawl.Firecrawl(api_key=api_key)
        doc = client.scrape(url, formats=["markdown"])
        text = getattr(doc, "markdown", None) or (
            doc.get("markdown") if isinstance(doc, dict) else None
        )
        return text or None
    except Exception as exc:  # noqa: BLE001
        log.warning("firecrawl failed for %s: %s", url, exc)
        return None


def _via_playwright(url: str) -> str | None:
    """
    Fallback for JS-rendered pages (EC-P3-27).

    Playwright follows redirects internally, below our validation layer
    (EC-P3-21), so redirects are intercepted and each hop re-validated.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return None

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            try:
                context = browser.new_context(user_agent=USER_AGENT)
                page = context.new_page()
                hops = {"n": 0}

                def on_request(request):
                    if request.is_navigation_request() and request.redirected_from:
                        hops["n"] += 1
                        if hops["n"] > MAX_REDIRECTS:
                            raise SsrfBlocked("too many redirects")
                        # EC-P3-12: EVERY hop, not just the first.
                        validate_url(request.url)

                page.on("request", on_request)
                # EC-P2-12: never wait unbounded on a page that never idles.
                page.goto(url, timeout=int(TOTAL_TIMEOUT_SEC * 1000),
                          wait_until="domcontentloaded")
                text = page.inner_text("body")
                return text
            finally:
                # EC-P2-13: contexts leak and the container OOMs without this.
                browser.close()
    except Exception as exc:  # noqa: BLE001
        log.warning("playwright failed for %s: %s", url, exc)
        return None


def fetch_job_description(url: str) -> FetchResult:
    """
    Fetch readable JD text for one listing URL.

    Never raises for a fetch problem: every failure is a `blocked` result with a
    reason, because the caller's job is to route the user to manual paste rather
    than to dead-end them (FR2).
    """
    # 1. SSRF. Before anything reaches the network, including Firecrawl.
    try:
        validate_url(url)
    except SsrfBlocked as exc:
        return FetchResult("", "playwright", True, f"ssrf_blocked: {exc}")

    # 2. Conduct. robots.txt is checked PER URL (EC-P2-50): a board may allow
    #    its search pages and forbid /job/*, which is exactly this pair.
    try:
        check_allowed(url)
    except RobotsDisallowed as exc:
        return FetchResult("", "playwright", True, f"robots_disallowed: {exc}")

    # 3. Firecrawl, then Playwright.
    text = _via_firecrawl(url)
    method = "firecrawl"
    if not text or len(text.strip()) < MIN_JD_CHARS:
        fallback = _via_playwright(url)
        if fallback and len(fallback.strip()) >= len((text or "").strip()):
            text, method = fallback, "playwright"

    if not text:
        return FetchResult("", method, True, "no_content")

    text = _truncate(text)
    blocked, reason = _classify(text)
    # EC-P3-46: report the method that actually PRODUCED the text, not the one
    # attempted first.
    return FetchResult(text if not blocked else "", method, blocked, reason)
