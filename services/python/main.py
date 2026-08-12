"""
Service ④ — the stateless Python worker (P2.1.1).

Thin FastAPI handlers over two existing codebases. Per ADR-002 this service is a
PURE FUNCTION service: no database, no queue, no cross-call state. Everything it
needs arrives in the request body, and every result goes back in the response.
The orchestrator ③ owns all persistence.

Auth is a shared service token. This service is never internet-reachable; in
production it also sits behind mTLS (architecture.md §15.2). It still validates
every request body, because it does not assume ① validated correctly.
"""

from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from routers import boards

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format='{"ts":"%(asctime)s","level":"%(levelname)s","msg":"%(message)s"}',
)
log = logging.getLogger("jobpilot.worker")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # EC-P2-11: fail fast and for the RIGHT reason. If Playwright's browser is
    # missing, say so at startup rather than letting the first scrape hang.
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = p.chromium.launch()
            browser.close()
        log.info("chromium ok")
    except Exception as exc:  # noqa: BLE001 - startup diagnostics
        log.warning("chromium unavailable: %s", exc)
        log.warning("scraping will fall back to requests-only paths")
    yield


app = FastAPI(title="JobPilot worker", version="0.1.0", lifespan=lifespan)


@app.middleware("http")
async def service_token_and_logging(request: Request, call_next):
    """Service-token auth + structured access logging (P2.1.5)."""
    if request.url.path in ("/health", "/docs", "/openapi.json"):
        return await call_next(request)

    expected = os.getenv("WORKER_SERVICE_TOKEN", "")
    if expected:
        if request.headers.get("x-service-token") != expected:
            return JSONResponse({"detail": "forbidden"}, status_code=403)
    # An unset token is allowed only outside production, so a misconfigured
    # deploy cannot silently expose this service.
    elif os.getenv("JOBPILOT_ENV", "local") == "production":
        return JSONResponse({"detail": "service token not configured"}, status_code=500)

    started = time.monotonic()
    response = await call_next(request)
    # No PII: path, status, duration. Never query strings or bodies.
    log.info(
        "%s %s -> %s in %dms",
        request.method,
        request.url.path,
        response.status_code,
        int((time.monotonic() - started) * 1000),
    )
    return response


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(boards.router)
