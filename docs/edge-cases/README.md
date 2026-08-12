# JobPilot — Edge Case Reference

One file per implementation phase. Open the matching file **before** you start a task group, and again before you close it.

| Phase | File | Cases | Focus |
|-------|------|-------|-------|
| 0 | [phase-0.md](./phase-0.md) | 28 | Merge collisions, schema codegen, migrations |
| 1 | [phase-1.md](./phase-1.md) | 43 | Uploads, versioning races, tenant isolation |
| 2 | [phase-2.md](./phase-2.md) | 52 | Board failures, dedupe, queue, SSE, rate limits |
| 3 | [phase-3.md](./phase-3.md) | 47 | SSRF, cache keys, junk JDs, paste fallback |
| 4 | [phase-4.md](./phase-4.md) | 33 | Batch mapping, stale scores, cost blowups |
| 5 | [phase-5.md](./phase-5.md) | 68 | Interlocks, tokens, credentials, grounding |
| 6 | [phase-6.md](./phase-6.md) | 35 | Status conflicts, sweep safety, legacy import |
| 7 | [phase-7.md](./phase-7.md) | 30 | Deletion, rotation, redaction, degradation |

**Total: 336 cases.**

---

## How to use these files

### Severity

| | Meaning | Rule |
|---|---------|------|
| 🔴 | Safety, security, data loss, or silent corruption | Must be handled and tested before the task is done |
| 🟠 | Correctness or reliability | Handle it; test if cheap |
| 🟡 | UX or polish | Handle when you touch the surface |

### ID scheme

`EC-P{phase}-{nn}` — e.g. `EC-P5-31`. Cite these in code comments and tests:

```ts
// EC-P5-31: the recipient's own name must not trip the named-person BLOCK
if (mentionedNames.some(n => n !== contact.recipientName)) { ... }
```

```python
# EC-P3-12: re-resolve DNS on every redirect hop
```

A grep for `EC-P` across the repo tells you which cases are actually covered.

### Workflow

1. Before a task group: read its section. Some cases change the design, not just the code.
2. While coding: add `// EC-Pn-nn` where you handle one.
3. Before the exit gate: every 🔴 in the phase is either handled-and-referenced or explicitly waived in writing.

---

## ⚠ Design gaps found while writing these

Eighteen cases contradict, or expose a hole in, [`problemStatement.md`](../problemStatement.md) or [`architecture.md`](../architecture.md). **These need a decision before the phase that hits them.** Each is detailed in its phase file.

| ID | Gap | Blocks | Suggested resolution |
|----|-----|--------|---------------------|
| EC-P0-04 | `LLM_MODEL` means the Groq model in Resume-Builder and the Claude model in The Closer — same name, two meanings | P0 | Rename to `TAILORING_MODEL` / `EMAIL_LLM_MODEL`; never let the bare name survive |
| EC-P0-06 | Python floor is 3.8 (harvester) vs 3.10 (Closer) | P0 | Merged service is 3.10+; run harvester tests on 3.10 before trusting it |
| EC-P0-14 | Zod `.refine()` / `.superRefine()` vanish in JSON Schema — Pydantic silently loses the constraint | P0 | Ban refinements on wire types; enforce in ④ by hand and test both sides |
| EC-P0-17 | Wire casing undecided — TS is camelCase, The Closer's models are snake_case | P0 | Pick snake_case on the wire; Pydantic `alias_generator`; assert in a contract test |
| EC-P1-09 | PDF extraction can emit `\x00`; Postgres `text` rejects null bytes | P1 | Strip control chars in `document-extract` before persist |
| EC-P1-42 | Supabase Auth rejects `@example.com`, the domain EC-P0-26 mandates for seeds — a seeded user can never sign in | P1 | Seed rows are data-only; pass `SEED_USER_ID` to attach real data to a real account |
| EC-P2-19 | `jobs.harvest_run_id` is a single FK, but a job legitimately appears in many runs | P2 | Keep `first_seen_run_id`, add `last_seen_run_id`, or a join table |
| EC-P3-02 | `HYDRATION_CACHE_TTL_DAYS=30` (§14) contradicts "fetched once, ever" (FR2) | P3 | TTL governs *refresh eligibility*; never evict. Decide and write it down |
| EC-P3-05 | A `manual_paste` entering the cross-user `jd_cache` shares whatever the user typed | P3 | **Never cache manual pastes.** Cache only machine-fetched public pages |
| EC-P3-31 | JD text is third-party content that flows into the email prompt via `jdHooks` — prompt injection | P3, P5 | Treat JD text as untrusted data; delimit and instruct; validate output |
| EC-P4-01 | `heuristic-resume.ts` was built for display-only section splitting, not scoring | P4 | Re-mark P4.1.1 as 🔴; budget accordingly |
| EC-P5-33 | Grounding BLOCKs on named people, but the greeting contains the recipient's name | P5 | Exclude `contact.recipientName` and the sender's own name from the check |
| EC-P5-34 | Grounding FLAGs skills absent from `topMatchedSkills` (top 3 only) — false positives on real resume skills | P5 | Check against the full `ResumeProfile.skills`, not the truncated payload |
| EC-P5-50 | Dedup keys on `contact_id`; the same person across two applications is two contacts | P5 | Dedup on normalized email within the window, not on contact row |
| EC-P5-52 | Volume-cap `COUNT` then `INSERT` is a TOCTOU race across concurrent tabs | P5 | Advisory lock or `SERIALIZABLE` around count+insert |
| EC-P5-59 | Token burns before the provider call; a lost response leaves `failed` while a real draft exists | P5 | Record `provider_attempted_at`; reconcile; surface "may have been created" |
| EC-P6-11 | Sweep treats `emailed` as sent, but `emailed` includes drafts the user may never have sent | P6 | Sweep only on `outreach_attempts.status='sent'` |
| EC-P6-12 | "No reply after N days" — nothing in the system can detect a reply | P6 | Rename to "no response recorded"; it keys off the user's manual status |
| EC-P6-24 | Legacy `outreach_log.csv` has no application or contact, but both FKs are `NOT NULL` | P6 | Make both nullable for `legacy_import` rows, or synthesize placeholders |

---

## Standing invariants

True in every phase. If an edge case would violate one of these, the edge case is wrong — or the invariant needs an explicit, written exception.

1. **No fabrication reaches storage.** Guardrails run server-side before persistence, never after.
2. **No email leaves without a fresh, single-use, body-bound approval token.**
3. **Missing configuration fails toward not-sending.** Never toward sending.
4. **A board, provider, or model failure degrades to a manual path.** Never to a dead end.
5. **Every tenant-scoped read is filtered by `user_id`.** A miss is a data leak, not a bug.
6. **Every outreach decision is logged** — including skips, blocks, and failures.
7. **JD text, board HTML, and imported CSVs are untrusted input.** Treat them as hostile.

---

*Add cases as you hit them in real implementation. A case discovered in production and not written down here will be rediscovered.*
