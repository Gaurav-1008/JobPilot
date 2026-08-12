# ============================================================================
# Service ④ — the stateless Python worker (P0.4.2).
#
# Wraps the harvester's board adapters and The Closer's generator/senders behind
# FastAPI. Pure request -> response: no database, no queue, no cross-call state
# (ADR-002). Everything it needs arrives in the request body.
#
# EC-P0-28 — ARCHITECTURE. Playwright ships browsers per-platform. The official
# Playwright images are multi-arch (linux/amd64 + linux/arm64), so this builds
# natively on Apple Silicon. If you ever swap to a base that is amd64-only,
# either pin `platform: linux/amd64` in docker-compose.yml and accept the
# emulation penalty, or the first scrape in P2 will hang rather than fail.
#
# EC-P7-30 — the classic Playwright deployment failure is "works locally, no
# Chromium in the production image". This image bundles the browser AND the
# healthcheck below actually launches it, so a broken image fails at container
# start rather than at the first user-triggered hydration.
# ============================================================================

# Tag MUST track the pinned playwright version in requirements.txt. A mismatch
# between the client library and the bundled browser is a runtime error deep in
# a scrape, not a build error here.
FROM mcr.microsoft.com/playwright/python:v1.62.0-noble

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    # EC-P0-27 / P0.4.4: the container defaults to an environment that CANNOT
    # send. Production must override JOBPILOT_ENV explicitly — the unsafe
    # direction requires an affirmative act.
    JOBPILOT_ENV=local \
    DRY_RUN=true

WORKDIR /app

# Dependencies first: this layer only rebuilds when requirements.txt changes,
# not on every source edit.
COPY services/python/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# The two source projects, called as libraries by thin FastAPI handlers.
COPY services/python/ ./services/python/
COPY packages/shared-schemas/generated/ ./generated/

ENV PYTHONPATH=/app/services/python:/app/generated

# Drop privileges. The Playwright image ships a non-root `pwuser` with the
# browser sandbox already configured for it.
USER pwuser

EXPOSE 8000

# EC-P2-11 — fail fast, and fail for the RIGHT reason. Importing the app only
# proves Python starts; it says nothing about whether the browser is usable.
# Launching Chromium here means a missing/mismatched browser is caught at
# container start, when the error is obvious, instead of surfacing as a hung
# scrape under load.
HEALTHCHECK --interval=30s --timeout=30s --start-period=20s --retries=3 \
  CMD python -c "\
from playwright.sync_api import sync_playwright; \
p = sync_playwright().start(); \
b = p.chromium.launch(); \
b.close(); p.stop(); print('ok')" || exit 1

# EC-P2-13 — Playwright leaks browser contexts under concurrency and the
# container OOMs. ④'s worker count is capped independently of ③'s job
# concurrency; raising this without raising the memory limit in
# docker-compose.yml is how you get an OOM that looks like a board outage.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
