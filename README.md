# JobPilot

A unified job-search platform: **harvest → score → tailor → reach → track**.

JobPilot connects job discovery, resume tailoring, and reviewed outreach in one
workflow. Jobs, resume versions, match scores, email approvals, and application
history persist in Postgres, so each stage can use the evidence from the last.

## Features

- **Discover jobs:** search Naukri, RemoteOK, and Wellfound with per-board
  progress, retries, rate limits, and deduplication.
- **Read and rank:** fetch and cache full job descriptions, paste a JD when a
  board blocks fetching, and rank jobs using heuristic, batch LLM, and full
  tailoring scores. Low-fit jobs remain accessible.
- **Tailor resumes:** upload PDF, DOCX, or TXT resumes; keep versions and a
  default resume; review match explanations, gaps, and side-by-side rewrites;
  export tailored and comparison PDFs.
- **Prepare outreach:** add contacts with recorded sources, import contact CSVs,
  generate emails from tailoring evidence, and review each message before a
  Gmail draft or Gmail/SMTP delivery.
- **Track applications:** see pipeline status, scores, resume versions, and
  outreach history; record replies; prepare follow-ups for review; import legacy
  CSVs; download proof bundles with optional PDFs and recipient redaction.
- **Manage your account:** Supabase authentication, tenant-scoped records,
  encrypted sender credentials, account deletion, and sample onboarding data.

The repository contains the implementation through Phase 7, including health
checks, metrics, and failure-handling tests. The
[Phase 7 status](docs/implementation-plan.md#phase-7--polish-and-hardening)
records remaining deployment and live-demo verification; code being present
does not mean the complete production flow has been verified.

## Architecture

| Component | Implementation | Responsibility |
|---|---|---|
| Web app | Next.js 16, React 19, TypeScript, Tailwind CSS, TanStack Query | UI, authenticated APIs, tailoring, PDF export, outreach review, tracker |
| Orchestrator | Persistent Node.js process, BullMQ, Redis | Queued harvesting, JD hydration, batch scoring, and persistence of their results |
| Python worker | FastAPI, Playwright, board adapters, email integrations | Scraping, hydration, email generation, and delivery; no database access |
| Data and auth | PostgreSQL, Prisma, Supabase Auth | Accounts, resumes, jobs, applications, approvals, and audit records |
| File storage | Local filesystem or S3-compatible storage | Uploaded resumes and generated documents |
| Shared contract | Zod → generated Pydantic models | Validated TypeScript/Python wire types with a CI drift check |

Groq supplies the LLM calls. Redis queues background work; the web app also calls
the Python worker directly for outreach. Tailoring does not depend on Redis.

## Local setup

Run the commands below from the repository root. These instructions use hosted
Supabase for PostgreSQL and authentication, local Redis, and filesystem storage.

### Prerequisites

- **Node.js 22+** and npm. `.nvmrc` pins Node **24.19.0**; run `nvm use` if you
  manage Node with nvm.
- **Python 3.10+** with virtual environment support.
- **Docker with Compose** for Redis and optional MinIO.
- A **Supabase project** and a **Groq API key** for scoring and tailoring.
- **Chromium**, installed separately for the Node and Python Playwright clients
  in the steps below.

### 1. Configure the environment

For a fresh clone:

```bash
cp .env.example .env
ln -s ../../.env apps/web/.env.local
ln -s ../../.env apps/web/.env
```

Edit the root `.env`. The links let Next.js (`.env.local`) and Prisma commands
(`.env`) read the same configuration. If those files already exist, reconcile
them with the root `.env` before starting. The orchestrator and Python worker
load the root `.env` directly.

| Variable | Local configuration |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your project's public anon key |
| `DATABASE_URL` | Supabase transaction-pooler URL, typically port `6543` with `pgbouncer=true`; used by the web app |
| `DIRECT_URL` | Direct or session-mode PostgreSQL URL, typically port `5432`; used by migrations and the persistent orchestrator |
| `REDIS_URL` | Set to `redis://localhost:6379` |
| `GROQ_API_KEY` | Enables resume/JD parsing, scoring, tailoring, and LLM email rewriting |
| `TAILORING_MODEL`, `SCORING_MODEL`, `EMAIL_LLM_MODEL` | Keep explicit values from the root template, or choose models available to your Groq account |
| `WORKER_SERVICE_URL` | `http://localhost:8000` |
| `WORKER_SERVICE_TOKEN` | One shared token for the web app, orchestrator, and Python worker |
| `STORAGE_DRIVER` | `fs` for local files; `s3` for MinIO or another S3-compatible service |
| `JOBPILOT_ENV`, `DRY_RUN`, `SEND_MODE` | Keep `local`, `true`, and `draft` for development |

Optional integrations:

- `FIRECRAWL_API_KEY` enables the Wellfound adapter and Firecrawl-assisted
  hydration.
- `ENCRYPTION_KEY` is required to store Gmail/SMTP credentials. Generate a
  32-byte key with `openssl rand -hex 32`; keep `ENCRYPTION_KEY_VERSION=1`
  initially.
- Gmail OAuth uses `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
  `NEXT_PUBLIC_APP_URL=http://localhost:3000`. The default callback is
  `http://localhost:3000/api/outreach/oauth/google/callback`. These settings are
  documented in [apps/web/.env.example](apps/web/.env.example); add them to the
  root `.env` when needed. SMTP credentials are configured in the app.
- `METRICS_TOKEN` enables bearer-protected `/api/metrics`; without it that
  endpoint returns 404.

The full configuration reference is [.env.example](.env.example). Keep real
credentials out of version control.

### 2. Install dependencies and browsers

```bash
npm ci
npm run db:generate
npm run pdf:install --workspace=apps/web

python3 -m venv .venv
.venv/bin/python -m pip install -r services/python/requirements.txt
.venv/bin/python -m playwright install chromium
```

The Node browser install powers PDF export; the Python install powers scraping
and hydration. Each client needs its matching browser version.

### 3. Start infrastructure and apply migrations

```bash
docker compose up -d redis
npm run db:migrate
```

With `STORAGE_DRIVER=fs`, MinIO is unnecessary. To use S3-compatible storage
locally, set `STORAGE_DRIVER=s3`, keep the template's local S3 settings, and run:

```bash
docker compose up -d minio minio-init
```

`minio-init` creates the `jobpilot` bucket. The MinIO console is at
`http://localhost:9001`. A plain `docker compose up -d` also starts the bundled
PostgreSQL service; the hosted-Supabase setup above does not need it.

### 4. Run the three application processes

Use a separate terminal for each command, all from the repository root:

```bash
# Terminal 1: Python API on port 8000
npm run py:worker
```

```bash
# Terminal 2: background queue consumer
npm run worker
```

```bash
# Terminal 3: web app on port 3000
npm run dev
```

Open `http://localhost:3000` and create an account. Complete email confirmation
if enabled in your Supabase project, then upload a resume at `/resumes`, set it
as the default, and start a search at `/search`. Results live at `/jobs`, reviewed
emails at `/outreach`, and application history at `/tracker`.

`npm run db:seed` is optional: its default `demo@example.com` user is data-only
and cannot sign in. To attach seed data to a real account, create the account
first, then replace the placeholders with its Supabase user ID and email:

```bash
SEED_USER_ID='your-auth-user-uuid' SEED_USER_EMAIL='your-email' npm run db:seed
```

Check service reachability with:

```bash
curl http://localhost:8000/health
curl http://localhost:3000/api/health
```

The web health endpoint reports Redis and Python worker reachability; it does
not verify the database, LLM credentials, or that the orchestrator is consuming
jobs. Follow [the demo script](docs/demo-script.md) for workflow checks. Local
outreach is simulated, including Gmail draft creation.

### Optional containerized Python worker

Instead of `npm run py:worker`, run:

```bash
docker compose --profile worker up -d --build worker
```

The image includes Python dependencies and Chromium. Set `WORKER_SERVICE_TOKEN`
explicitly in the root `.env` so callers match the container's token. The web
app and Node orchestrator still run separately.

## Development and verification

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Next.js development server |
| `npm run build` | Build the web app for production |
| `npm run start --workspace=apps/web` | Serve a production build |
| `npm run lint` | Run ESLint for the web app |
| `npm test` | Run Vitest unit, safety, and reliability tests |
| `.venv/bin/python -m pytest services/python/tests -q` | Run Python adapter, SSRF, and delivery-safety tests |
| `npm run db:generate` | Generate the Prisma client after schema changes |
| `npm run db:migrate` | Apply committed Prisma migrations |
| `npm run db:verify` | Exercise migration constraints against PGlite without a database daemon |
| `npm run schemas:gen` | Regenerate Python models from the Zod wire schemas |
| `npm run schemas:check` | Check for drift between the TypeScript and Python contract |

Schema generation/checking also requires the pinned code generator:

```bash
.venv/bin/python -m pip install 'datamodel-code-generator==0.26.3'
npm run schemas:check
```

CI runs schema drift checks, Python tests, migration verification, web lint and
tests, and repository hygiene checks. Before implementing a task group, read its
[edge-case file](docs/edge-cases/README.md) and reference relevant `EC-P…` IDs in
code and tests.

## Safety behavior

- **Truthfulness:** deterministic server-side guardrails check generated resume
  claims before persistence; risky changes require review before export.
- **Human approval:** each outreach delivery requires a fresh, single-use
  approval bound to the exact message body. Editing the body invalidates it.
  There is no bulk-send endpoint.
- **Safe delivery defaults:** environments outside production force dry-run.
  Production still requires configured credentials, user settings, approval,
  opt-out checks, deduplication, and daily limits to permit delivery.
- **Contact provenance:** contacts come from user entry, CSV import, or published
  careers addresses. Individual contact scraping and address guessing are
  excluded.
- **Scraping controls:** rate limits, circuit breakers, robots checks, URL/SSRF
  validation, and manual JD paste handle unavailable or blocked boards.
- **Follow-ups:** a sweep creates drafts for review. It cannot send messages and
  relies on replies recorded by the user; it does not monitor an inbox.

## Repository layout

```text
apps/web/                         Next.js UI, APIs, tailoring, PDFs, Prisma, tests
packages/shared-schemas/          Zod domain/wire types and generated Python models
services/orchestrator/            BullMQ worker and harvest/hydrate/score handlers
services/python/
  main.py                        FastAPI service entry point
  routers/                       Board, hydration, email, and delivery endpoints
  harvester/                     Board adapters and scraping utilities
  outreach/                      Email generation and Gmail/SMTP integrations
  tests/                         Adapter fixtures and safety tests
scripts/                         Migration checks, key rotation, deletion cleanup
docs/                            Architecture, plan, deployment, demo, runbooks
```

## Documentation and deployment

| Document | Contents |
|---|---|
| [Problem statement](docs/problemStatement.md) | Product scope, requirements, and acceptance criteria |
| [Architecture](docs/architecture.md) | Service boundaries, data model, decisions, and safety interlocks |
| [Implementation plan](docs/implementation-plan.md) | Phase tasks, validation notes, and outstanding work |
| [Deployment guide](docs/deployment.md) | Web and worker deployment, database connections, and operational checks |
| [Demo script](docs/demo-script.md) | End-to-end walkthrough and failure-recovery demonstration |
| [Migration notes](docs/migration-notes.md) | How the three original projects were integrated |
| [Encryption key rotation](docs/runbooks/encryption-key-rotation.md) | Credential rotation procedure and verification |

Deployment configuration targets Vercel for the web app, persistent Railway
services for the orchestrator and private Python worker, hosted Supabase, Redis,
and S3-compatible storage. See the deployment guide before provisioning. The
`reap:deletions` script retries object cleanup after storage failures during
account deletion.

JobPilot incorporates [job-harvester](https://github.com/Gaurav-1008/job-harvester),
[Resume-Builder](https://github.com/Gaurav-1008/Resume-Builder), and
[cold-email-sender](https://github.com/Gaurav-1008/cold-email-sender), imported with
`git subtree` to preserve their history. Their nested READMEs describe the
original standalone projects; use this README and the root `docs/` for the
integrated platform.
