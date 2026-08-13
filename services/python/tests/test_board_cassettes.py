"""
Board adapter cassette tests — Phase 2 exit gate, "every board has a cassette
test" (architecture.md §19: recorded HTML/JSON, never live sites in CI).

═══════════════════════════════════════════════════════════════════════════
THE ADAPTERS ARE NOT MODIFIED, AND MUST NOT BE.

A separate Phase 2 exit gate requires `boards/*.py` to stay byte-identical to
the source project. So every seam used here is a monkeypatch at the NETWORK
BOUNDARY — `requests.get` for the two HTTP boards, `_create_client` for the
Firecrawl one. Nothing test-shaped was added to production code, which also
means these tests cannot pass against a seam that only exists for tests.
═══════════════════════════════════════════════════════════════════════════

What this suite is worth, stated honestly: the cassettes are hand-authored to
the DOM and payload contracts the adapters target, not captured from the live
sites (see cassettes/README.md). They catch a PARSER regression — a changed
selector, a dropped field, broken URL joining, altered scoring. They cannot
catch a BOARD changing its markup, because nothing here was ever a real
capture. That second failure still shows up the way it always did: a harvest
returning zero rows for a board that used to work.

The fallback-selector cassette is the one most worth having. Fallback paths rot
silently — nothing exercises them until the primary selector stops matching,
which is the worst possible moment to find out they were broken years ago.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

HARVESTER = Path(__file__).resolve().parent.parent / "harvester"
sys.path.insert(0, str(HARVESTER))

CASSETTES = Path(__file__).resolve().parent / "cassettes"

from boards.naukri import NaukriAdapter  # noqa: E402
from boards.remoteok import RemoteOKAdapter  # noqa: E402
from boards.wellfound import WellfoundAdapter  # noqa: E402


def cassette(name: str) -> str:
    return (CASSETTES / name).read_text(encoding="utf-8")


class FakeResponse:
    """The two fields the adapters read off a `requests` response."""

    def __init__(self, *, status_code: int = 200, text: str = "", payload=None):
        self.status_code = status_code
        self.text = text
        self._payload = payload

    def json(self):
        if self._payload is None:
            raise ValueError("no JSON payload")
        return self._payload


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    """
    Belt and braces: any adapter reaching the network fails loudly instead of
    quietly hitting a real board from a test run. Individual tests install their
    own `requests.get` over the top of this.
    """
    import socket

    def blocked(*args, **kwargs):
        raise AssertionError("test attempted a live network connection")

    monkeypatch.setattr(socket, "socket", blocked)
    monkeypatch.setattr(socket, "create_connection", blocked)


# ════════════════════════════════════════════════════════════════════════
# Naukri — HTML
# ════════════════════════════════════════════════════════════════════════

@pytest.fixture(name="naukri_html")
def _naukri_html(monkeypatch):
    """Serve a recorded page, and record the URL the adapter asked for."""
    seen: dict[str, str] = {}

    def install(filename: str, status_code: int = 200):
        import boards.naukri as mod

        def fake_get(url, **kwargs):
            seen["url"] = url
            return FakeResponse(status_code=status_code, text=cassette(filename))

        monkeypatch.setattr(mod.requests, "get", fake_get)
        # The adapter sleeps 1s after the request; tests should not.
        monkeypatch.setattr(mod.time, "sleep", lambda _s: None)
        return seen

    return install


class TestNaukri:
    def test_parses_a_complete_card(self, naukri_html):
        naukri_html("naukri_search.html")
        rows = NaukriAdapter().fetch("AI Engineer", "Bengaluru")

        assert rows[0] == {
            "source": "naukri",
            "title": "AI Engineer",
            "company": "Acme Analytics",
            "location": "Bengaluru",
            "link": "https://www.naukri.com/job-listings-ai-engineer-acme-bengaluru-3-to-6-years-010125000001",
            "posted_at": "3 Days Ago",
            "description": "Build and ship retrieval pipelines and evaluation harnesses for production LLM features.",
        }

    def test_builds_the_search_url_from_role_and_location(self, naukri_html):
        seen = naukri_html("naukri_search.html")
        NaukriAdapter().fetch("AI Engineer", "Bengaluru")
        # A slug regression sends every search to the wrong page and returns
        # plausible-looking rows for the wrong query.
        assert seen["url"] == "https://www.naukri.com/ai-engineer-jobs-in-bengaluru"

    def test_keeps_absolute_links_untouched(self, naukri_html):
        naukri_html("naukri_search.html")
        row = NaukriAdapter().fetch("AI Engineer", "Bengaluru")[1]
        # urljoin must not mangle an already-absolute href.
        assert row["link"] == (
            "https://www.naukri.com/job-listings-senior-ml-engineer-northwind-bengaluru-020225000002"
        )

    def test_does_NOT_collapse_whitespace_inside_a_text_node(self, naukri_html):
        """
        Pinning real behavior, which is not what it looks like.

        `get_text(" ", strip=True)` strips the EDGES of each string node and
        joins nodes with a space — it does not collapse runs of whitespace
        *within* a node. So markup wrapped across lines survives with its
        raggedness intact.

        Unlike RemoteOK and Wellfound, boards/naukri.py has no `_clean_text`,
        so this is a real inconsistency between adapters rather than a quirk of
        this cassette. It is asserted rather than fixed because `boards/*.py`
        must stay byte-identical to the source project (Phase 2 exit gate).

        Blast radius is small and worth knowing: the dedupe key normalises
        whitespace (`normalise()` in orchestrator/lib/dedupe.ts collapses
        `\\s+`), so matching is unaffected. What carries the raggedness is the
        stored `jobs.title` and therefore the UI.
        """
        naukri_html("naukri_search.html")
        row = NaukriAdapter().fetch("AI Engineer", "Bengaluru")[1]

        assert "Senior" in row["title"] and "Engineer" in row["title"]
        # If this ever starts collapsing, a `_clean_text` was added upstream and
        # the inconsistency below is resolved — update the note above.
        assert "  " in row["title"] or "\n" in row["title"]
        assert row["company"].startswith("Northwind")

    def test_missing_optional_fields_become_empty_strings(self, naukri_html):
        naukri_html("naukri_search.html")
        row = NaukriAdapter().fetch("AI Engineer", "Bengaluru")[2]
        assert row["title"] == "Data Engineer"
        # Never None: these flow into a CSV and a DB column downstream.
        assert row["company"] == ""
        assert row["location"] == ""
        assert row["description"] == ""
        assert row["posted_at"] == ""

    def test_drops_cards_with_no_title_anchor(self, naukri_html):
        naukri_html("naukri_search.html")
        rows = NaukriAdapter().fetch("AI Engineer", "Bengaluru")
        # The cassette holds four wrappers; the promo tile has no title.
        assert len(rows) == 3
        assert all(row["title"] for row in rows)

    def test_falls_back_to_the_older_markup(self, naukri_html):
        """
        The fallback selectors are dead code until the day they are not. This
        cassette uses only the older shapes, so a regression in them fails here
        rather than during an outage.
        """
        naukri_html("naukri_legacy_markup.html")
        rows = NaukriAdapter().fetch("AI Engineer", "Bengaluru")

        assert [row["title"] for row in rows] == ["AI Engineer", "NLP Engineer"]
        assert rows[0]["company"] == "Contoso Systems"
        assert rows[0]["location"] == "Bengaluru"
        assert rows[0]["link"].startswith("https://www.naukri.com/")

    def test_raises_on_a_non_200(self, naukri_html):
        naukri_html("naukri_search.html", status_code=503)
        # A board failure must be an explicit error the orchestrator can turn
        # into a `partial` run — never an empty result that reads as "no jobs".
        with pytest.raises(RuntimeError, match="HTTP 503"):
            NaukriAdapter().fetch("AI Engineer", "Bengaluru")

    def test_does_not_launch_a_browser_when_static_html_parses(self, monkeypatch, naukri_html):
        """
        Playwright is the fallback for an empty static parse. If it ever fires
        on a page that DID parse, every harvest silently gets slower and heavier
        — and CI would start needing a browser.
        """
        naukri_html("naukri_search.html")

        def explode():
            raise AssertionError("Playwright fallback fired on a page that parsed")

        monkeypatch.setattr(NaukriAdapter, "_fetch_rendered_html", lambda self, url: explode())
        assert NaukriAdapter().fetch("AI Engineer", "Bengaluru")


# ════════════════════════════════════════════════════════════════════════
# RemoteOK — JSON
# ════════════════════════════════════════════════════════════════════════

@pytest.fixture(name="remoteok_api")
def _remoteok_api(monkeypatch):
    def install(payload=None, status_code: int = 200, bad_json: bool = False):
        import boards.remoteok as mod

        data = payload if payload is not None else json.loads(cassette("remoteok_api.json"))

        def fake_get(url, **kwargs):
            return FakeResponse(
                status_code=status_code,
                payload=None if bad_json else data,
            )

        monkeypatch.setattr(mod.requests, "get", fake_get)

    return install


class TestRemoteOK:
    def test_skips_the_legal_header_element(self, remoteok_api):
        """
        items[0] is RemoteOK's attribution notice, not a job.

        The role MUST be empty here. With a role set, the header is discarded
        by scoring anyway (it has no position, so it scores 0 and is filtered),
        which makes the test pass whether or not the skip exists — verified by
        mutation: an earlier version of this used a role and survived changing
        `items[1:]` to `items[0:]`, proving nothing about the skip.
        """
        remoteok_api()
        rows = RemoteOKAdapter().fetch("", "")

        # Exactly the four real jobs in the cassette — not five.
        assert len(rows) == 4
        assert all(row["title"] for row in rows)
        assert not any("legal" in str(row).lower() for row in rows)

    def test_maps_a_job_to_the_canonical_shape(self, remoteok_api):
        remoteok_api()
        row = RemoteOKAdapter().fetch("AI Engineer", "")[0]
        assert row["source"] == "remoteok"
        assert row["title"] == "AI Engineer"
        assert row["company"] == "Acme Analytics"
        assert row["link"] == "https://remoteok.com/remote-jobs/1000001-ai-engineer-acme-analytics"
        assert row["posted_at"] == "2026-08-01T09:00:00+00:00"

    def test_strips_html_from_the_description(self, remoteok_api):
        remoteok_api()
        row = RemoteOKAdapter().fetch("AI Engineer", "")[0]
        # Raw markup here ends up in the JD text and then in an LLM prompt.
        assert "<p>" not in row["description"]
        assert "<strong>" not in row["description"]
        assert "retrieval" in row["description"]

    def test_unescapes_html_entities(self, remoteok_api):
        remoteok_api()
        rows = RemoteOKAdapter().fetch("AI Engineer", "")
        northwind = next(r for r in rows if r["company"] == "Northwind Labs")
        assert "&amp;" not in northwind["description"]
        assert "&" in northwind["description"]

    def test_defaults_a_blank_location_to_remote(self, remoteok_api):
        remoteok_api()
        rows = RemoteOKAdapter().fetch("AI Engineer", "")
        northwind = next(r for r in rows if r["company"] == "Northwind Labs")
        assert northwind["location"] == "Remote"

    def test_ranks_an_exact_title_match_first(self, remoteok_api):
        remoteok_api()
        rows = RemoteOKAdapter().fetch("AI Engineer", "")
        assert rows[0]["title"] == "AI Engineer"

    def test_an_empty_role_returns_everything_unfiltered(self, remoteok_api):
        remoteok_api()
        rows = RemoteOKAdapter().fetch("", "")
        # Four jobs in the cassette after the legal header.
        assert len(rows) == 4

    def test_ignores_the_location_argument(self, remoteok_api):
        remoteok_api()
        # RemoteOK is remote-only; the adapter drops the argument on purpose.
        assert RemoteOKAdapter().fetch("AI Engineer", "Bengaluru") == \
               RemoteOKAdapter().fetch("AI Engineer", "")

    def test_raises_on_a_non_200(self, remoteok_api):
        remoteok_api(status_code=500)
        with pytest.raises(RuntimeError, match="HTTP 500"):
            RemoteOKAdapter().fetch("AI Engineer", "")

    def test_raises_when_the_body_is_not_json(self, remoteok_api):
        remoteok_api(bad_json=True)
        # An HTML error page served with a 200 must not parse as "no jobs".
        with pytest.raises(RuntimeError, match="as JSON"):
            RemoteOKAdapter().fetch("AI Engineer", "")


# ════════════════════════════════════════════════════════════════════════
# Wellfound — Firecrawl JSON extract
# ════════════════════════════════════════════════════════════════════════

@pytest.fixture(name="wellfound_extract")
def _wellfound_extract(monkeypatch):
    """
    Replace the Firecrawl client, not the scrape method.

    Patching `_scrape` would skip the envelope handling in `_extract_jobs`,
    which is the part that has actually broken across SDK versions. Swapping the
    client keeps that code under test and removes the need for the SDK or an
    API key.
    """
    seen: dict[str, object] = {}

    def install(result):
        class FakeClient:
            def scrape(self, url, formats=None):
                seen["url"] = url
                seen["formats"] = formats
                return result

        monkeypatch.setattr(WellfoundAdapter, "_create_client", lambda self: FakeClient())
        return seen

    return install


def _payload() -> dict:
    return json.loads(cassette("wellfound_extract.json"))


class TestWellfound:
    def test_extracts_jobs_from_the_json_envelope(self, wellfound_extract):
        wellfound_extract(_payload())
        rows = WellfoundAdapter().fetch("AI Engineer", "Bengaluru")

        assert rows[0]["source"] == "wellfound"
        assert rows[0]["title"] == "AI Engineer"
        assert rows[0]["company"] == "Acme Analytics"
        assert rows[0]["link"] == "https://wellfound.com/jobs/2000001-ai-engineer"

    @pytest.mark.parametrize("envelope", ["json", "data.json", "bare"])
    def test_handles_every_sdk_envelope_shape(self, envelope, wellfound_extract):
        """
        The payload has moved between these across Firecrawl SDK versions, and
        the adapter accepts all three. An upgrade that changes the shape should
        not silently return zero jobs.
        """
        inner = _payload()["json"]
        result = {
            "json": {"json": inner},
            "data.json": {"data": {"json": inner}},
            "bare": inner,
        }[envelope]

        wellfound_extract(result)
        rows = WellfoundAdapter().fetch("AI Engineer", "Bengaluru")
        assert [r["title"] for r in rows[:1]] == ["AI Engineer"]

    def test_handles_a_pydantic_style_result(self, wellfound_extract):
        class ModelResult:
            def model_dump(self):
                return _payload()

        wellfound_extract(ModelResult())
        rows = WellfoundAdapter().fetch("AI Engineer", "Bengaluru")
        assert rows[0]["title"] == "AI Engineer"

    def test_drops_rows_with_no_title(self, wellfound_extract):
        wellfound_extract(_payload())
        rows = WellfoundAdapter().fetch("AI Engineer", "Bengaluru")
        # The cassette contains a deliberately untitled listing.
        assert all(row["title"] for row in rows)
        assert not any(row["company"] == "Ghost Listing Co" for row in rows)

    def test_ranks_the_requested_location_above_remote_and_elsewhere(self, wellfound_extract):
        wellfound_extract(_payload())
        rows = WellfoundAdapter().fetch("AI Engineer", "Bengaluru")
        locations = [row["location"] for row in rows]
        # Bengaluru first, then Remote, then everything else.
        assert locations.index("Bengaluru") < locations.index("Remote")
        assert locations.index("Remote") < locations.index("New York")

    def test_treats_bangalore_and_bengaluru_as_the_same_place(self, wellfound_extract):
        wellfound_extract(_payload())
        rows = WellfoundAdapter().fetch("Backend Engineer", "Bengaluru")
        # The alias table is the only reason the Bangalore row ranks locally;
        # losing it quietly demotes half the results for an Indian search.
        bangalore = next(r for r in rows if r["location"] == "Bangalore")
        new_york = next(r for r in rows if r["location"] == "New York")
        assert rows.index(bangalore) < rows.index(new_york)

    def test_builds_the_role_and_location_url(self, wellfound_extract):
        seen = wellfound_extract(_payload())
        WellfoundAdapter().fetch("AI Engineer", "Bengaluru")
        assert seen["url"] == "https://wellfound.com/role/l/ai-engineer/bengaluru"

    def test_omits_the_location_segment_when_none_is_given(self, wellfound_extract):
        seen = wellfound_extract(_payload())
        WellfoundAdapter().fetch("AI Engineer", "")
        assert seen["url"] == "https://wellfound.com/role/ai-engineer"

    def test_asks_firecrawl_for_the_json_schema_format(self, wellfound_extract):
        seen = wellfound_extract(_payload())
        WellfoundAdapter().fetch("AI Engineer", "Bengaluru")
        formats = seen["formats"]
        assert formats[0]["type"] == "json"
        assert "jobs" in formats[0]["schema"]["properties"]
