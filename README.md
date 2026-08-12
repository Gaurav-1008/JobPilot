# JobPilot

Unified job-search platform: **harvest → tailor → reach → track**.

Merges three previously separate projects into one pipeline over one data model:

| Source project | Role here | Lives in |
|---|---|---|
| [job-harvester](https://github.com/Gaurav-1008/job-harvester) | Discovery — scrape + dedupe job boards | `services/python/harvester/` |
| [Resume-Builder](https://github.com/Gaurav-1008/Resume-Builder) | Tailoring — match scoring, gap analysis, truthful rewrites, proof PDFs | `apps/web/` |
| [cold-email-sender](https://github.com/Gaurav-1008/cold-email-sender) | Outreach — personalized email, human review, audit log | `services/python/outreach/` |

All three were imported with `git subtree`, so their commit history is intact and
`git log` / `git blame` still answer "why is this line here?".

## Documentation

Read in this order:

| Doc | What it answers |
|---|---|
| [docs/problemStatement.md](docs/problemStatement.md) | Why merge — the four breakages between the projects, FR1–FR11 |
| [docs/architecture.md](docs/architecture.md) | How — four containers, 9 ADRs, unified schema, the interlock chain |
| [docs/implementation-plan.md](docs/implementation-plan.md) | In what order — 8 phases, traceability, descope order |
| [docs/edge-cases/](docs/edge-cases/) | What will bite — 334 cases keyed to tasks, one file per phase |

**Before writing code for a task group, read its edge-case file.** Cite case IDs
in code and tests (`// EC-P5-33`); `grep -r 'EC-P'` then shows real coverage.

## Status

**Phases 0 and 1 complete.** Phase 2 (harvest in the browser) is next.

| Phase | State |
|---|---|
| **0** Monorepo and contract | done — 3 projects imported with history, enforced Zod↔Pydantic codegen, 14-table schema |
| **1** Persistence and auth | done — Supabase Auth, resume library, tailoring runs persist server-side |

Phase 1 closed **Breakage 3 (part)**: a tailoring run now survives the browser.
Both lost-state stores are gone — the in-memory server map and the
`sessionStorage` client store.

| Task | State |
|---|---|
| P1.1 Supabase Auth + default-deny middleware | done — schema live on the hosted project |
| P1.2 Resume library: upload, parse, versions, default | done |
| P1.3 Tailoring persisted server-side; both stores deleted | done |
| P1.4 Guardrails enforced before persistence | done |
| P1.5 Safety tests 8 and 10 | done — both verified by deliberate break |

**Not yet walked in a browser.** The pages build and the routes exist, but the
live sign-up → upload → tailor path needs a real inbox (EC-P1-43) and has not
been exercised end to end.

## Getting started

```bash
# 0. Secrets — fill these in .env (never commit it)
cp .env.example .env
#    NEXT_PUBLIC_SUPABASE_ANON_KEY   Dashboard -> Settings -> API (public key)
#    DATABASE_URL                    Settings -> Database -> pooled  (:6543)
#    DIRECT_URL                      Settings -> Database -> direct  (:5432)

# 1. Local infrastructure (Redis, MinIO — Postgres now lives in Supabase)
docker compose up -d

# 2. Web app ①
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev

# 3. Python service ④
python3 -m venv .venv
.venv/bin/python -m pip install -r services/python/requirements.txt
.venv/bin/playwright install chromium      # needed from Phase 2 on
```

Requires Node 20+ and Python 3.10+ (EC-P0-06 — The Closer's floor; the harvester
claimed 3.8 but was never tested above it).

### Useful commands

| Command | What it does |
|---|---|
| `npm run db:verify` | Runs the migration against WASM Postgres and asserts every constraint **rejects** what it should. No Docker needed |
| `npm run schemas:gen` | Regenerates `models.py` from the Zod wire types |
| `npm run schemas:check` | Fails on schema drift — what CI runs |
| `docker compose --profile worker up -d` | Adds ④ (only once P2.1.1 creates `main.py`) |
| `docker compose --profile local-auth up -d auth` | Offline auth — GoTrue against local Postgres, if you'd rather not use the hosted project |

`db:verify` is worth knowing about: it executes the real migration without a
database daemon, so schema changes are checked on any machine and in CI.

## Safety posture

Inherited from the source projects and enforced platform-wide. These are not
preferences:

- **Truthfulness** — no fabricated employers, credentials, metrics, or skills.
  Deterministic guardrails run server-side *before* persistence.
- **Human review** — every outreach email requires a fresh, single-use,
  body-bound approval token. There is no bulk-send path, by design.
- **Safe defaults** — missing config resolves toward *not sending*. `DRY_RUN` is
  forced on in local, test, ci, and staging regardless of any override
  (`JOBPILOT_ENV`); only production honours `DRY_RUN=false`.
- **Contact sourcing** — user-entered, CSV import, or a published careers
  address. No scraping of individuals, no address pattern-guessing (ADR-008).
- **Scraping conduct** — honest user-agent, per-board rate limits, `robots.txt`
  respected, permanent JD cache, manual paste when a board blocks. No evasion.

## Layout

```
apps/web/                  ① Next.js — UI, API, tailoring, PDF export
services/python/
  harvester/               ④ board adapters (Naukri, RemoteOK, Wellfound)
  outreach/                ④ email generation, delivery, audit
  requirements.txt         resolved dependency set for ④ (EC-P0-05)
docs/                      problem statement, architecture, plan, edge cases
```

`packages/shared-schemas/` holds the Zod↔Pydantic contract. Planned but not yet
created: `services/orchestrator/` (③, the single writer).
