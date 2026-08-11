# Deployment

## Environment variables (production checklist)

| Var | Required | Notes |
|-----|----------|-------|
| `GROQ_API_KEY` | ✅ | Server-only. Never expose to the client. |
| `GROQ_BASE_URL` | – | Defaults to `https://api.groq.com/openai/v1`. |
| `LLM_MODEL` | – | Defaults to `llama-3.3-70b-versatile`. |
| `LLM_TIMEOUT_MS` | – | Per-call timeout (default 45000). |
| `MAX_UPLOAD_MB` | – | Resume upload limit (default 5). |

- [ ] `GROQ_API_KEY` set as an encrypted secret (not committed, not `NEXT_PUBLIC_`)
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] PDF export target decided (see below)

## The PDF / Chromium constraint

PDF export uses **Playwright + headless Chromium**, which does **not** fit in a
standard Vercel serverless function (no system Chromium, 50 MB bundle cap).
Options:

1. **Node host (recommended)** — Deploy to Railway / Render / Fly / a VM where
   `npm run pdf:install` provides Chromium. Everything works as-is.
2. **Vercel + serverless Chromium** — Swap `lib/pdf/renderer.ts` to launch
   `playwright-core` with `@sparticuz/chromium`:
   ```ts
   import chromium from "@sparticuz/chromium";
   import { chromium as pw } from "playwright-core";
   const browser = await pw.launch({
     executablePath: await chromium.executablePath(),
     args: chromium.args,
   });
   ```
   Keep the `htmlToPdf(html)` signature identical — only the launch changes.
3. **Separate PDF microservice** — Run the renderer as a small dedicated service
   and call it from `/api/export/pdf`.

The rest of the app (analyze, tailor, guardrails) runs fine on Vercel serverless
with `runtime = "nodejs"` and the `maxDuration` already set on each route.

## Persistence caveat

`lib/run-store.ts` and `lib/rate-limit.ts` are **in-memory per process**. On
serverless they reset between invocations, so a run created by `/api/analyze` may
not be found by a later `/api/tailor` call on a cold instance. For production,
back both with a shared store (SQLite for a single node; Redis/Upstash or
Postgres/Supabase for multi-instance). See architecture §11.2.

## Deploy steps (Node host)

```bash
npm ci
npm run build
npm run pdf:install        # Chromium for PDF export
npm start                  # serves the production build
```
