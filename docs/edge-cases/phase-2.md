# Phase 2 — Edge Cases

**Harvest in the browser** · [plan](../implementation-plan.md#phase-2--harvest-in-the-browser) · [index](./README.md)

Phase 2 puts three hostile, unversioned, third-party HTML sources behind a queue behind a web form. The governing rule from [`implementation-plan.md`](../implementation-plan.md) P2.2.10 — **board failure is data, not an exception** — resolves about a third of the cases below. Most of the rest are dedupe and idempotency.

**52 cases.** 🔴 must-handle · 🟠 should-handle · 🟡 polish

---

## P2.1 — Board responses (④)

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P2-01 | 🔴 | Board returns HTTP 200 with **zero results** (a genuinely empty search) | Status `ok`, count 0. **Not `failed`.** Conflating "no jobs match" with "the scraper broke" makes every empty search look like an outage | P2.1.2 |
| EC-P2-02 | 🟠 | Board returns 12 of a requested 20 | Status `partial`, with the count. Persist all 12 | P2.1.2 |
| EC-P2-03 | 🟠 | Board throws midway through pagination after yielding 8 rows | Return the 8 with `partial: true` and the error reason. Do not discard successfully-scraped rows because page 3 failed | P2.1.3 |
| EC-P2-04 | 🟠 | A single row is malformed — missing `link` or `title` | Skip that row with a logged warning; the board still succeeds. One bad card must not fail 19 good ones | P2.1.2 |
| EC-P2-05 | 🟠 | Board returns 200 with an HTML error page or a bot-wall (not JSON, not job cards) | Adapter yields zero rows; classify as `failed` with reason `unparseable`, distinct from EC-P2-01's legitimate zero | P2.1.2 |
| EC-P2-06 | 🔴 | Board changes its DOM — selectors match nothing, adapter returns `[]` | **Indistinguishable from EC-P2-01 without help.** Log the response size and a selector-hit count; alert when a board returns zero on a broad query that previously returned results. This is the silent failure of any scraper | P2.1.5 |
| EC-P2-07 | 🟠 | RemoteOK's JSON API changes a field name | Pydantic validation fails loudly at the adapter boundary rather than persisting nulls | P2.1.2 |
| EC-P2-08 | 🟠 | RemoteOK's first array element is a legal/metadata object, not a job (a documented quirk of that feed) | Adapter already handles it 🟢 — do not "clean up" this logic during the move | P2.1.4 |
| EC-P2-09 | 🟠 | Wellfound with no `FIRECRAWL_API_KEY` | Board status `failed`, reason `missing_credential`. The run continues on other boards; the UI says which key is missing | P2.1.2 |
| EC-P2-10 | 🟠 | Firecrawl quota exhausted mid-run | `failed` + `quota_exceeded`. Do not retry into the quota wall | P2.1.2 |
| EC-P2-11 | 🟠 | Playwright launch fails (no browser installed in the container) | Fail fast at ④ startup with a clear message, not at first request | P2.1.1 |
| EC-P2-12 | 🟠 | Playwright hangs on a page that never fires `networkidle` | Hard per-page timeout. Never wait unbounded — the 90 s job timeout must not be your only backstop | P2.1.3 |
| EC-P2-13 | 🟠 | Playwright leaks browser contexts under concurrency → container OOM | Explicit context close in a `finally`. Cap ④'s concurrency independently of ③'s | P2.1.3 |
| EC-P2-14 | 🟡 | `limit` is 0, negative, or 10,000 | Validate at ① (P2.3.1): clamp to `1..50`. Never pass an unbounded limit to a scraper | P2.3.4 |
| EC-P2-15 | 🟠 | `role` is empty, or 5,000 characters, or contains a URL | Validate and trim. An empty role against Naukri returns the whole board | P2.3.4 |
| EC-P2-16 | 🟡 | `location` omitted (valid — RemoteOK is location-less) | Adapters must accept `None`. Do not coerce to `""` and search for the empty string | P2.1.2 |

---

## P2.2 — Dedupe

The dedupe key is `normalized(company) + normalized(title) + normalized(location)`. Every case below is a way that formula misfires.

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P2-17 | 🔴 | Same job on two boards as `Google` and `Google India Pvt Ltd` → key misses → duplicate rows | Normalize aggressively: lowercase, strip punctuation, strip legal suffixes (`pvt ltd`, `private limited`, `inc`, `llc`, `gmbh`), collapse whitespace. Accept that this is imperfect | P2.2.6 |
| EC-P2-18 | 🔴 | Two **genuinely different openings** at the same company, same title, different cities → key must **not** collapse them | Location stays in the key. Over-merging loses real jobs and is worse than a visible duplicate | P2.2.6 |
| EC-P2-19 | 🔴 | **Schema gap.** `jobs.harvest_run_id` is a single non-null FK, but the same job legitimately appears in run 1, run 2, and run 3 | Upsert keeps the first run's ID, so "which jobs did run 3 find?" becomes unanswerable. Add `last_seen_run_id`, or a `harvest_run_jobs` join table. **Decide before writing the upsert** | P2.2.6 |
| EC-P2-20 | 🟠 | `location` is `NULL` for RemoteOK → key contains a null segment | Normalize `NULL` → `"remote"` or `""` consistently. A null inside a concatenated key silently produces `NULL` in SQL | P2.2.6 |
| EC-P2-21 | 🟠 | Multi-location string: `"Hyderabad, Pune, Bengaluru"` (real, from the existing `jobs.csv`) | One job, not three. Normalize the whole string; do not split | P2.2.6 |
| EC-P2-22 | 🟠 | Company name with emoji, non-breaking spaces, or trailing whitespace | Unicode-normalize (NFKC) and strip before hashing | P2.2.6 |
| EC-P2-23 | 🟠 | Same board returns the same job twice within one response | Dedupe within the board response before the cross-board pass | P2.2.6 |
| EC-P2-24 | 🟠 | Same job, same everything, but re-posted 3 months later with a new URL | Treated as a duplicate; `link` keeps the first URL, which may now 404 | P2.2.6 |
| EC-P2-25 | 🟡 | Title differs only by seniority (`Engineer` vs `Senior Engineer`) | Distinct jobs. Do not strip seniority tokens in normalization | P2.2.6 |
| EC-P2-26 | 🟠 | Dedupe key collides across two users — the unique index is `(user_id, dedupe_key)`, so this is fine | Confirm the index includes `user_id`. Without it, user B's harvest silently suppresses user A's jobs | P2.2.6 |

---

## P2.3 — Queue and orchestration

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P2-27 | 🔴 | **All boards fail** | Run status `failed`, not `partial`. `partial` implies something succeeded | P2.2.3 |
| EC-P2-28 | 🟠 | Zero boards selected in the request | 400 at ①. Do not enqueue a run that can do nothing | P2.3.1 |
| EC-P2-29 | 🔴 | Orchestrator crashes after ④ returns but before persisting → retry re-scrapes the board | Deterministic job ID (P2.2.5) prevents duplicate *rows*; the upsert makes the write idempotent. It does **not** prevent a duplicate *scrape* — accept the cost, and make sure the retry limit is 2 | P2.2.5 |
| EC-P2-30 | 🔴 | **Redis dies mid-run** → the job vanishes → `harvest_runs.status` stays `running` forever | A stale-run reaper: any run `running` for > 10 minutes becomes `failed` with reason `timeout`. Without it, the UI spins indefinitely | P2.2.2 |
| EC-P2-31 | 🟠 | ④ times out at 90 s but completes at 95 s → orphaned work, result discarded | Acceptable. Ensure ④ has no side effects that outlive the request (it is stateless by design) | P2.2.9 |
| EC-P2-32 | 🟠 | ④ returns 200 with a body that fails schema validation | Treat as a board failure with reason `invalid_response`. Never persist unvalidated rows | P2.2.9 |
| EC-P2-33 | 🟠 | ④ returns 500 with an HTML error page | The typed client must not assume JSON. Handle a non-JSON body without throwing a parse error that masks the real status | P2.2.9 |
| EC-P2-34 | 🔴 | **Two orchestrator replicas** both consume the rate-limiter token bucket via read-then-write | Token bucket must be a Redis **Lua script** (atomic). A non-atomic bucket under two replicas doubles the request rate to the board — exactly what P2.2.8 exists to prevent | P2.2.8 |
| EC-P2-35 | 🟠 | Per-board concurrency cap is per-worker rather than global | Cap via a Redis semaphore, not an in-process counter. Three users hitting Naukri simultaneously must not produce 3× the rate | P2.2.7 |
| EC-P2-36 | 🟠 | User starts a second harvest while the first is running | Allowed (cap 2/user per §10.1), but both may touch the same dedupe keys → the upsert must handle the conflict, not the app | P2.2.3 |
| EC-P2-37 | 🟠 | User cancels a harvest mid-run | Mark the run `failed`/`cancelled` and stop enqueueing children. In-flight children finish; their writes are still idempotent | P2.2.3 |
| EC-P2-38 | 🟠 | Circuit breaker opens for Naukri because of user A → user B's search skips Naukri | Correct and intentional. **The UI must say "temporarily unavailable", not "failed"** — user B did nothing wrong and needs to know it will recover | P2.4.3 |
| EC-P2-39 | 🟠 | Circuit breaker state lives in one replica's memory | Must be in Redis (P2.4.3 says so) — verify it, since an in-memory breaker is the easy accidental implementation | P2.4.3 |
| EC-P2-40 | 🟡 | Circuit half-open, two probes go through simultaneously | Single-probe semantics via a Redis lock; otherwise half-open behaves like closed | P2.4.3 |

---

## P2.4 — SSE and the UI

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P2-41 | 🔴 | **A proxy buffers the SSE stream** (nginx does by default) → no events until the run completes | Set `X-Accel-Buffering: no` and `Cache-Control: no-cache`. Otherwise "live progress" silently becomes "one update at the end" and looks like a hang | P2.3.3 |
| EC-P2-42 | 🟠 | SSE connection drops (mobile, sleep, proxy timeout) | Client falls back to polling `GET /api/harvest/:id` (P2.3.7). The durable record is authoritative — the stream is an optimization | P2.3.7 |
| EC-P2-43 | 🟠 | Browser throttles timers/connections in a background tab | Same fallback. On tab focus, refetch the durable record rather than trusting accumulated stream state | P2.3.7 |
| EC-P2-44 | 🟠 | User has two tabs open on the same run → two SSE subscriptions | Both work (pub/sub fans out). Just ensure each connection cleans up on unmount, or connections leak | P2.3.3 |
| EC-P2-45 | 🟠 | User refreshes mid-harvest | Reconstruct from `harvest_runs.board_results`, then resubscribe. Never render progress from stream state alone | P2.3.5 |
| EC-P2-46 | 🟠 | An SSE event arrives for a run the user no longer has access to | Authorize the SSE endpoint like any other route. Streams are routes | P2.3.3 |
| EC-P2-47 | 🟡 | Run completes before the client subscribes | The subscribe handler must send the current durable state immediately on connect, then stream deltas | P2.3.3 |
| EC-P2-48 | 🟡 | Empty result set renders as a blank table indistinguishable from loading | Distinct empty state ("no jobs matched — try a broader role"). See also P7.1.1 | P2.3.6 |

---

## P2.5 — Scraping conduct and the manual path

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P2-49 | 🟠 | `robots.txt` returns 404, or 500, or is malformed | **Decide and document:** 404 → allowed (no rules published). 5xx → treat as disallowed (conservative) or allowed with a log — pick one and write it in `architecture.md` §11.4. Malformed → allowed, logged | P2.4.2 |
| EC-P2-50 | 🟠 | `robots.txt` allows the search path but disallows `/job/*` (which P3 needs) | Check per-URL, not per-host. A host that allows search may still forbid hydration | P2.4.2 |
| EC-P2-51 | 🟠 | `posted_at` is `"Today"`, `"Just now"`, `"30+ days ago"`, `""`, or a future date | `posted_at` stays verbatim; `posted_at_parsed` is best-effort and **nullable**. Never fail a job row because a date did not parse. A future date (timezone artifact) clamps to now | P2.4.4 |
| EC-P2-52 | 🟠 | `POST /api/jobs/manual` with a URL from a domain the P3 SSRF allowlist will reject | P2 accepts it (no fetch yet); P3 refuses to hydrate it. **The UX gap is real** — either validate the domain at add-time or make the P3 message explain why hydration is unavailable and point at manual paste | P2.3.8 |

---

## Traps

### The scraper that returns nothing is the scraper that broke

EC-P2-06 is the defining failure of this phase. A DOM change produces zero rows and HTTP 200 — identical to a legitimately empty search. You will not notice for weeks. Two cheap mitigations, both in P2.1.5:

- Log raw response byte size alongside parsed row count. A 400 KB page yielding 0 rows is a selector break; a 3 KB page yielding 0 rows is an empty result.
- Track a rolling zero-rate per board. A board that suddenly returns zero for every query has broken.

### Dedupe has two failure directions and they are not symmetric

Under-merging (EC-P2-17) shows the user a duplicate — annoying, visible, self-correcting. Over-merging (EC-P2-18) silently hides a real job the user will never see. **Tune toward under-merging.** When in doubt, keep both rows.

### Idempotency protects rows, not requests

EC-P2-29: a deterministic job ID and an upsert guarantee you will not write duplicate jobs. Neither prevents hitting Naukri twice. That is a cost, not a bug — but it means retry limits are a politeness setting, not just a reliability one. Two, not five.

### A global circuit breaker is a shared-fate decision

EC-P2-38 is worth being deliberate about: one user's bad luck degrades everyone's experience on that board. That is the correct trade (it protects the board, which protects everyone's access long-term), but the UI copy must reflect it, or users will think the product is broken.

---

## Exit checklist

Beyond the plan's acceptance criteria:

- [ ] EC-P2-01 vs EC-P2-06: an empty search and a broken selector produce **different** statuses and logs
- [ ] EC-P2-19: decision recorded on how a job maps to multiple harvest runs
- [ ] EC-P2-27: all-boards-fail yields `failed`, not `partial`
- [ ] EC-P2-30: kill Redis mid-run → the run reaches a terminal state within the reaper window
- [ ] EC-P2-34: two orchestrator replicas under load do not exceed `SCRAPE_RATE_LIMIT_PER_MIN` against one board
- [ ] EC-P2-41: SSE events arrive incrementally **through the real proxy**, not just locally
- [ ] EC-P2-18: two same-title openings in different cities both survive dedupe
- [ ] EC-P2-49: robots.txt failure policy written down in `architecture.md` §11.4
