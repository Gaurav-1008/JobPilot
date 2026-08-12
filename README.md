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

**Phase 0 complete.** The three projects are imported with history and still run
standalone; the shared schema contract, database layer, and local stack are in
place. Phase 1 (auth + persistence) is next.

| Task | State |
|---|---|
| P0.1 monorepo + subtree imports | done — 13 commits, history intact |
| P0.2 shared schemas + enforced codegen | done — 27 Pydantic classes, 3 guards verified |
| P0.3 migration, repository, import ban | done — 14 tables, 19/19 constraint tests pass |
| P0.4 local stack | done — compose + Dockerfile; ④ lands in P2.1.1 |

## Getting started

```bash
# 1. Local infrastructure (Postgres, Redis, MinIO)
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

cp .env.example .env                       # never commit the result
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

Planned but not yet created: `services/orchestrator/` (③, the single writer) and
`packages/shared-schemas/` (the Zod↔Pydantic contract).
