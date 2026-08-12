> **PRE-MERGE DOCUMENT.** This describes Resume Shapeshifter as a standalone
> app. Parts are now out of date — notably persistence, which moved from
> `sessionStorage` to Postgres in JobPilot's Phase 1. The platform docs in
> the repo root `docs/` are authoritative. Kept for history; P7.5.1 reconciles.

# Resume Shapeshifter

JD-to-resume tailoring engine: explainable match scoring, honest gap analysis,
truthful side-by-side bullet rewrites, and (later) PDF proof artifacts.

Built from [docs/architecture.md](docs/architecture.md) and
[docs/implementation-plan.md](docs/implementation-plan.md).

## Status

**All 5 phases complete — verified live end-to-end with Groq.**

`paste/upload resume + JD → Analyze (Groq) → score + gaps → Generate tailored → guardrails → side-by-side review → verify → export PDFs`

- **Phase 0/1** — Next.js app, Zod domain model, full UI shell.
- **Phase 2** — real Groq LLM pipeline (parse, score, gap, tailor) behind `/api/*`.
- **Phase 3** — Playwright PDF export: clean tailored resume + side-by-side comparison proof.
- **Phase 4** — deterministic guardrails ([lib/guardrails.ts](lib/guardrails.ts)) catch fabricated
  employers, invented metrics, unsupported tech, and credential claims — downgrading
  confidence, adding risk flags, and requiring a verification checkbox before export.
- **Phase 5** — PDF/DOCX/TXT resume upload ([lib/document-extract.ts](lib/document-extract.ts)),
  rate limiting, error boundary, a11y, and [demo](docs/demo-script.md) + [deploy](docs/deploy.md) docs.

See the [implementation plan](docs/implementation-plan.md) for phase details.

## Prerequisites

- Node.js 20+
- npm 9+
- Chromium for PDF export: `npm run pdf:install` (one-time, ~170 MB)

## Setup

```bash
npm install
cp .env.example .env   # only needed from Phase 2 onward (Groq key)
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the dev server at http://localhost:3000 |
| `npm run build` | Production build |
| `npm start` | Run the production server |
| `npm run lint` | ESLint |
| `npm test` | Vitest (schema/unit tests) |

## Architecture (Phase 1)

- **`lib/schemas.ts`** — Zod schemas + inferred types for the whole domain model
  (`ResumeProfile`, `JobDescriptionProfile`, `MatchScore`, `TailoredResume`,
  `GapAnalysis`, `TailoringRun`). Single source of truth for client and server.
- **`lib/mock-orchestrator.ts`** — fixture-backed analyze/tailor used by the API
  stubs. Replaced by the real Groq orchestrator in Phase 2 behind the same
  request/response contract.
- **`app/api/analyze` + `app/api/tailor`** — stub routes validating input and
  returning mock results, so Phase 2 is a drop-in swap.
- **`hooks/useTailoringRun.ts`** — owns the `TailoringRun`, calls the API routes
  via TanStack Query, and persists to `sessionStorage` (survives refresh).
- **`components/`** — presentational UI (input, score card, gap list, side-by-side
  diff, bullet change cards) plus the `TailorFlow` stepper.

## Environment variables

| Var | Purpose |
|-----|---------|
| `GROQ_API_KEY` | Groq API key (Phase 2+) |
| `GROQ_BASE_URL` | OpenAI-compatible base URL (default Groq) |
| `LLM_MODEL` | Model id (default `llama-3.3-70b-versatile`) |
| `MAX_UPLOAD_MB` | Resume upload limit (Phase 5) |
