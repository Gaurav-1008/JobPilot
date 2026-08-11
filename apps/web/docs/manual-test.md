# Manual Test — Phase 2 (Live Groq)

End-to-end check that the real LLM pipeline works against a live Groq key.

## Prerequisites

1. A Groq API key from https://console.groq.com
2. `.env` configured:
   ```
   GROQ_API_KEY=gsk_...
   GROQ_BASE_URL=https://api.groq.com/openai/v1
   LLM_MODEL=llama-3.3-70b-versatile
   ```

## Automated (no key required)

```bash
npm test          # schema + scoring unit tests + orchestrator (mocked LLM)
npm run lint
npm run build
```

## Live pipeline (key required)

Start the dev server: `npm run dev`, then:

### 1. Analyze via API

```bash
curl -s -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"resumeText":"<paste resume text>","jdText":"<paste JD text>"}' | jq
```

Expect: `runId`, extracted `jobDescription`, `originalMatch` with sub-scores +
`explanation`, and `gapAnalysis.gaps`. Note the `runId`.

### 2. Tailor via API

```bash
curl -s -X POST http://localhost:3000/api/tailor \
  -H "Content-Type: application/json" \
  -d '{"runId":"<runId from step 1>"}' | jq
```

Expect: `tailoredResume` with one `TailoredBullet` per original bullet
(`original`, `tailored`, `changeReason`, `keywordsAddressed`, `confidence`),
`tailoredMatch`, and `warnings`.

### 3. Fetch the persisted run

```bash
curl -s http://localhost:3000/api/runs/<runId> | jq '.status'   # "tailored"
```

### 4. UI walkthrough

Open http://localhost:3000/tailor → **Load example** → **Analyze** → review
score + gaps → **Generate tailored resume** → side-by-side diff with metadata.

## Acceptance criteria (plan §Phase 2)

- [ ] Analyze returns extracted JD requirements, original score + explanation, gaps
- [ ] Tailor returns rewritten bullets with `changeReason`, `keywordsAddressed`, `confidence`
- [ ] Tailored score ≥ original on the demo pair (not guaranteed for all inputs)
- [ ] Invalid LLM JSON triggers one retry; second failure returns a clear error
- [ ] `GET /api/runs/:id` returns the full run
- [ ] No `GROQ_API_KEY` exposed to the client (server-only)

## Error handling checks

| Scenario | Expectation |
|----------|-------------|
| No `GROQ_API_KEY` | `503 LLM_CONFIG_ERROR` with a clear message |
| Bad key | `502 LLM_AUTH_FAILED` |
| Rate limited | retried with backoff, then `429 LLM_RATE_LIMIT` |
| Unknown `runId` on tailor | `404 RUN_NOT_FOUND` |
