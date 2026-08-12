"""
Board search — one board per request (P2.1.2).

ADR-004: ③ calls this once per board, in parallel, rather than one coarse
/harvest endpoint. Four properties fall out for free, all of which FR1 needs:
per-board isolation, natural progress granularity, independent timeouts and
retries, and per-board rate limiting at the caller. A single endpoint would have
to reimplement all four inside Python and then serialise the result back out.

P2.2.10 — A BOARD FAILURE IS DATA, NOT AN EXCEPTION. Every handler here returns
200 with `error` set rather than raising, so one board breaking can never fail a
run that other boards are succeeding in.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

# The harvester package ships as a library here; its CLI is not imported.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "harvester"))

from conduct import check_allowed, RobotsDisallowed  # noqa: E402

log = logging.getLogger("jobpilot.worker.boards")

router = APIRouter(prefix="/boards", tags=["boards"])

Board = Literal["naukri", "remoteok", "wellfound"]

# Checked before dispatch. The adapters own their exact URLs and are on the
# "untouched" list (implementation-plan.md), so conduct is enforced here at the
# board's origin rather than by editing proven scraper code.
_BOARD_ORIGINS = {
    "naukri": "https://www.naukri.com/",
    "remoteok": "https://remoteok.com/",
    "wellfound": "https://wellfound.com/",
}

_ADAPTERS = {
    "naukri": ("boards.naukri", "NaukriAdapter"),
    "remoteok": ("boards.remoteok", "RemoteOKAdapter"),
    "wellfound": ("boards.wellfound", "WellfoundAdapter"),
}


class BoardSearchRequest(BaseModel):
    role: str = Field(min_length=1, max_length=200)
    location: str | None = Field(default=None, max_length=200)
    # EC-P2-14: clamped here as well as at ①. Never pass an unbounded limit to
    # a scraper — this service does not assume the caller validated.
    limit: int = Field(ge=1, le=50)


class RawJob(BaseModel):
    """Exactly the six jobs.csv columns. The adapters return this unchanged."""

    source: str
    title: str
    company: str
    location: str | None = None
    link: str
    posted_at: str | None = None


class BoardSearchResponse(BaseModel):
    jobs: list[RawJob]
    partial: bool = False
    error: str | None = None
    # EC-P2-06: the silent failure of every scraper is a DOM change that yields
    # zero rows with HTTP 200 — indistinguishable from an empty search unless
    # you also report how much page you got. A 400KB page with 0 rows is a
    # broken selector; a 3KB page with 0 rows is a genuinely empty result.
    response_bytes: int | None = None


def _load_adapter(board: str):
    module_name, class_name = _ADAPTERS[board]
    module = __import__(module_name, fromlist=[class_name])
    return getattr(module, class_name)()


@router.post("/{board}/search", response_model=BoardSearchResponse)
def search(board: Board, body: BoardSearchRequest) -> BoardSearchResponse:
    # P2.4.2 / EC-P2-50 — robots.txt is consulted before any request goes out.
    # A disallowed board is reported as a board failure, never escalated.
    try:
        check_allowed(_BOARD_ORIGINS[board])
    except RobotsDisallowed as exc:
        log.warning("robots disallows %s: %s", board, exc)
        return BoardSearchResponse(jobs=[], error=f"robots_disallowed: {exc}")

    try:
        adapter = _load_adapter(board)
    except Exception as exc:  # noqa: BLE001
        # A missing dependency or credential is a board failure, not a crash.
        log.warning("adapter %s unavailable: %s", board, exc)
        return BoardSearchResponse(jobs=[], error=f"adapter_unavailable: {exc}")

    try:
        rows = adapter.fetch(body.role, body.location or "") or []
    except Exception as exc:  # noqa: BLE001
        # EC-P2-09/10: a missing Firecrawl key or an exhausted quota lands here
        # and is reported as this board failing. The run continues elsewhere.
        log.warning("board %s failed: %s", board, exc)
        return BoardSearchResponse(jobs=[], error=str(exc)[:300])

    jobs: list[RawJob] = []
    skipped = 0
    for row in rows[: body.limit]:
        try:
            # EC-P2-04: one malformed card must not fail nineteen good ones.
            jobs.append(
                RawJob(
                    source=str(row.get("source") or board),
                    title=str(row["title"]).strip(),
                    company=str(row["company"]).strip(),
                    location=(str(row["location"]).strip() if row.get("location") else None),
                    link=str(row["link"]).strip(),
                    posted_at=(str(row["posted_at"]).strip() if row.get("posted_at") else None),
                )
            )
        except Exception:  # noqa: BLE001
            skipped += 1

    if skipped:
        log.warning("board %s: skipped %d malformed row(s)", board, skipped)

    return BoardSearchResponse(
        jobs=jobs,
        # EC-P2-02/03: fewer rows than asked for, or rows dropped, is `partial`
        # — a real state distinct from both success and failure.
        partial=skipped > 0 or len(rows) > len(jobs),
        error=None,
        response_bytes=getattr(adapter, "last_response_bytes", None),
    )
