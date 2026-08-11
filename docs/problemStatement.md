# Problem Statement: JobPilot

## The Unified Job-Search Platform (Harvest → Tailor → Reach → Track)

> **Working name.** "JobPilot" is a placeholder. Alternatives: *The Funnel*, *ApplyOS*, *Career Autopilot*.

---

## 1. Project Summary

**JobPilot** merges three previously built, independently working projects into a single platform that carries a job seeker from *"I don't know what to apply to"* all the way to *"I have a tailored resume and a personalized email in a recruiter's inbox — with proof."*

The three source projects:

| # | Project | Repository | Role in the platform |
|---|---------|-----------|---------------------|
| 1 | **Job Harvester** | `Gaurav-1008/job-harvester` | **Discovery** — scrapes and deduplicates job listings from Naukri, RemoteOK, and Wellfound |
| 2 | **Resume Shapeshifter** | `Gaurav-1008/Resume-Builder` | **Tailoring** — JD-to-resume match scoring, gap analysis, truthful bullet rewrites, side-by-side PDF proof |
| 3 | **The Closer** | `Gaurav-1008/cold-email-sender` | **Outreach** — safety-first personalized cold email generation, preview, send/draft, audit logging |

Each one solves one third of the job-search problem well. None of them talk to each other. Today a user must run a Python CLI, hand-copy a job link into a Next.js app, download a PDF, then hand-copy the company and role into a second Python CLI and manually source a recipient email.

**JobPilot removes the copy-paste seams and makes the three stages one pipeline over one shared data model.**

---

## 2. Background — What Already Exists

### 2.1 Job Harvester (Python CLI)

- **Stack:** Python 3.8+, Playwright, Firecrawl SDK, requests.
- **Architecture:** An abstract `BoardAdapter` interface (`boards/base.py`) with a single `fetch(role, location) -> list[dict]` method. Three implementations: `naukri.py` (requests + Playwright fallback), `remoteok.py` (native JSON API), `wellfound.py` (Firecrawl).
- **Orchestrator:** `harvester.py` fans out across adapters and deduplicates.
- **Output:** `jobs.csv` with columns `source, title, company, location, link, posted_at`.
- **Invocation:** `python harvester.py --role "AI Engineer" --location "Bengaluru" --limit 20 --output jobs.csv`
- **No LLM usage.** Pure scraping and normalization.

### 2.2 Resume Shapeshifter (Next.js / TypeScript)

- **Stack:** Next.js App Router, React, TypeScript, TanStack Query, Zod, Vitest, Playwright (for PDF), Groq API (`llama-3.3-70b-versatile` by default).
- **Architecture:** Zod schemas in `lib/schemas.ts` define the whole domain. `lib/orchestrator.ts` drives the run. LLM access is isolated behind `lib/llm/client.ts` and `lib/llm/run-prompt.ts`. `lib/guardrails.ts` holds deterministic anti-fabrication checks. PDF rendering lives in `lib/pdf/renderer.ts`.
- **API routes:** `/api/parse/resume`, `/api/parse/jd`, `/api/analyze`, `/api/tailor`, `/api/export/pdf`, `/api/upload/resume`, `/api/runs/[id]`.
- **Inputs:** resume (paste, or PDF/DOCX/TXT upload) + job description **text**.
- **Outputs:** match score before/after, gap analysis, bullet-level rewrites with reason + confidence + risk flag, tailored resume PDF, side-by-side comparison PDF.
- **Persistence:** session-scoped only (`sessionStorage` via `lib/run-client-store.ts`). Nothing survives a new browser session.

### 2.3 The Closer (Python CLI + Streamlit)

- **Stack:** Python 3.10+, `smtplib`, Gmail API (OAuth2), Anthropic Claude API (optional rewriting), Streamlit UI.
- **Architecture:** `load → generate → preview → confirm → deliver → log`. Modules: `input_loader.py`, `email_generator.py` (deterministic six-part template), `llm_generator.py` (Claude rewrite + validator), `preview.py`, `email_sender.py` (SMTP), `gmail_sender.py` (OAuth), `recipient_filter.py` (opt-out + dedup), `logger.py`, `smtp_check.py`.
- **Domain model** (`models.py`): `Contact`, `EmailDraft`, `LogEntry`.
- **Inputs:** `contacts.json` or `jobs.csv` — each record needs `recipient_email`, `company`, `role`, `candidate_name`, `candidate_background`, plus optional `recipient_name`, `job_url`, `portfolio_url`, `personalization_note`, `linkedin_url`, `resume_link`.
- **Outputs:** sent or drafted Gmail messages, and an append-only `outreach_log.csv` audit trail.
- **Safety posture:** `DRY_RUN=true` by default, mandatory per-email human review, `MAX_OUTREACH_PER_RUN=5`, 150-word cap, SMTP preflight, opt-out suppression, deduplication.

---

## 3. Core Problem

A job seeker's real workflow has four stages, and the current tooling breaks at every boundary between them.

```text
DISCOVER          TAILOR              REACH              TRACK
job-harvester  →  Resume Shapeshifter → The Closer   →   (nothing exists)
   CSV file        browser session       CLI + JSON        no system of record
      └──── manual copy ────┘  └──── manual copy ────┘
```

The four concrete breakages:

**Breakage 1 — The harvester produces no job description text.**
`jobs.csv` carries `title, company, location, link, posted_at`. Resume Shapeshifter needs the **full JD body** to extract required skills, responsibilities, and seniority. Today the user opens each link and copy-pastes the description by hand.

**Breakage 2 — The harvester produces no contact.**
The Closer's `Contact` requires a `recipient_email`. A scraped listing has a company name and a URL, never a person. This is the single largest gap in the pipeline and the one with the most serious ethical weight.

**Breakage 3 — Nothing persists.**
Resume Shapeshifter forgets everything on a new session. The Closer's only memory is a flat CSV. There is no entity that says *"for job X, I used resume version Y, scored 74, emailed Priya on the 3rd, no reply yet."*

**Breakage 4 — Tailoring is one-at-a-time.**
The harvester returns 20 jobs in one run. Resume Shapeshifter tailors one JD per session. There is no way to score a resume against 20 listings and rank them by fit before deciding where to spend effort.

**JobPilot exists to close these four gaps.** The value is not in rewriting the three projects — it is in the connective tissue, the shared data model, and the tracking layer none of them has.

---

## 4. Target Users

### Primary

- Students and early-career professionals running a high-volume, low-budget job search.
- Career switchers who must tailor heavily for every application.
- Anyone applying to 20+ roles who cannot sustain manual tailoring and outreach.

### Secondary

- Bootcamp and university placement teams running cohort-wide searches.
- Career coaches reviewing a client's pipeline.

### Example user story

> As a job seeker, I want to search for "AI Engineer" roles once, see each one scored against my actual resume, tailor the top five truthfully, and send five reviewed personalized emails — without leaving one app or retyping anything.

---

## 5. Project Goal

Build a single web platform that runs the complete pipeline end to end:

```text
              ┌──────────────────────────────────────────────┐
              │              1. DISCOVER                     │
              │  Search role + location across job boards     │
              │  Deduplicate → normalized Job records         │
              └────────────────────┬─────────────────────────┘
                                   ↓
              ┌──────────────────────────────────────────────┐
              │              2. HYDRATE                       │
              │  Fetch full JD text from each listing URL     │
              │  Extract structured requirements              │
              └────────────────────┬─────────────────────────┘
                                   ↓
              ┌──────────────────────────────────────────────┐
              │              3. SCORE (batch)                 │
              │  Score the user's resume against every job    │
              │  Rank the board by fit, cheap pass first      │
              └────────────────────┬─────────────────────────┘
                                   ↓
              ┌──────────────────────────────────────────────┐
              │              4. TAILOR (per job)              │
              │  Truthful bullet rewrites + gap analysis      │
              │  Guardrails → tailored resume + proof PDF     │
              └────────────────────┬─────────────────────────┘
                                   ↓
              ┌──────────────────────────────────────────────┐
              │              5. RESOLVE CONTACT               │
              │  User-supplied or consented-source recipient   │
              │  Opt-out suppression + dedup                  │
              └────────────────────┬─────────────────────────┘
                                   ↓
              ┌──────────────────────────────────────────────┐
              │              6. REACH                         │
              │  Personalized email seeded with real evidence │
              │  Mandatory preview → draft or send → log      │
              └────────────────────┬─────────────────────────┘
                                   ↓
              ┌──────────────────────────────────────────────┐
              │              7. TRACK                         │
              │  Application status board, follow-ups, proof  │
              └──────────────────────────────────────────────┘
```

**The compounding win:** stage 4 produces gap analysis and rewrite reasoning that stage 6 can use as genuine personalization material. An email that says *"I noticed the role leans on retrieval pipelines — that is what I spent the last six months building"* is grounded in the scoring engine's actual output, not invented. **The tailoring engine becomes the personalization engine.** No standalone cold-email tool can do this.

---

## 6. MVP Scope

The MVP is complete when a single user can, in one session, without leaving the app:

1. Enter a role and location and run a harvest.
2. See a table of deduplicated jobs from at least two boards.
3. Upload a resume once and have it persist across sessions.
4. Trigger batch scoring and see every job ranked by match score.
5. Open one job, run full tailoring, and review side-by-side bullet changes.
6. Export the tailored resume PDF and the side-by-side proof PDF.
7. Add a recipient email for that job.
8. Generate a personalized email pre-filled from the tailoring run's evidence.
9. Preview it, pick a subject line, and create a Gmail **draft**.
10. See the application move to `emailed` on a tracking board, with the audit log row visible.

---

## 7. Non-Goals for MVP

The MVP must **not** attempt:

- Auto-apply or form-filling on job boards.
- Bulk/mass emailing. The per-run cap from The Closer stays.
- Scraping personal contact details from LinkedIn, or buying/scraping email lists.
- Email-guessing patterns (`first.last@company.com`) as a default behavior.
- Multi-tenant SaaS with billing.
- Fabricating any resume content — the truthfulness guardrails are non-negotiable and inherited wholesale.
- Guaranteeing ATS ranking outcomes or reply rates.
- Mobile-native apps.
- Real-time job alerts / scheduled background harvesting (Phase 6 stretch).

---

## 8. Unified Domain Model

This is the heart of the merge. Today, three vocabularies describe overlapping things. One schema replaces all three.

### 8.1 Entity relationships

```text
User
 ├── Resume (1..n, versioned)          ← "master resume" + tailored variants
 ├── HarvestRun (1..n)
 │     └── Job (1..n)                  ← from job-harvester
 │           ├── JobDescription        ← NEW: hydrated full text + structured extract
 │           ├── TailoringRun (0..n)   ← from Resume Shapeshifter
 │           │     ├── MatchScore
 │           │     ├── ResumeGap (0..n)
 │           │     ├── BulletChange (0..n)
 │           │     └── ExportedDocument (0..n)
 │           └── Application (0..1)     ← NEW: the system of record
 │                 ├── Contact (0..n)   ← from The Closer
 │                 └── OutreachAttempt (0..n)  ← replaces outreach_log.csv
 └── OptOutList (1)
```

### 8.2 `Job` — extends the harvester's CSV row

```json
{
  "id": "uuid",
  "source": "naukri | remoteok | wellfound",
  "title": "",
  "company": "",
  "location": "",
  "link": "",
  "postedAt": "",
  "harvestRunId": "uuid",
  "dedupeKey": "normalized(company)+normalized(title)+normalized(location)",
  "hydrationStatus": "pending | hydrated | failed | blocked",
  "createdAt": ""
}
```

> The first six fields are exactly the existing `jobs.csv` columns, so the current adapters need no rewrite — only a return-type change from `dict` to a validated model.

### 8.3 `JobDescription` — new, closes Breakage 1

```json
{
  "jobId": "uuid",
  "rawText": "",
  "extractedAt": "",
  "extractionMethod": "firecrawl | playwright | manual-paste",
  "jobTitle": "",
  "company": "",
  "requiredSkills": [],
  "preferredSkills": [],
  "responsibilities": [],
  "qualifications": [],
  "tools": [],
  "keywords": [],
  "seniorityLevel": "",
  "domainSignals": []
}
```

> The structured half is Resume Shapeshifter's existing `JobDescriptionProfile`. The `rawText` + `extractionMethod` half is new and is produced by reusing the harvester's Playwright/Firecrawl machinery against a single URL. **`manual-paste` must always remain available as a fallback** — some boards will block hydration, and the user must never be hard-blocked.

### 8.4 `Application` — new, closes Breakage 3

The system of record. One per job the user actually pursues.

```json
{
  "id": "uuid",
  "jobId": "uuid",
  "userId": "uuid",
  "status": "saved | scored | tailored | contact_added | emailed | replied | interviewing | rejected | closed",
  "activeTailoringRunId": "uuid | null",
  "resumeVersionId": "uuid | null",
  "originalScore": 0,
  "tailoredScore": 0,
  "notes": "",
  "createdAt": "",
  "updatedAt": ""
}
```

### 8.5 `Contact` — The Closer's model, now derived not hand-typed

```json
{
  "id": "uuid",
  "applicationId": "uuid",
  "recipientEmail": "",
  "recipientName": "",
  "company": "",
  "role": "",
  "jobUrl": "",
  "source": "user_entered | company_careers_page | public_profile | imported_csv",
  "personalizationNote": "",
  "linkedinUrl": "",
  "suppressed": false,
  "suppressionReason": "opt_out | already_contacted | invalid | null"
}
```

> `company`, `role`, and `jobUrl` are **auto-filled from the `Job`**. `candidate_name`, `candidate_background`, `portfolio_url`, and `resume_link` move up to the `User` profile — they are properties of the sender, not of each contact, and repeating them per row in `contacts.json` was always redundant. `source` is new and mandatory: every contact must record where it came from.

### 8.6 `OutreachAttempt` — replaces `outreach_log.csv`

```json
{
  "id": "uuid",
  "applicationId": "uuid",
  "contactId": "uuid",
  "parentId": "uuid | null",
  "timestamp": "",
  "subject": "",
  "bodySnapshot": "",
  "wordCount": 0,
  "generationSource": "template | llm",
  "status": "generated | drafted | sent | skipped | failed",
  "provider": "dry_run | smtp | gmail_api",
  "errorMessage": ""
}
```

> `parentId` preserves The Closer's Phase 8 follow-up linkage. `bodySnapshot` is new — the platform stores what was actually sent, which the CSV log never did.

### 8.7 Reused as-is

`ResumeProfile`, `MatchScore`, `TailoredResume`, `BulletChange`, `ResumeGap`, and `TailoringRun` carry over unchanged from Resume Shapeshifter's `lib/schemas.ts`. `EmailDraft` carries over from The Closer's `models.py`. **Do not redesign these.** They are proven and tested; the merge work is around them, not inside them.

---

## 9. Functional Requirements

### FR1 — Harvest jobs from the web app

The user enters role, location, per-board limit, and board selection. The platform runs the existing adapters and persists normalized `Job` rows against a `HarvestRun`.

- Harvesting is slow (Playwright, Firecrawl) and **must be a background job**, not a blocking HTTP request.
- The UI shows live progress per board and partial results as they land.
- One board failing must never fail the run. Report per-board status: `ok | partial | failed`, with the reason.
- Deduplication uses the existing cross-source logic, promoted to a stable `dedupeKey` so dedupe also works *across* harvest runs, not just within one.

### FR2 — Hydrate job descriptions

For each job the user marks as interesting (not every scraped row — that is wasteful and unkind to the source sites):

- Fetch the listing page and extract readable JD text via Firecrawl, falling back to Playwright.
- Run the existing JD extraction prompt to produce the structured profile.
- On failure, set `hydrationStatus: "blocked"` and surface a **paste-the-description-here** box. Never dead-end the user.
- Cache aggressively. A given URL is fetched once, ever.

### FR3 — Persistent resume library

- Upload once (PDF/DOCX/TXT via the existing `lib/document-extract.ts`), parse to `ResumeProfile`, store as the **master resume**.
- Support multiple versions and a designated default.
- Every tailored output is stored as a derived version linked to its `TailoringRun` — so the user can always answer *"which resume did I actually send to this company?"*

### FR4 — Batch scoring and ranking

- Score the master resume against every hydrated job in a harvest run.
- Return `overallScore` plus the component sub-scores and a one-line explanation per job.
- Rank the job table by score. Support filtering by score band, board, location, and posting recency.
- Use a **cheap scoring pass** here (smaller model, or heuristic pre-filter via the existing `lib/heuristic-resume.ts`) — running the full tailoring prompt chain across 20 jobs is prohibitively slow and expensive. Full tailoring is opt-in, per job.

### FR5 — Full tailoring (unchanged behavior)

Open one job → the existing Resume Shapeshifter flow runs against the stored resume and the hydrated JD, producing bullet rewrites, gap analysis, tailored score, and both PDFs. All existing guardrails in `lib/guardrails.ts` apply unchanged.

The only change is provenance: the JD arrives from the `Job` record rather than a paste box, and the result persists to a `TailoringRun` instead of `sessionStorage`.

### FR6 — Contact resolution (closes Breakage 2)

The MVP supports exactly three contact sources, in priority order:

1. **User-entered** — the user found the person themselves. Always available.
2. **CSV import** — the user brings a contacts file they already have. Reuses the existing CSV loader.
3. **Public careers-page address** — a `careers@` / `jobs@` address published by the company for this purpose.

Every contact records its `source`. **Automated scraping of individuals' email addresses and pattern-guessing of addresses are explicitly out of scope** — see §12.

Before any contact is usable, `recipient_filter.py`'s existing logic runs: opt-out list suppression, then deduplication against prior `sent`/`drafted` attempts.

### FR7 — Evidence-seeded email generation

This is the feature that only exists because the projects are merged.

When generating an email for an application that has a completed `TailoringRun`, the generator receives a **personalization payload** built from real analysis:

```json
{
  "topMatchedSkills": ["retrieval pipelines", "Python", "evaluation harnesses"],
  "strongestBullet": "Built a document retrieval pipeline serving 40k queries/month",
  "jdHooks": ["team is scaling their RAG stack", "emphasis on eval tooling"],
  "matchScore": 78,
  "honestGaps": ["no production Kubernetes experience"]
}
```

Rules:

- The email may reference **only** skills and bullets present in the payload. This is the same anti-fabrication contract the resume engine already enforces, extended to outreach.
- The existing six-part template stays the deterministic baseline. LLM rewriting stays opt-in, behind the existing validator (≤150 words, no fabricated-relationship language, template fallback on any validation failure).
- The generic-hook warning stays. With tailoring evidence available, a generic hook now indicates a bug worth surfacing.
- 2–3 subject-line options are offered at preview, as today.

### FR8 — Preview, send, and log

Non-negotiable, inherited from The Closer without weakening:

- **Mandatory human review of every email.** No bulk-send-all button. Ever.
- `DRY_RUN=true` is the default for a new account.
- Gmail **draft** mode is the recommended and default delivery mode.
- `MAX_OUTREACH_PER_RUN` cap enforced server-side, not just in the UI.
- SMTP/OAuth preflight before any live path.
- Every decision — including `skipped` and `failed` — writes an `OutreachAttempt`.

### FR9 — Application tracker

A board or table view over `Application`, showing job, score before/after, resume version used, contact, last outreach, and status. Status transitions are mostly automatic (tailoring completes → `tailored`; email sent → `emailed`) with manual override for `replied`, `interviewing`, `rejected`.

### FR10 — Follow-ups

Reuse `followup_generator.py`: find applications in `emailed` with no reply after N days, generate a short follow-up referencing the original, link it via `parentId`, and route it through the same mandatory preview.

### FR11 — Proof export

One command exports a portfolio-ready evidence bundle: side-by-side PDFs, the outreach log, and a pipeline summary. This satisfies the proof requirement all three original projects carried.

---

## 10. Architecture

### 10.1 The language problem

Two of the three projects are Python; one is TypeScript. The three viable options:

| Option | Approach | Verdict |
|--------|----------|---------|
| **A. Port Python → TypeScript** | Rewrite harvester and Closer in TS | ✗ Throws away working, debugged code. Playwright-Python scrapers are tuned per board; Gmail OAuth is proven. Highest risk, no upside. |
| **B. Port TS → Python** | Rewrite Shapeshifter as FastAPI + Jinja/HTMX | ✗ Throws away the entire UI, Zod schema layer, and guardrails. Worst option. |
| **C. Keep both, integrate over HTTP** | Next.js as the app + BFF; FastAPI service wrapping the Python | ✓ **Recommended.** Zero rewrite. Each side keeps its natural ecosystem. |

**Recommended architecture — Option C:**

```text
┌───────────────────────────────────────────────────────────┐
│  Next.js App (TypeScript)                                  │
│  ─────────────────────────────────────────────────────────│
│  UI: search, job board, tailor flow, outreach, tracker      │
│  API routes: auth, CRUD, tailoring orchestration (existing) │
│  Owns: ResumeProfile, TailoringRun, MatchScore, PDF export  │
└───────────────┬───────────────────────────────────────────┘
                │ internal HTTP (service token)
                ↓
┌───────────────────────────────────────────────────────────┐
│  FastAPI Worker Service (Python)                           │
│  ─────────────────────────────────────────────────────────│
│  POST /harvest       → wraps harvester.py + boards/*        │
│  POST /hydrate       → Firecrawl/Playwright single-URL fetch│
│  POST /email/preview → wraps email_generator.py             │
│  POST /email/deliver → wraps email_sender / gmail_sender    │
│  Owns: scraping, SMTP/OAuth delivery                        │
└───────────────┬───────────────────────────────────────────┘
                ↓
┌───────────────────────────────────────────────────────────┐
│  PostgreSQL  │  Job queue  │  Object storage (PDFs)         │
└───────────────────────────────────────────────────────────┘
```

**Migration rule:** the existing Python modules become **libraries called by thin FastAPI handlers**. `harvester.py`'s CLI argument parsing gets separated from its orchestration function; `main.py`'s interactive `input()` prompts get replaced by an HTTP request/response cycle. The board adapters, the generator, the senders, the filter, and the validator are all called unchanged.

### 10.2 Long-running work

Harvesting and hydration take tens of seconds to minutes. Both must run as queued background jobs with a status endpoint the UI polls. Do not attempt these inside a request handler — serverless platforms will time out.

### 10.3 Secrets and per-user credentials

The single-user `.env` model does not survive multi-user. Per-user Gmail OAuth tokens must be encrypted at rest and scoped to the user. `GROQ_API_KEY`, `FIRECRAWL_API_KEY`, and `ANTHROPIC_API_KEY` remain platform-level server-side secrets and are never exposed to the browser.

---

## 11. Recommended Tech Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Frontend | Next.js (App Router), React, TypeScript, Tailwind, Shadcn UI | Carried over from Resume Shapeshifter |
| Client state | TanStack Query | Already in use |
| Validation | Zod (TS) + Pydantic (Python) | Keep schemas mirrored; treat Zod as source of truth |
| Python service | FastAPI + Uvicorn | Thin wrapper over existing modules |
| Scraping | Playwright, Firecrawl SDK | Unchanged from job-harvester |
| Database | PostgreSQL (Supabase or Neon) | Replaces CSV + sessionStorage |
| ORM | Prisma or Drizzle | TS side owns migrations |
| Queue | Redis + BullMQ, or Postgres-backed queue | For harvest/hydrate jobs |
| LLM — tailoring | Groq (`llama-3.3-70b-versatile`) | Unchanged; fast and cheap for batch scoring |
| LLM — email rewrite | Claude (Anthropic) | Unchanged from The Closer |
| PDF | Playwright + Chromium | Unchanged from Resume Shapeshifter |
| Email | `smtplib` + Gmail API (OAuth2) | Unchanged from The Closer |
| Auth | NextAuth / Clerk / Supabase Auth | New requirement |
| File storage | S3-compatible or Supabase Storage | Resumes and generated PDFs |
| Testing | Vitest (TS), pytest (Python) | Vitest already in use |

---

## 12. Safety, Ethics, and Compliance

All three projects were built with guardrails. **Combining them raises the stakes, because the platform now enables volume.** Every existing guardrail is inherited, and three new ones are added.

### 12.1 Inherited — truthfulness (from Resume Shapeshifter)

The system must never add employers the user did not work for, degrees or certifications they do not hold, technologies absent from their resume, metrics they did not provide, or leadership scope not implied by the original. Uncertain content is marked as a suggestion requiring confirmation. `lib/guardrails.ts` runs unchanged, and its risk flags surface in the UI.

### 12.2 Inherited — anti-spam (from The Closer)

Dry-run default, mandatory per-email human review, per-run volume cap, 150-word limit, opt-out suppression, deduplication, no deceptive identity, no fabricated relationships or referrals, and an append-only audit trail of every attempt including skips and failures.

### 12.3 NEW — contact sourcing ethics

This is the platform's sharpest new risk. Merging a scraper with an emailer creates something that *could* become a spam engine. It must not.

**Rules:**

- **No automated harvesting of individuals' email addresses.** Not from LinkedIn, not from public profiles, not from data brokers.
- **No email pattern-guessing** (`first.last@company.com`). Guessed addresses bounce, damage sender reputation, and reach uninvolved people.
- Every `Contact` records a `source` and the platform displays it before send.
- Recipients are limited to addresses the company published for this purpose, or that the user sourced themselves and can account for.
- A visible, honored opt-out mechanism, checked before every send.

**Design principle:** the platform should make *discovering jobs* effortless and *contacting humans* deliberate. Automating the first is a service; automating the second is spam.

### 12.4 NEW — scraping conduct

- Respect `robots.txt` and each board's terms of service.
- Rate-limit per board with backoff; cache hydrated JDs permanently to avoid refetching.
- Identify the client honestly. Do not rotate proxies or evade blocks.
- Hydrate only jobs the user expressed interest in, not every scraped row.
- If a board blocks access, fall back to manual paste — never escalate evasion.

### 12.5 NEW — data protection

Contacts are third-party personal data. Encrypt at rest, scope strictly to the owning user, never share across accounts, support full deletion on request, and never use one user's contacts to enrich another's.

---

## 13. Suggested Folder Structure

```text
jobpilot/
├── apps/
│   └── web/                          # Next.js — carried from Resume-Builder
│       ├── app/
│       │   ├── (dashboard)/
│       │   │   ├── search/            # FR1  harvest
│       │   │   ├── jobs/              # FR4  ranked board
│       │   │   ├── tailor/[jobId]/    # FR5  existing TailorFlow
│       │   │   ├── outreach/[appId]/  # FR7-8
│       │   │   └── tracker/           # FR9
│       │   └── api/
│       │       ├── harvest/           # → proxies to worker
│       │       ├── hydrate/
│       │       ├── analyze/           # existing
│       │       ├── tailor/            # existing
│       │       ├── export/pdf/        # existing
│       │       ├── contacts/
│       │       ├── outreach/
│       │       └── applications/
│       ├── components/                # existing + new board/tracker views
│       ├── lib/
│       │   ├── schemas.ts             # EXTENDED with new entities
│       │   ├── guardrails.ts          # unchanged
│       │   ├── orchestrator.ts        # extended for batch scoring
│       │   ├── llm/                   # unchanged
│       │   ├── pdf/                   # unchanged
│       │   └── db/                    # NEW
│       └── hooks/
│
├── services/
│   └── worker/                        # FastAPI — carried from the Python repos
│       ├── main.py                    # FastAPI app
│       ├── routers/
│       │   ├── harvest.py
│       │   ├── hydrate.py
│       │   └── outreach.py
│       ├── harvester/                 # from job-harvester, CLI stripped
│       │   ├── boards/{base,naukri,remoteok,wellfound}.py
│       │   └── orchestrator.py
│       ├── outreach/                  # from cold-email-sender
│       │   ├── email_generator.py
│       │   ├── llm_generator.py
│       │   ├── email_sender.py
│       │   ├── gmail_sender.py
│       │   ├── recipient_filter.py
│       │   ├── followup_generator.py
│       │   └── smtp_check.py
│       └── models.py                  # Pydantic mirrors of the Zod schemas
│
├── packages/
│   └── shared-schemas/                # single source of truth for the contract
│
└── docs/
    ├── problemStatement.md            # this document
    ├── architecture.md
    ├── implementation-plan.md
    └── migration-notes.md             # what changed in each source repo
```

---

## 14. Environment Variables

```env
# ── LLM ─────────────────────────────────────────────
GROQ_API_KEY=
GROQ_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=llama-3.3-70b-versatile
SCORING_MODEL=llama-3.1-8b-instant     # cheap batch-scoring pass (FR4)
ANTHROPIC_API_KEY=                     # optional email rewriting
EMAIL_LLM_MODEL=claude-opus-4-8

# ── Scraping ────────────────────────────────────────
FIRECRAWL_API_KEY=
SCRAPE_RATE_LIMIT_PER_MIN=10
HYDRATION_CACHE_TTL_DAYS=30

# ── Data ────────────────────────────────────────────
DATABASE_URL=
REDIS_URL=
STORAGE_BUCKET=
MAX_UPLOAD_MB=5

# ── Outreach safety (defaults are deliberately strict) ──
DRY_RUN=true
SEND_MODE=draft
PROVIDER=gmail
MAX_OUTREACH_PER_RUN=5
EMAIL_WORD_LIMIT=150
DEDUPE=true

# ── Services ────────────────────────────────────────
WORKER_SERVICE_URL=http://localhost:8000
WORKER_SERVICE_TOKEN=
NEXTAUTH_SECRET=
ENCRYPTION_KEY=                        # per-user OAuth token encryption
```

Never commit real credentials. `DRY_RUN=true` stays default for every new account.

---

## 15. Phased Implementation Plan

Each phase ends with something demonstrable. Ship vertically, not layer by layer.

### Phase 0 — Monorepo and contract
Stand up the monorepo. Move the three repos in unchanged and confirm each still runs standalone. Define the shared schema package. Set up Postgres and migrations.
**Demo:** all three still work, now in one tree.

### Phase 1 — Persistence
Add auth, users, and the resume library. Rewire Resume Shapeshifter off `sessionStorage` onto the database. Tailoring runs persist and are retrievable by URL.
**Demo:** tailor a resume, close the browser, reopen, and the run is still there.

### Phase 2 — Harvest in the browser
Wrap `harvester.py` in FastAPI. Add the queue. Build search UI and job table.
**Demo:** search "AI Engineer, Bengaluru" in a browser, watch results stream into a table.

### Phase 3 — Hydration (closes Breakage 1)
Add single-URL JD extraction with Firecrawl/Playwright, structured extraction, caching, and the manual-paste fallback.
**Demo:** click a scraped job, see its full parsed requirements — zero copy-paste.

### Phase 4 — Batch scoring (closes Breakage 4)
Cheap scoring pass across all hydrated jobs; rank and filter the board. Wire "Tailor this one" straight into the existing flow.
**Demo:** 20 jobs ranked by real fit against a real resume; tailor the top one in two clicks.

### Phase 5 — Outreach (closes Breakage 2)
Wrap The Closer in FastAPI. Contact entry + CSV import + opt-out + dedup. **Build the evidence-seeded personalization payload (FR7).** Preview UI, Gmail draft path, `OutreachAttempt` logging.
**Demo:** tailored resume → email referencing the actual matched skills → Gmail draft → audit row.

### Phase 6 — Tracker and proof (closes Breakage 3)
Application board, status transitions, follow-up generation, evidence-bundle export.
**Demo:** the full funnel for 5 real jobs on one screen.

### Phase 7 — Polish and hardening
Rate limiting, error states, empty states, loading skeletons, retries, per-board failure reporting, guardrail surfacing in the UI, onboarding with sample data.

---

## 16. Acceptance Criteria

The project is complete when a user can:

1. Sign in and upload a master resume that persists.
2. Search a role + location and receive deduplicated results from ≥2 boards.
3. See at least one job hydrated with full JD text and structured requirements, with no manual copy-paste.
4. See every hydrated job scored and ranked against their resume.
5. Run full tailoring on a chosen job and review bullet-level changes with reasons, confidence, and risk flags.
6. Export both the tailored resume PDF and the side-by-side proof PDF.
7. Add a contact whose company, role, and job URL are auto-filled from the job record.
8. Generate an email whose personalization demonstrably references output from the tailoring run.
9. Preview it, choose a subject, and create a real Gmail draft.
10. See the application on a tracker with score before/after, resume version, and outreach history.
11. Confirm that opt-out and dedup suppression actually blocked a suppressed recipient.
12. Confirm the audit trail recorded every attempt, including skips and failures.

---

## 17. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Job boards block scraping | Discovery breaks | Multi-board redundancy, honest rate limiting, per-board failure isolation, manual-paste fallback, permanent hydration cache |
| Contact sourcing has no ethical automated solution | The weakest link in the funnel | Accept it. User-entered contacts are the MVP path. Do not build guessing or scraping to paper over it (§12.3) |
| Batch scoring cost/latency across 20+ jobs | Unusable or expensive | Two-tier scoring: heuristic/cheap model to rank, full prompt chain only on demand |
| Merged tool enables spam at volume | Reputational and ethical failure | Every Closer guardrail preserved server-side; no bulk-send path exists at any layer |
| TS/Python split doubles schema maintenance | Silent drift, runtime errors | Single shared-schema package; generate Pydantic models from Zod, validate at the service boundary in CI |
| Long scrapes time out on serverless | Harvest silently fails | Queue-backed background jobs from Phase 2, never in-request |
| LLM overstates experience | Core trust violation | Existing deterministic guardrails unchanged; extend the same contract to email generation (FR7) |
| Scope creep from merging three finished projects | Nothing ships | Phases 1–5 are the product. Phases 6–7 are polish. Non-goals in §7 are firm |
| Per-user Gmail OAuth complexity | Blocked outreach | Draft mode default; SMTP app-password path retained as fallback; preflight before any live send |

---

## 18. Demo Flow

The final demo uses **one real role search and one real job listing**, end to end:

1. Sign in. Master resume already uploaded.
2. Search `"AI Engineer"` / `"Bengaluru"` → 20 deduplicated jobs from Naukri + RemoteOK.
3. The board renders ranked by match score, top job at 78.
4. Open it — full JD, extracted requirements, gap analysis, all hydrated automatically.
5. Tailor → side-by-side bullet rewrites, each with a reason and confidence, tailored score 89.
6. Export the proof PDF.
7. Add a recipient (`careers@`, source recorded).
8. Generate the email — the hook cites a skill the scoring engine actually matched.
9. Preview, pick subject 2, create a Gmail draft.
10. Tracker shows: job → 78 → 89 → resume v3 → drafted → timestamped audit row.

**The point the demo must land:** step 8's personalization is only possible because step 5 ran. That is the argument for merging.

---

## 19. Definition of Done

The platform is done when a real job seeker can run their entire search inside it — discovery through outreach through tracking — without opening a terminal, without copy-pasting between tools, and without the system ever fabricating a claim on their behalf or emailing anyone they did not knowingly choose to contact.

Concretely, the deliverable is:

- A monorepo where all three original projects live on as libraries, not rewrites.
- A shared schema that gives the three stages one vocabulary.
- Persistent, resumable state across the full funnel.
- Every safety guardrail from all three projects preserved and enforced server-side.
- An exportable evidence bundle proving a complete run.

---

## 20. One-Line Product Description

> **JobPilot** turns a job search into one pipeline — harvesting real listings, scoring and truthfully tailoring your resume against each, then sending human-reviewed outreach personalized with the evidence the tailoring engine actually found.
