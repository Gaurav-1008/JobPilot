# Manual Test — Phase 3 (PDF Export)

## Prerequisites

```bash
npm run pdf:install   # installs Chromium for Playwright (one-time)
```

PDF export does **not** require a Groq key — but you need a tailored run in the
in-memory store, which is produced by analyze+tailor (Phase 2, needs the key).
For a key-free check of the PDF pipeline itself, the unit tests render real
Chromium PDFs from the mock fixture (see below).

## Automated

```bash
npm test    # includes pdf-build-context tests (HTML structure, <mark>, guards)
```

## Live export via API (after analyze + tailor)

```bash
# 1. analyze  -> note runId
# 2. tailor   -> run is now tailored
# 3. export:
curl -s -X POST http://localhost:3000/api/export/pdf \
  -H "Content-Type: application/json" \
  -d '{"runId":"<runId>","types":["tailored","comparison"]}' \
  | jq '.files[] | {type, filename, bytes: (.base64 | length)}'
```

Expect two entries; each `base64` decodes to a `%PDF-` document.

## UI walkthrough

`/tailor` → Analyze → Generate tailored resume → **Export** section →
**Tailored resume PDF** / **Comparison PDF** / **Both** → files download.

## Acceptance criteria (plan §Phase 3)

- [ ] Tailored resume PDF is readable and properly sectioned (single column, ATS-friendly)
- [ ] Comparison PDF has: job title/company, original vs tailored scores, JD summary,
      side-by-side bullets with highlighted changes, gap summary, disclaimer
- [ ] Export reflects the latest run from the server store
- [ ] Export fails gracefully (e.g. Chromium missing → clear `PDF_RENDER_FAILED`)

## Error handling

| Scenario | Expectation |
|----------|-------------|
| Missing/invalid `runId` | `400 VALIDATION_ERROR` |
| Unknown `runId` | `404 RUN_NOT_FOUND` |
| Run not tailored yet | `409 PDF_NOT_TAILORED` |
| Chromium not installed | `500 PDF_RENDER_FAILED` with install hint |
