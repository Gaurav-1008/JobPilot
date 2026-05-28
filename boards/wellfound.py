from __future__ import annotations

import html
import json
import importlib
import re
import sys
from pathlib import Path


def _add_local_site_packages() -> None:
    lib_dir = Path(__file__).resolve().parents[1] / ".venv" / "lib"
    candidates = sorted(lib_dir.glob("python*/site-packages"), reverse=True)
    for site_packages in candidates:
        site_packages_str = str(site_packages)
        if site_packages.exists() and site_packages_str not in sys.path:
            sys.path.insert(0, site_packages_str)
            break


_add_local_site_packages()

from dotenv import load_dotenv

from .base import BoardAdapter


class WellfoundAdapter(BoardAdapter):
    base_url = "https://wellfound.com"

    def fetch(self, role: str, location: str) -> list[dict]:
        client = self._create_client()
        url = self._build_url(role, location)

        schema = {
            "type": "object",
            "properties": {
                "jobs": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "company": {"type": "string"},
                            "location": {"type": "string"},
                            "link": {"type": "string"},
                        },
                        "required": ["title", "company", "location", "link"],
                    },
                }
            },
            "required": ["jobs"],
        }

        result = self._scrape(client, url, schema)
        jobs = self._extract_jobs(result)

        rows = [
            {
                "source": "wellfound",
                "title": self._clean_text(job.get("title") or ""),
                "company": self._clean_text(job.get("company") or ""),
                "location": self._clean_text(job.get("location") or ""),
                "link": self._clean_text(job.get("link") or ""),
                "posted_at": "",
                "description": "",
            }
            for job in jobs
            if self._clean_text(job.get("title") or "")
        ]

        role_scored = [row for row in rows if self._role_score(row, role) > 0]
        MIN_RESULTS = 15

        # If not enough role-matching rows, include additional rows (including remote)
        # ordered by location priority and role score until MIN_RESULTS reached.
        if len(role_scored) < MIN_RESULTS:
            existing_links = {r['link'] for r in role_scored}
            candidates = [r for r in rows if r['link'] not in existing_links]
            candidates.sort(key=lambda r: (self._location_priority(r, location), -self._role_score(r, role)))
            for c in candidates:
                role_scored.append(c)
                if len(role_scored) >= MIN_RESULTS:
                    break

        if location:
            role_scored.sort(key=lambda row: (self._location_priority(row, location), -self._role_score(row, role)))
        else:
            role_scored.sort(key=lambda row: -self._role_score(row, role))
        return role_scored

    def _create_client(self):
        load_dotenv(dotenv_path=Path(__file__).resolve().parents[1] / ".env")
        api_key = self._get_api_key()
        try:
            firecrawl_module = importlib.import_module("firecrawl")
        except ImportError as exc:  # pragma: no cover - handled at runtime if dependency is missing
            raise RuntimeError("Firecrawl SDK is not installed. Add the `firecrawl-py` package to enable Wellfound scraping.") from exc

        return firecrawl_module.Firecrawl(api_key=api_key)

    @staticmethod
    def _get_api_key() -> str:
        import os

        api_key = os.getenv("FIRECRAWL_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError(
                "Missing FIRECRAWL_API_KEY. Copy `.env.example` to `.env` and set FIRECRAWL_API_KEY before using WellfoundAdapter."
            )
        return api_key

    def _build_url(self, role: str, location: str) -> str:
        role_slug = self._slugify(role)
        if location:
            location_slug = self._slugify(location)
            return f"{self.base_url}/role/l/{role_slug}/{location_slug}"
        return f"{self.base_url}/role/{role_slug}"

    @staticmethod
    def _slugify(value: str) -> str:
        slug = value.strip().lower()
        slug = re.sub(r"[^a-z0-9]+", "-", slug)
        slug = re.sub(r"-+", "-", slug).strip("-")
        return slug or "any"

    @staticmethod
    def _role_score(row: dict, role: str) -> int:
        role_text = (role or "").casefold().strip()
        if not role_text:
            return 0

        title = str(row.get("title") or "").casefold()
        company = str(row.get("company") or "").casefold()
        row_location = str(row.get("location") or "").casefold()
        score = 0
        if role_text in title:
            score += 100
        tokens = [t for t in re.split(r"[^\w]+", role_text) if len(t) >= 2]
        for token in tokens:
            if token in title or token in company or token in row_location:
                score += 10
        return score

    @staticmethod
    def _location_priority(row: dict, location: str) -> int:
        location_text = (location or "").casefold().strip()
        row_location = str(row.get("location") or "").casefold()
        aliases = {
            "bangalore": ["bengaluru"],
            "bengaluru": ["bangalore"],
        }

        if location_text and (location_text in row_location or any(alias in row_location for alias in aliases.get(location_text, []))):
            return 0
        if "remote" in row_location:
            return 1
        return 2

    @staticmethod
    def _clean_text(value: str) -> str:
        text = html.unescape(str(value or ""))
        text = re.sub(r"\s+", " ", text)
        return text.strip(" \t\r\n,|")

    def _scrape(self, client, url: str, schema: dict) -> object:
        formats = [{"type": "json", "schema": schema}]
        if hasattr(client, "scrape_url"):
            return client.scrape_url(url, formats=formats)
        return client.scrape(url, formats=formats)

    @staticmethod
    def _extract_jobs(result: object) -> list[dict]:
        if hasattr(result, "model_dump"):
            data = result.model_dump()
        elif isinstance(result, dict):
            data = result
        else:
            data = json.loads(json.dumps(result, default=str))

        if isinstance(data, dict):
            if "json" in data:
                payload = data["json"]
            elif "data" in data and isinstance(data["data"], dict) and "json" in data["data"]:
                payload = data["data"]["json"]
            else:
                payload = data
        else:
            payload = {}

        jobs = payload.get("jobs") if isinstance(payload, dict) else []
        return jobs if isinstance(jobs, list) else []