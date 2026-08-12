"""
Single-URL hydration endpoint (P3.1.2).

Thin wrapper over harvester/fetcher.py. Like the board endpoints, a failure is
DATA — 200 with `blocked` set — because the caller's job is to route the user to
manual paste, not to surface a stack trace.
"""

from __future__ import annotations

import sys
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel, Field

# EC-P0-07 — `harvester` cannot be imported as a package: the source repo has a
# CLI module at harvester/harvester.py, so `import harvester` resolves to that
# module and `harvester.fetcher` fails with "not a package". The harvester
# directory is on sys.path (same as boards.py does for `conduct`), so import the
# module directly.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "harvester"))

from fetcher import fetch_job_description  # noqa: E402

router = APIRouter(tags=["hydrate"])


class HydrateRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)


class HydrateResponse(BaseModel):
    raw_text: str
    method: str
    blocked: bool
    reason: str | None = None


@router.post("/hydrate", response_model=HydrateResponse)
def hydrate(body: HydrateRequest) -> HydrateResponse:
    result = fetch_job_description(body.url)
    return HydrateResponse(
        raw_text=result.raw_text,
        method=result.method,
        blocked=result.blocked,
        reason=result.reason,
    )
