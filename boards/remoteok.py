from __future__ import annotations

import html
import re
import sys
from pathlib import Path
from urllib.parse import urljoin

def _add_local_site_packages() -> None:
    lib_dir = Path(__file__).resolve().parents[1] / ".venv" / "lib"
    candidates = sorted(lib_dir.glob("python*/site-packages"), reverse=True)
    for site_packages in candidates:
        site_packages_str = str(site_packages)
        if site_packages.exists() and site_packages_str not in sys.path:
            sys.path.insert(0, site_packages_str)
            break


_add_local_site_packages()

import requests
from bs4 import BeautifulSoup

from .base import BoardAdapter


class RemoteOKAdapter(BoardAdapter):
    base_url = "https://remoteok.com"

    def fetch(self, role: str, location: str) -> list[dict]:
        del location

        items = self._fetch_items(role)

        # Return only jobs that match the requested role in the visible title or tags.
        # If the strict pass yields too few results, perform a relaxed pass to
        # reach a minimum number of results.
        MIN_RESULTS = 15
        results: list[tuple[int, dict]] = []
        for item in items[1:]:
            position = self._clean_text(item.get("position") or "")
            tags = [self._clean_text(tag) for tag in (item.get("tags") or [])]
            score = self._role_score(role, position, tags)
            if role and score <= 0:
                continue
            job = self._map_item(item)
            if job is not None:
                results.append((score, job))

        if role:
            # If strict title/tags pass returns too few, try a relaxed pass
            if len(results) < MIN_RESULTS:
                existing_links = {row['link'] for _, row in results}
                relaxed: list[tuple[int, dict]] = []
                for item in items[1:]:
                    job = self._map_item(item)
                    if not job or job['link'] in existing_links:
                        continue
                    score2 = self._relaxed_role_score(role, job)
                    if score2 > 0:
                        relaxed.append((score2, job))
                relaxed.sort(key=lambda it: it[0], reverse=True)
                results.extend(relaxed)

            results.sort(key=lambda item: item[0], reverse=True)

        return [row for _, row in results]

    def _fetch_items(self, role: str) -> list[dict]:
        """Fetch job items, preferring tag-filtered endpoints over the generic API.

        RemoteOK supports ``/remote-{tag}-jobs.json`` which returns far more
        relevant results than the generic ``/api`` (which only lists ~100 recent
        jobs across all categories).  We extract individual keywords from the
        role string and try each as a tag, using the first one that returns
        results.  Falls back to ``/api`` if nothing matches.
        """
        if role:
            tokens = [t for t in re.split(r"[^\w]+", role.strip().lower()) if len(t) >= 2]
            for token in tokens:
                url = f"{self.base_url}/remote-{token}-jobs.json"
                items = self._request_api(url)
                if len(items) > 1:  # first element is always the legal header
                    return items

        # Fallback: generic feed
        return self._request_api(f"{self.base_url}/api")

    def _request_api(self, url: str) -> list[dict]:
        """Send a GET request to a RemoteOK JSON endpoint and return parsed items."""
        response = requests.get(
            url,
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=30,
        )

        if response.status_code != 200:
            raise RuntimeError(
                f"Failed to fetch RemoteOK jobs from {url}: HTTP {response.status_code}"
            )

        try:
            return response.json()
        except ValueError as exc:
            raise RuntimeError(f"Failed to parse RemoteOK response from {url} as JSON") from exc

    def _map_item(self, item: dict) -> dict | None:
        position = self._clean_text(item.get("position") or "")

        description = self._strip_html(item.get("description") or "")
        location = self._clean_text(item.get("location") or "") or "Remote"

        return {
            "source": "remoteok",
            "title": position,
            "company": self._clean_text(item.get("company") or ""),
            "location": location,
            "link": urljoin(self.base_url, str(item.get("url") or "")),
            "posted_at": self._clean_text(item.get("date") or ""),
            "description": description,
        }

    @staticmethod
    def _role_score(role: str, position: str, tags: list[str]) -> int:
        role_text = (role or "").casefold().strip()
        if not role_text:
            return 0

        searchable_title = position.casefold()
        tokens = [token for token in re.split(r"[^\w]+", role_text) if len(token) >= 2]
        if role_text in searchable_title:
            return 100

        if tokens and all(token in searchable_title for token in tokens):
            return 80

        searchable_tags = " ".join(tags).casefold()
        if role_text in searchable_tags:
            return 20

        return 0

    @staticmethod
    def _relaxed_role_score(role: str, job: dict) -> int:
        """Lower-weight scoring over company/location/description for fallback."""
        role_text = (role or "").casefold().strip()
        if not role_text:
            return 0
        searchable = " ".join([
            str(job.get("company") or ""),
            str(job.get("location") or ""),
            str(job.get("description") or ""),
        ]).casefold()
        score = 0
        if role_text in searchable:
            score += 40
        tokens = [t for t in re.split(r"[^\w]+", role_text) if len(t) >= 2]
        for token in tokens:
            if token in searchable:
                score += 8
        return score

    @staticmethod
    def _clean_text(value: str) -> str:
        text = html.unescape(str(value or ""))
        text = re.sub(r"\s+", " ", text)
        return text.strip(" \t\r\n,|")

    @staticmethod
    def _strip_html(value: str) -> str:
        # prefer lxml if available (faster/robust), but fall back to the stdlib parser
        try:
            return BeautifulSoup(value, "lxml").get_text(" ", strip=True)
        except Exception:
            return BeautifulSoup(value, "html.parser").get_text(" ", strip=True)