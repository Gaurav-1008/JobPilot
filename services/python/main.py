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
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

# NOT `routers/email.py`: that filename shadows the stdlib `email` package for
# any tool that puts routers/ on sys.path (pytest rootdir configs do), and
# FastAPI imports `email.message` internally — so the collision surfaces as a
# circular-import error inside FastAPI rather than anywhere near this line.
from routers import boards, delivery, hydrate, outreach_email

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format='{"ts":"%(asctime)s","level":"%(levelname)s","msg":"%(message)s"}',
)
log = logging.getLogger("jobpilot.worker")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """
    EC-P2-11 — fail fast and for the RIGHT reason: a missing browser should be
    obvious at startup, not a hung scrape under load.

    Uses the ASYNC Playwright API deliberately. The sync API raises "It looks
    like you are using Playwright Sync API inside the asyncio loop" when called
    from an async lifespan, which the except below caught and reported as
    "chromium unavailable". That made this a permanent FALSE NEGATIVE: it warned
    on every boot even with a perfectly good browser, so a genuinely missing one
    was indistinguishable from the noise. A check that always fails is worse
    than no check, because people stop reading it.
    """
    try:
        from playwright.async_api import async_playwright

        async with async_playwright() as p:
            browser = await p.chromium.launch()
            version = browser.version
            await browser.close()
        log.info("chromium ok (%s)", version)
    except Exception as exc:  # noqa: BLE001 - startup diagnostics
        log.warning("chromium unavailable: %s", exc)
        log.warning("Naukri needs it; RemoteOK and Wellfound do not")
        log.warning("fix: .venv/bin/playwright install chromium")
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


@app.exception_handler(RequestValidationError)
async def redacted_validation_handler(request: Request, exc: RequestValidationError):
    """
    P5.5.5 / EC-P5-61 — NEVER echo the request body.

    FastAPI's default 422 includes an `input` field carrying the offending
    value. On /email/deliver and /email/preflight that value is an SMTP app
    password or a Google access token, and ① logs the response body it gets
    back — so the default behavior writes a live credential into two log files
    at once.

    Only the field LOCATION and the error type survive here. That is enough to
    debug a schema mismatch and never enough to leak a secret. ① redacts on its
    side too (lib/outreach/worker-client.ts); a credential leaks from whichever
    side forgets, so both must.
    """
    safe = [
        {"loc": [str(part) for part in error.get("loc", [])], "type": error.get("type")}
        for error in exc.errors()
    ]
    log.warning("validation error on %s: %s", request.url.path, safe)
    return JSONResponse({"detail": safe}, status_code=422)


@app.exception_handler(Exception)
async def redacted_exception_handler(request: Request, exc: Exception):
    """
    Same reasoning for unhandled errors: a traceback rendered into a response
    can carry local variables, and on the delivery routes those are credentials.
    """
    log.error("unhandled error on %s: %s", request.url.path, type(exc).__name__)
    return JSONResponse({"detail": "internal error"}, status_code=500)


app.include_router(boards.router)
app.include_router(hydrate.router)
app.include_router(outreach_email.router)
app.include_router(delivery.router)
