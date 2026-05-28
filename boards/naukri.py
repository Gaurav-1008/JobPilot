from __future__ import annotations

import re
import sys
import time
from pathlib import Path
from shutil import which
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
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from .base import BoardAdapter


class NaukriAdapter(BoardAdapter):
    base_url = "https://www.naukri.com"
    browser_user_agent = (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Code/1.121.0 "
        "Chrome/142.0.7444.265 Electron/39.8.8 Safari/537.36"
    )

    def fetch(self, role: str, location: str) -> list[dict]:
        role_slug = self._slugify(role)
        location_slug = self._slugify(location)
        url = f"{self.base_url}/{role_slug}-jobs-in-{location_slug}"

        response = requests.get(
            url,
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=30,
        )
        time.sleep(1)

        if response.status_code != 200:
            raise RuntimeError(
                f"Failed to fetch Naukri jobs from {url}: HTTP {response.status_code}"
            )

        results = self._parse_results(response.text)
        if results:
            return results

        rendered_html = self._fetch_rendered_html(url)
        return self._parse_results(rendered_html)

    def _parse_results(self, html: str) -> list[dict]:
        soup = BeautifulSoup(html, "lxml")
        results: list[dict] = []

        cards = soup.select("div.srp-jobtuple-wrapper")
        if not cards:
            cards = soup.select("div.cust-job-tuple")

        for card in cards:
            item = self._parse_card(card)
            if item is not None:
                results.append(item)

        return results

    def _fetch_rendered_html(self, url: str) -> str:
        chrome_path = self._resolve_chrome_path()
        if chrome_path is None:
            raise RuntimeError(
                "Naukri returned no rows from the static HTML and no Chrome binary was found for Playwright fallback."
            )

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True, executable_path=chrome_path)
            try:
                page = browser.new_page(user_agent=self.browser_user_agent)
                page.goto(url, wait_until="networkidle", timeout=60000)
                return page.content()
            except PlaywrightTimeoutError as exc:
                raise RuntimeError(f"Timed out rendering Naukri jobs page at {url}") from exc
            finally:
                browser.close()

    @staticmethod
    def _resolve_chrome_path() -> str | None:
        candidates = [
            which("google-chrome"),
            which("chrome"),
            str(Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")),
        ]
        for candidate in candidates:
            if candidate and Path(candidate).exists():
                return candidate
        return None

    def _parse_card(self, card) -> dict | None:
        title_tag = card.select_one("h2 a.title") or card.select_one("h2 a[href]")
        if title_tag is None:
            return None

        company_tag = card.select_one("a.comp-name") or card.select_one(".comp-dtls-wrap a[href*='jobs-careers']")
        location_tag = card.select_one(".locWdth") or card.select_one(".loc-wrap span[title]")
        description_tag = card.select_one(".job-desc")
        posted_at_tag = card.select_one(".job-post-day")

        return {
            "source": "naukri",
            "title": title_tag.get_text(" ", strip=True),
            "company": company_tag.get_text(" ", strip=True) if company_tag else "",
            "location": location_tag.get_text(" ", strip=True) if location_tag else "",
            "link": urljoin(self.base_url, title_tag.get("href", "")),
            "posted_at": posted_at_tag.get_text(" ", strip=True) if posted_at_tag else "",
            "description": description_tag.get_text(" ", strip=True) if description_tag else "",
        }

    @staticmethod
    def _slugify(value: str) -> str:
        slug = value.strip().lower()
        slug = re.sub(r"[^a-z0-9]+", "-", slug)
        slug = re.sub(r"-+", "-", slug).strip("-")
        return slug or "remote"