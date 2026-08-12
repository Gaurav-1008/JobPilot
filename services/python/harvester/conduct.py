"""
Scraping conduct (P2.4.1, P2.4.2) — problemStatement.md §12.4.

These are not performance knobs. The platform makes *discovering jobs*
effortless; that only stays defensible if it is also a good citizen of the sites
it discovers them from.

Deliberately absent, and it should stay that way:
  - user-agent rotation
  - proxy pools
  - header spoofing / fingerprint evasion
  - any retry-with-evasion path

EC-P2-49 / §12.4: a block is a TERMINAL state that routes the user to manual
paste. There is no escalation ladder in this codebase.
"""

from __future__ import annotations

import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser

log = logging.getLogger("jobpilot.worker.conduct")

# An honest identity with a contact URL. If a site operator wants this stopped,
# they should be able to find out who to ask.
CONTACT_URL = os.getenv("SCRAPER_CONTACT_URL", "https://github.com/Gaurav-1008")
USER_AGENT = f"JobPilotBot/0.1 (+{CONTACT_URL})"

DEFAULT_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "en",
}

# robots.txt is fetched once per host and cached for the process lifetime.
_ROBOTS: dict[str, tuple[urllib.robotparser.RobotFileParser | None, float]] = {}
_ROBOTS_TTL_SEC = 3600

# Never wait unbounded on an external host, and never buffer an unbounded body.
ROBOTS_TIMEOUT_SEC = 5.0
MAX_ROBOTS_BYTES = 512 * 1024


class RobotsDisallowed(Exception):
    """Raised when robots.txt forbids the URL. Callers report it as `blocked`."""


def _robots_for(host_root: str) -> urllib.robotparser.RobotFileParser | None:
    cached = _ROBOTS.get(host_root)
    if cached and (time.time() - cached[1]) < _ROBOTS_TTL_SEC:
        return cached[0]

    robots_url = urllib.parse.urljoin(host_root, "/robots.txt")
    parser = urllib.robotparser.RobotFileParser()
    parser.set_url(robots_url)
    try:
        # NOT parser.read(): it calls urlopen with NO TIMEOUT, so a host that
        # accepts the connection and never responds hangs the scraper forever.
        # Fetch it ourselves with a bound, then hand the text to the parser.
        request = urllib.request.Request(robots_url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=ROBOTS_TIMEOUT_SEC) as response:
            body = response.read(MAX_ROBOTS_BYTES).decode("utf-8", errors="replace")
        parser.parse(body.splitlines())
    except urllib.error.HTTPError as exc:
        # 404 is the common, healthy case: nothing published means nothing
        # forbidden.
        if exc.code == 404:
            _ROBOTS[host_root] = (None, time.time())
            return None
        log.warning("robots.txt HTTP %s for %s — proceeding", exc.code, host_root)
        _ROBOTS[host_root] = (None, time.time())
        return None
    except Exception as exc:  # noqa: BLE001
        # EC-P2-49 — DECIDED POLICY, written down rather than left to whoever
        # reads this next:
        #
        #   404 / no robots.txt  -> ALLOWED. Nothing was published, so nothing
        #                           was forbidden.
        #   network error / 5xx  -> ALLOWED, but logged. Treating a transient
        #                           outage at the robots endpoint as a blanket
        #                           ban would make the platform fail closed on
        #                           the site's bad day, which helps nobody.
        #   malformed            -> ALLOWED, logged. urllib is lenient here.
        #
        # The conservative alternative (5xx => disallow) was considered and
        # rejected: it converts someone else's transient error into our outage,
        # and robots.txt is advisory, not an access-control mechanism.
        log.warning("robots.txt unreadable for %s (%s) — proceeding", host_root, exc)
        _ROBOTS[host_root] = (None, time.time())
        return None

    _ROBOTS[host_root] = (parser, time.time())
    return parser


def check_allowed(url: str) -> None:
    """
    Raise :class:`RobotsDisallowed` if robots.txt forbids fetching ``url``.

    EC-P2-50: checked PER URL, not per host. A board may allow its search pages
    and forbid ``/job/*`` — which is exactly the pair this platform touches.
    """
    parts = urllib.parse.urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise RobotsDisallowed(f"unsupported scheme: {parts.scheme}")

    host_root = f"{parts.scheme}://{parts.netloc}"
    parser = _robots_for(host_root)
    if parser is None:
        return

    if not parser.can_fetch(USER_AGENT, url):
        raise RobotsDisallowed(f"robots.txt disallows {url}")


def crawl_delay(url: str) -> float | None:
    """Honour a site's own Crawl-delay when it publishes one."""
    parts = urllib.parse.urlsplit(url)
    parser = _robots_for(f"{parts.scheme}://{parts.netloc}")
    if parser is None:
        return None
    try:
        delay = parser.crawl_delay(USER_AGENT)
        return float(delay) if delay is not None else None
    except Exception:  # noqa: BLE001
        return None
