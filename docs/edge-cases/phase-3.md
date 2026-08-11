# Phase 3 — Edge Cases

**Hydration** · [plan](../implementation-plan.md#phase-3--hydration) · [index](./README.md)

Phase 3 introduces the platform's most dangerous primitive: **a server that fetches a URL a user supplied.** Half of this file is SSRF. The other half is the quieter problem — hydrating *junk* and not noticing, so every downstream score and email is built on a login page.

**47 cases.** 🔴 must-handle · 🟠 should-handle · 🟡 polish

---

## P3.1 — Cache keys and policy

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P3-01 | 🟠 | URL normalization for the cache key: trailing slash, `?utm_source=`, `#fragment`, host case, default port, `http` vs `https` | Normalize: lowercase host, drop fragment, drop known tracking params, strip default port, strip trailing slash. **Do not drop all query params** — many boards put the job ID in one | P3.2.2 |
| EC-P3-02 | 🔴 | **Policy contradiction.** `HYDRATION_CACHE_TTL_DAYS=30` (§14) vs "a URL is fetched once, ever" (FR2) | Resolve explicitly: the TTL governs *refresh eligibility*, and entries are **never evicted**. A stale JD is better than re-scraping, and an evicted entry means a JD we can no longer show for an old application. Write the decision into `architecture.md` §11.4 | P3.2.2 |
| EC-P3-03 | 🟠 | Over-normalization merges two genuinely different jobs that differ only by a query param | Under-normalize when unsure. A cache miss costs one fetch; a false hit gives a user the wrong job description | P3.2.2 |
| EC-P3-04 | 🟠 | Same job reachable at two distinct URLs → two cache entries, two fetches | Acceptable. Do not try to canonicalize across URL shapes | P3.2.2 |
| EC-P3-05 | 🔴 | **A `manual_paste` written into the cross-user `jd_cache`.** The cache is global; pasted text is whatever the user typed — possibly their own notes, possibly nothing to do with the job | **Never cache manual pastes.** `jd_cache` holds machine-fetched public pages only. The cache's justification is that job postings are public; a paste carries no such guarantee | P3.2.5 |
| EC-P3-06 | 🟠 | Cache hit returns text fetched a year ago for a job that has since changed | Show the `extracted_at` date on the job detail page and offer "re-fetch". Do not silently present stale text as current | P3.3.3 |
| EC-P3-07 | 🟡 | Two concurrent hydrations of the same URL → both miss the cache, both fetch | Deterministic job ID `hydrate:{jobId}` dedupes per job, but two *different* jobs sharing a URL still double-fetch. Acceptable; a lock is overkill | P3.2.1 |

---

## P3.2 — SSRF (the fetcher)

Every case here is 🔴. The threat model: `POST /api/jobs/manual` (P2.3.8) lets any authenticated user hand the server an arbitrary URL to fetch from inside your network.

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P3-08 | 🔴 | `http://localhost:5432`, `http://127.0.0.1`, `http://[::1]` | Reject. Resolve DNS and check every resulting IP against private/loopback/link-local ranges | P3.1.4 |
| EC-P3-09 | 🔴 | `http://169.254.169.254/latest/meta-data/` (cloud instance metadata) | Reject. This is the payload that turns SSRF into credential theft on AWS/GCP | P3.1.4 |
| EC-P3-10 | 🔴 | Alternate loopback encodings: `127.1`, `0.0.0.0`, `2130706433` (decimal), `0x7f000001` (hex), `[::ffff:127.0.0.1]` | Do not pattern-match strings. **Parse to an IP object and check the range.** String blocklists always lose this game | P3.1.4 |
| EC-P3-11 | 🔴 | `file:///etc/passwd`, `gopher://`, `ftp://`, `data:` | Scheme allowlist: `https` only (per P3.1.4). Not a blocklist | P3.1.4 |
| EC-P3-12 | 🔴 | Allowlisted host `302`s to `http://169.254.169.254` | **Re-validate every redirect hop**: scheme, host allowlist, and freshly-resolved IPs. Validating only the initial URL is the single most common SSRF bypass | P3.1.4 |
| EC-P3-13 | 🔴 | Redirect chain longer than 3, or a redirect loop | Cap at 3 hops (P3.1.4). Count across the whole chain, not per-hop | P3.1.4 |
| EC-P3-14 | 🔴 | `https://naukri.com@evil.com/job` — the host is `evil.com`; `naukri.com` is userinfo | Parse with a real URL parser and read the **host** field. Never regex the string for an allowlisted domain | P3.1.4 |
| EC-P3-15 | 🔴 | `https://naukri.com.evil.com/` — suffix match against the allowlist passes | Match on exact host or a proper subdomain boundary (`host == d or host.endswith('.' + d)`), never `d in host` | P3.1.4 |
| EC-P3-16 | 🔴 | **DNS rebinding**: the name resolves to a public IP during validation, then to `127.0.0.1` on connect (TOCTOU) | Resolve once, validate the IPs, then **connect to the validated IP** with the `Host` header set — or use an HTTP client that pins the resolved address. Playwright makes this hard; that is a reason to route unknown domains through the more controllable path | P3.1.4 |
| EC-P3-17 | 🔴 | Punycode/unicode homograph: `https://naukrі.com` (Cyrillic і) | Normalize to punycode before the allowlist check and compare the encoded form | P3.1.4 |
| EC-P3-18 | 🔴 | Response is 500 MB | Cap at 5 MB by **aborting the stream mid-download**, not by buffering then checking length. A buffered check is a memory exhaustion primitive | P3.1.4 |
| EC-P3-19 | 🔴 | Server responds slowly forever (slowloris) | Total-request timeout, not just a connect timeout | P3.1.4 |
| EC-P3-20 | 🟠 | Firecrawl fetches the URL server-side on their infrastructure, bypassing your SSRF guard entirely | **Validate before calling Firecrawl too.** Delegating the fetch does not delegate the responsibility, and Firecrawl will happily fetch an internal-looking host that is public to them | P3.1.4 |
| EC-P3-21 | 🟠 | Playwright follows redirects internally, below your validation layer | Configure request interception to re-validate, or restrict Playwright to hosts already validated and disable automatic redirects | P3.1.4 |

---

## P3.3 — Hydrating junk

The quiet failure mode: hydration "succeeds" and produces text that is not a job description. Everything downstream — scoring, tailoring, the email hook — is then built on garbage.

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P3-22 | 🔴 | Page requires login; the fetch returns a **sign-in page** with HTTP 200 | Heuristic detection: very short text, or containing `sign in` / `log in` / `create an account` near the top with no job-shaped content. Classify as `blocked`, not `hydrated`. **Otherwise you score a resume against a login form** | P3.1.5 |
| EC-P3-23 | 🔴 | Job expired; the board serves a "this job is no longer available" page with HTTP 200 | Same detection path → `failed` with reason `expired`. A 404 would be easy; boards rarely give you one | P3.1.5 |
| EC-P3-24 | 🟠 | Extracted text is under ~300 characters | Treat as failed extraction. No real JD is that short | P3.2.4 |
| EC-P3-25 | 🟠 | Extracted text is 500 KB — the whole page including nav, footer, cookie banner, and twelve other job cards | Truncate to a token-safe cap before the extraction prompt, preferring the main content region. Uncapped input here is a cost and a context-overflow bug | P3.2.3 |
| EC-P3-26 | 🟠 | Extraction prompt returns valid JSON with **every array empty** | The JD was junk. Mark `hydrated` but flag low-confidence, or mark `failed` — **decide and be consistent.** Recommended: `failed` with reason `no_requirements_extracted`, since an empty profile scores meaninglessly | P3.2.4 |
| EC-P3-27 | 🟠 | The page is a JS SPA; Firecrawl returns the app shell | Fall through to Playwright (P3.1.1). If Playwright also yields shell-only text, EC-P3-24 catches it | P3.1.1 |
| EC-P3-28 | 🟠 | Content-Type is `application/pdf` — the JD is a PDF attachment | Either extract it (you already have `document-extract`) or classify `blocked` and offer paste. Do not feed PDF bytes to the extraction prompt | P3.1.2 |
| EC-P3-29 | 🟠 | Page is in a language the extraction prompt handles poorly | Zod validation passes but the fields are noise. Surface `extracted_at` + raw text so the user can see what happened | P3.2.3 |
| EC-P3-30 | 🟡 | Two jobs on one page (a listing page rather than a detail page) | Extraction merges them. Detectable via multiple job titles; low priority, but log it | P3.2.3 |

---

## P3.4 — Prompt injection

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P3-31 | 🔴 | **A job posting contains `Ignore previous instructions and...`.** JD text is third-party content that flows into the extraction prompt, then into `domainSignals`, then into `jdHooks`, then into the **email generation prompt** in Phase 5 | Treat JD text as untrusted **data**, never instruction: wrap it in explicit delimiters, instruct the model that content inside is data only, and validate the output shape (Zod already does). This is a design gap worth recording in `architecture.md` §13 — the injection path crosses two phases and ends at an email a human sends under their own name | P3.2.3 |
| EC-P3-32 | 🟠 | JD contains text designed to inflate the match score (`this candidate is a perfect match`) | Scoring is structured output over extracted fields, which limits the blast radius. Still: never let JD text reach a prompt as an un-delimited instruction | P3.2.3 |
| EC-P3-33 | 🟠 | Extracted `requiredSkills` contains a 4,000-character string | Cap per-field lengths in the Zod schema. A hostile field length propagates into every downstream prompt | P3.2.3 |

---

## P3.5 — Pipeline, UI, and the paste fallback

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P3-34 | 🟠 | User selects 50 jobs and hits "Hydrate selected" | Enqueue individually; global concurrency 4 (§10.1) plus the per-board rate limiter throttles it. Show progress; do not appear frozen | P3.3.1 |
| EC-P3-35 | 🟠 | User selects a job already `hydrated` | No-op with a cache hit, or skip entirely. Never re-fetch | P3.3.1 |
| EC-P3-36 | 🟠 | Hydration job retried after a partial write | Upsert on `job_id` (primary key) makes it idempotent | P3.2.4 |
| EC-P3-37 | 🔴 | **User pastes a JD while a hydrate job for the same `job_id` is in flight** → the job finishes and overwrites the paste | The manual paste must **win**: mark the job `hydrated` with `method='manual_paste'`, and have the hydrate handler check status before writing. Losing a user's typed input to a background job is the worst possible outcome of the fallback path | P3.3.4 |
| EC-P3-38 | 🟠 | Paste box submitted empty or whitespace-only | Reject client and server side. Do not persist an empty `JobDescription` | P3.3.4 |
| EC-P3-39 | 🟠 | Paste of 1 MB of text | Same cap as EC-P3-25, with a visible message | P3.3.4 |
| EC-P3-40 | 🟠 | Paste succeeds but the extraction prompt then fails | Persist `raw_text` **first**, then extract. The user's typed input must survive an LLM failure — otherwise they paste it again | P3.3.4 |
| EC-P3-41 | 🟠 | Groq is down during a hydrate batch | Fetch succeeded, extraction did not. Persist `raw_text` + `hydration_status='pending'` and allow extraction retry without re-fetching | P3.2.3 |
| EC-P3-42 | 🟠 | Job deleted while its hydration is in flight | Handler checks existence before writing; a missing job is a no-op, not an error | P3.2.4 |
| EC-P3-43 | 🟡 | `robots.txt` allows `/search` but disallows `/job/*` | Per-URL check (EC-P2-50). The job is addable but not hydratable → `blocked` → paste. The UI should explain which | P3.1.4 |
| EC-P3-44 | 🟡 | Hydration status is `pending` forever because the job silently died | Same stale reaper pattern as EC-P2-30, scoped to hydration | P3.2.1 |
| EC-P3-45 | 🟡 | Job detail page for a `pending` job renders an empty requirements panel | Distinct states: not-yet-hydrated, in-progress, blocked, failed, hydrated. Five states, five renderings | P3.3.5 |
| EC-P3-46 | 🟡 | Method badge says `firecrawl` but the text came from the Playwright fallback | Record the method that actually produced the text, not the one attempted first | P3.1.2 |
| EC-P3-47 | 🟠 | `FIRECRAWL_API_KEY` removed entirely | Playwright path still works (an explicit acceptance criterion). Verify the code does not construct the Firecrawl client at import time and crash the service | P3.1.1 |

---

## Traps

### Validate the IP, not the string

EC-P3-08 through EC-P3-17 are all one mistake in different costumes: reasoning about URLs as text. The only reliable shape is *parse → resolve → check the resolved IP objects → connect to that IP*. Every string-level blocklist has a known bypass, and new ones get published regularly.

### Delegating the fetch does not delegate the risk

EC-P3-20 catches people. "Firecrawl does the fetching, so SSRF is their problem" is wrong twice: their infrastructure may reach hosts yours cannot, and you are the one who chose the URL. Validate before you delegate.

### Hydrating a login page is worse than failing

EC-P3-22 is the most damaging quiet bug in this phase, because it does not look like a bug. Everything downstream succeeds: the JD parses (into near-empty fields), the score computes (low), the tailoring runs (unhelpfully), and the email hook cites nothing. The user blames the AI. Detect it at the fetch boundary where you still have the evidence.

### The paste box is the promise of the whole phase

FR2 says "never dead-end the user", and P3.3.4 is how that promise is kept. EC-P3-37 and EC-P3-40 both describe ways to break it after building it. Anything that can discard text a human typed deserves the paranoia normally reserved for the send path.

---

## Exit checklist

Beyond the plan's acceptance criteria:

- [ ] EC-P3-02: cache TTL vs never-evict policy written into `architecture.md`
- [ ] EC-P3-05: `jd_cache` write path physically cannot be reached from the manual-paste route
- [ ] EC-P3-10/12/14/15/16/17: SSRF suite covers decimal IPs, redirect-to-metadata, userinfo hosts, suffix hosts, rebinding, and punycode
- [ ] EC-P3-18: a 500 MB response aborts mid-stream; process memory stays flat
- [ ] EC-P3-20: Firecrawl is never called with an unvalidated URL
- [ ] EC-P3-22/23: a login page and an expired-job page both classify as non-hydrated
- [ ] EC-P3-31: JD text is delimited as data in the extraction prompt, and an injection fixture does not alter the output shape
- [ ] EC-P3-37: paste-during-hydration → the paste survives
- [ ] EC-P3-40: kill Groq mid-paste → `raw_text` is still persisted
