# Demo Script — Resume Shapeshifter

A ~2-minute narrated walkthrough for a portfolio video or live demo.

## Setup (before recording)

```bash
npm install
npm run pdf:install                 # one-time Chromium for PDF export
cp .env.example .env                # set GROQ_API_KEY
npm run dev                         # http://localhost:3000
```

## Script

**1. Landing (10s)**
> "Resume Shapeshifter tailors your resume to a specific job — truthfully. No
> invented employers, degrees, or metrics." Click **Start tailoring**.

**2. Input (20s)**
- Click **Load example** (or **Upload PDF/DOCX** to show ingestion of a real file).
> "I'll paste a backend engineer's resume and a senior platform role that asks for
> Go and Kubernetes — skills this candidate doesn't have."
- Click **Analyze**.

**3. Analysis (25s)**
> "It extracts the job's requirements, scores the original resume — 61 — and
> explains why. The gap analysis is honest: Go, Kubernetes, and gRPC are missing,
> and it tells me *not* to fabricate them."
- Click **Generate tailored resume**.

**4. Review (40s)**
> "Now the score jumps to 78 — not by lying, but by reframing real experience
> around reliability, microservices, and distributed systems."
- Scroll the side-by-side diff.
> "Every bullet shows the original, the rewrite, why it changed, and a confidence
> level. Where the model stretched — like inferring SLOs — the guardrails flagged
> it, lowered the confidence, and added a risk note."
- Point out a yellow-highlighted change and a risk-flagged bullet.

**5. Export (20s)**
> "Before I can export, I have to confirm I've verified the content is truthful."
- Check the box → click **Both**.
> "I get a clean, ATS-friendly resume and a side-by-side comparison PDF — the
> proof artifact showing the before/after with scores, highlights, and gaps."
- Open the comparison PDF.

**6. Close (5s)**
> "Truthful tailoring, explainable scoring, and a shareable proof — end to end."

## Fallback (no Groq key)

Run `npm test` to show the pipeline working against mocked LLM + real PDF
rendering, or open a pre-generated comparison PDF.
