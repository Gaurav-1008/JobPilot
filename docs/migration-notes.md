# Migration notes

**P7.5.1 ·** per-repo change log, final state. Companion to
[`architecture.md`](./architecture.md) §21, which is the *plan*; this is what
actually happened.

The claim under test is [`problemStatement.md`](./problemStatement.md)'s: that
the merge is **connective tissue, not a rewrite**. §21 predicted 17 files
unchanged, 12 adapted, 5 new, 9 retired. This records where the prediction held
and where it did not — the divergences are the useful part, and there are four.

---

## The three sources

| Repo | Was | Became |
|------|-----|--------|
| `job-harvester` | Python CLI → `jobs.csv` | ④'s board adapters, driven by ③ |
| `Resume-Builder` | Next.js app, browser-local state | ① in full, plus the Tier-0 scorer |
| `cold-email-sender` ("The Closer") | Python CLI + Streamlit, `.env` credentials | ④'s generation and delivery, gated by ①'s interlocks |

Imported with `git subtree` (commits `4aa0bcd`, `07c89f0`, `af0f950`), so each
project's history survives in this repo rather than arriving as a single
squashed blob.

---

## 1 · job-harvester

**Prediction held.** The adapters are genuinely untouched, which was the whole
bet: board scraping is the part most likely to need per-site knowledge, and
rewriting it would have thrown that away for nothing.

| File | Predicted | Actual |
|------|-----------|--------|
| `boards/base.py`, `naukri.py`, `remoteok.py`, `wellfound.py` | 🟢 unchanged | 🟢 unchanged. Called by `routers/boards.py` |
| `harvester.py` | 🟡 split | 🟡 as predicted — CLI discarded, orchestration to ③, per-board invocation to ④ |
| dedupe | 🟡 → `lib/dedupe.ts` | 🟡 and **strengthened**: see below |
| `writers.py` | ⚫ retired | ⚫ retired |
| `jobs.csv` | ⚫ retired as storage | ⚫ retired; survives as an import fixture |

### Divergence 1 — dedupe needed a second key

`dedupeKey` is `company|title|location`, deliberately tuned toward
under-merging (EC-P2-17: showing a duplicate is safer than hiding a real job).
Live data broke the assumption behind that. One Wellfound harvest returned nine
duplicated links, including **the same posting under two different companies** —
Firecrawl had misaligned the company to the row, so the keys differed and both
rows survived. One of them was simply wrong about who was hiring.

A URL match now short-circuits the key comparison, and a placeholder company
("N/A", "Not specified") is healed when a later pass finds a real one. This is
an *additional* guard, not a replacement key: `dedupe_key` is stored on every
existing row under a unique constraint, so changing how it is computed would
make every prior job look new on the next harvest and duplicate the whole table.

---

## 2 · Resume-Builder

**Prediction mostly held.** This was the largest source and the one that
survived most intact — it became ① more or less directly.

| File | Predicted | Actual |
|------|-----------|--------|
| `lib/guardrails.ts` | 🟢 unchanged | 🟢 unchanged |
| `lib/pdf/*` | 🟢 unchanged | 🟢 unchanged, still free of Next.js imports |
| `lib/document-extract.ts` | 🟢 unchanged | 🟢 unchanged |
| `lib/schemas.ts` | 🟡 extended | 🟡 extended; existing types untouched |
| `lib/heuristic-resume.ts` | 🟡 → Tier-0 scorer | 🟡 as predicted |
| `lib/orchestrator.ts` | 🟡 DB-backed | 🟡 as predicted |
| `lib/run-client-store.ts` | ⚫ retired | ⚫ retired |
| `components/*`, `TailorFlow.tsx` | 🟢 reused | 🟢 reused at `/tailor/[jobId]` |
| `hooks/useTailoringRun.ts` | 🟡 store swap only | 🟡 confirmed — the anti-corruption layer paid off exactly as designed |
| `lib/llm/*` | 🟢 unchanged + Anthropic adapter | 🟢 unchanged, **no adapter** — see below |

### Divergence 2 — the second LLM provider never happened

§21 predicted "🟢 unchanged (+ Anthropic adapter alongside)". Commit `f44fd79`
consolidated on Groq before that work started, so the adapter was never
written.

The interesting part is what this cost in *documentation* rather than in code.
§12.2 recorded the decision and even noted that it collapses two provider-outage
rows in §18 into one — but §18, the §3 context diagram, and §21 itself kept
describing Anthropic for two more phases. Working code and three documents
disagreed, and nothing caught it until P7.2.5 fault-injected the failure matrix
and found a row describing a dependency that has never been called. Corrected in
`212e395`.

**The lesson worth keeping:** a decision recorded in one section does not
propagate itself. The reason this survived so long is that nothing *executes* a
context diagram.

---

## 3 · cold-email-sender (The Closer)

**Prediction held, including the hard part.** §21 marked `recipient_filter.py`
🔴 — the one file that had to move languages, because the single-writer rule
(P7) requires suppression and dedup to be evaluated where the database is.

| File | Predicted | Actual |
|------|-----------|--------|
| `email_generator.py` | 🟢 unchanged | 🟢 unchanged |
| `smtp_check.py` | 🟢 unchanged | 🟢 unchanged |
| `llm_generator.py` | 🟡 accepts payload | 🟡 as predicted; validator untouched |
| `email_sender.py`, `gmail_sender.py` | 🟡 per-request credentials | 🟡 as predicted |
| `followup_generator.py` | 🟡 data in/out | 🟡 as predicted |
| `models.py` | 🟡 → generated Pydantic | 🟡 as predicted |
| `recipient_filter.py` | 🔴 → `lib/outreach/interlocks.ts` | 🔴 **and grew** — see below |
| `main.py`, `preview.py`, `input_loader.py`, `logger.py` | ⚫ retired | ⚫ retired |
| `ui/app.py` | ⚫ retired | ⚫ retired |
| `outreach_log.csv` | ⚫ retired as storage | ⚫ retired; one-time importer at `/api/import/legacy` |

### Divergence 3 — the filter became a twelve-check chain

`recipient_filter.py` was suppression plus dedup. `interlocks.ts` is twelve
checks in a deliberate order, failing closed, with the ordering itself load-
bearing: dry-run resolves at **check 10** specifically so a dry run exercises
checks 1–9 and stays a real test of the pipeline (EC-P5-58).

That is more than a port, and it is the single largest piece of genuinely new
code in the merge. It exists because a CLI's `input("send? y/N")` is a promise
the program makes to itself, while a web app has to survive a hand-crafted
`curl`. The approval token bound to a hash of the exact body is the structural
version of what the terminal prompt was gesturing at.

Phase 7 added one thing to it: the **platform-level** dry-run override, which
reads the environment and cannot see the user row at all (EC-P7-23).

### Divergence 4 — ④ had never once run its LLM path

Discovered in Phase 5 (`822ea10`), and worth recording because of *how* it hid.

`npm run py:worker` launches uvicorn directly, and `main.py` never loaded a
`.env`. So `os.getenv("GROQ_API_KEY")` was always empty, and
`routers/outreach_email.py` computes `use_llm = body.use_llm and
bool(config.groq_api_key)` — meaning every request fell to the deterministic
template and honestly reported `source: "template"`.

Nothing looked broken, because **template fallback is correct behaviour on a
missing key**. A degradation path that works perfectly is indistinguishable from
the primary path never executing. The fix was one `load_dotenv` call; the
finding was that a fallback nobody can tell they are using is a fallback nobody
will notice is permanent.

---

## Final scorecard

| | Predicted (§21) | Actual |
|---|---|---|
| Unchanged | 17 | **17** |
| Adapted | 12 | **12** |
| Genuinely new | 5 | **6** — the interlock chain outgrew "adapted" |
| Retired | 9 | **9** |

**P6 holds.** The merge is connective tissue. The one place it is not — the
interlock chain — is the place where moving from a CLI to a multi-tenant web app
genuinely changes the threat model, and rewriting it was the point rather than a
cost.

---

## What Phase 7 added that was in no source project

None of this existed in any of the three repos, because none of them was a
service anyone else ran:

- **Allow-list log redaction at the serializer** (`lib/obs/redact.ts`). All
  three sources printed freely to stdout; one of them printed email bodies.
- **Bounded-cardinality metrics** (`lib/obs/metrics.ts`).
- **Trace propagation** across the ①→④ boundary — a seam that did not exist
  when each project was one process.
- **Account deletion across two stores** (`lib/db/stores/account-deletion.ts`).
  A CLI has no account to delete.
- **Startup config validation** (`lib/config/require-env.ts`). A CLI fails at
  the prompt; a service has to fail before it takes traffic.
- **The key-rotation runbook** ([`runbooks/encryption-key-rotation.md`](./runbooks/encryption-key-rotation.md)).
  The Closer kept credentials in `.env` and `token.json`, where rotation means
  editing a file.
