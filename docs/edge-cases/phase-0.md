# Phase 0 — Edge Cases

**Monorepo and contract** · [plan](../implementation-plan.md#phase-0--monorepo-and-contract) · [index](./README.md)

Phase 0 looks like plumbing, so it is the phase people rush. Every case below is something that will surface *later* as a mysterious runtime error — a Pydantic model that accepts what Zod rejects, a migration that works on your laptop and not on Supabase, a env var that means two different things. Fix them now, when they cost minutes.

**28 cases.** 🔴 must-handle · 🟠 should-handle · 🟡 polish

---

## P0.1 — Repository structure

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P0-01 | 🟠 | `git subtree add --prefix` fails because the prefix directory already exists | Add subtrees into an empty tree **first**, before creating any scaffolding at those paths | P0.1.5 |
| EC-P0-02 | 🟠 | Three repos have three `.gitignore` files with overlapping and conflicting rules (`.env`, `token.json`, `outreach_log.csv`, `jobs.csv`, `node_modules`) | Merge into one root `.gitignore`; **verify `.env`, `token.json`, `credentials.json`, `outreach_log.csv` are still ignored after the merge.** A dropped rule here commits a credential | P0.1.5 |
| EC-P0-03 | 🟠 | Each repo has its own `LICENSE` (harvester is MIT); the merged repo needs one story | Keep per-package LICENSE files or consolidate deliberately. Do not silently drop one | P0.1.6 |
| EC-P0-04 | 🔴 | **`LLM_MODEL` collision.** Resume-Builder uses it for the Groq tailoring model (`llama-3.3-70b-versatile`); The Closer uses it for the Claude rewrite model. Same variable, two meanings | Rename both: `TAILORING_MODEL` and `EMAIL_LLM_MODEL`. **Do not leave a bare `LLM_MODEL` in `.env.example`** — whichever service reads it second wins, and the failure is a wrong-model call, not a crash | P0.4.3 |
| EC-P0-05 | 🟠 | Both Python projects ship `requirements.txt` with different pins for shared deps (Playwright, requests) | One resolved requirements set for ④. Run **both** CLIs against it before declaring P0.1.3/P0.1.4 done — a Playwright bump can silently change selector behavior in `naukri.py` | P0.1.3 |
| EC-P0-06 | 🔴 | **Python floor mismatch.** job-harvester targets 3.8+, cold-email-sender targets 3.10+ | Merged service is **3.10+**. Harvester code was never *tested* on 3.10 — run its test suite on 3.10 before trusting the 🟢 marker | P0.1.3 |
| EC-P0-07 | 🟠 | Module name collisions once both Python projects live under one package root (`models`, `config`, `main`) | Import them as `harvester.*` and `outreach.*` packages with `__init__.py`. Verify no bare `import config` remains | P0.1.4 |
| EC-P0-08 | 🟡 | Resume-Builder's `docs/` collides with the root `docs/` | Nest as `apps/web/docs/` or fold into root `docs/` with a prefix. Cross-links in the original docs will break either way — fix or note them | P0.1.2 |

> **On P0.1.2–P0.1.4 "verify it still runs":** run them against *real* inputs, not `--help`. A CLI that prints usage proves the interpreter starts, nothing more. Run one live harvest and one dry-run email batch.

---

## P0.2 — Shared schema contract

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P0-09 | 🟠 | `z.union()` / `z.discriminatedUnion()` generate awkward or invalid Pydantic | Prefer flat objects with an enum discriminator on wire types. Verify each generated model instantiates | P0.2.4 |
| EC-P0-10 | 🟠 | `z.record()` and index signatures lose key typing through JSON Schema | Use explicit objects on the wire. `board_results` is the one legitimate record — type it as an object with three known keys | P0.2.3 |
| EC-P0-11 | 🟠 | `z.date()` vs `z.string().datetime()` — one serializes to a JS Date, the other to ISO text | **Wire types use ISO strings only.** Parse to `datetime` inside each service, never across the boundary | P0.2.3 |
| EC-P0-12 | 🟠 | `.optional()` (may be `undefined`) vs `.nullable()` (may be `null`) vs Pydantic `Optional[X]` (means `None`) — a three-way mismatch. JSON has no `undefined` | Pick **nullable, never optional** for wire types. An absent key and a null key must mean the same thing | P0.2.3 |
| EC-P0-13 | 🟠 | Zod `.default()` applies on parse; Pydantic defaults apply on construction — a field defaulted on one side arrives absent on the other | No defaults on wire types. Both sides send every field explicitly | P0.2.3 |
| EC-P0-14 | 🔴 | **`.refine()` and `.superRefine()` are invisible to JSON Schema.** A Zod type that enforces "word_count ≤ 150" generates a Pydantic model that accepts 500 | **Ban refinements on wire types.** Where a cross-field rule is needed, implement it in both languages and write a contract test asserting both reject the same payload | P0.2.4 |
| EC-P0-15 | 🟠 | Codegen output ordering varies between generator versions → spurious CI diffs that train people to ignore the check | Pin `datamodel-code-generator` exactly. Sort keys deterministically. A flaky drift check is worse than none | P0.2.6 |
| EC-P0-16 | 🟡 | `.gitattributes linguist-generated` hides the file in review but does not stop `git diff --exit-code` | Correct — that is what you want. Just do not also add it to `.gitignore` | P0.2.5 |
| EC-P0-17 | 🔴 | **Wire casing is undecided.** TS domain types are camelCase; The Closer's `Contact` uses `recipient_email`, `personalization_note` | Decide once: **snake_case on the wire.** Configure Pydantic `alias_generator` and a Zod transform layer. Add a contract test that fails if a camelCase key crosses the boundary | P0.2.3 |
| EC-P0-18 | 🟠 | Enum drift: adding `'manual'` to `Job.source` in Zod but the generated Pydantic enum is not regenerated in the same commit | This is exactly what P0.2.6 catches. Verify the check actually fails by breaking it on purpose before trusting it | P0.2.6 |
| EC-P0-19 | 🟡 | The generated `models.py` imports a Pydantic v2 API while ④ pins v1 | Pin Pydantic v2 explicitly in ④'s requirements at P0, not when it breaks in P2 | P0.2.4 |

---

## P0.3 — Data layer

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P0-20 | 🔴 | `CITEXT` is used by `users.email`, `contacts.recipient_email`, and `opt_out_entries.email`, but the extension may not exist | `CREATE EXTENSION IF NOT EXISTS citext;` as the **first statement** of the first migration. On managed Postgres, confirm it is on the allowed-extension list before designing around it | P0.3.2 |
| EC-P0-21 | 🟠 | `gen_random_uuid()` requires `pgcrypto` on PG < 13 | Add `CREATE EXTENSION IF NOT EXISTS pgcrypto;` or target PG 13+ explicitly | P0.3.2 |
| EC-P0-22 | 🔴 | **Partial unique index** `one_default_resume_per_user ... WHERE is_default` is not expressible in Prisma's schema DSL | Write it as raw SQL in the migration. Verify it survives `prisma migrate dev` — Prisma can drop objects it does not know about when it regenerates | P0.3.2 |
| EC-P0-23 | 🟠 | `CHECK` constraints from §7.2 get lost if the ORM regenerates the schema from its own model | Same fix: raw SQL, and a test that inserts an invalid `status` and expects a DB-level rejection. Do not rely on application-layer validation alone | P0.3.2 |
| EC-P0-24 | 🟠 | The ESLint ban on raw ORM access is trivially defeated by `import { prisma as db }` | Ban by import path (`no-restricted-imports` on the client module), not by identifier name | P0.3.4 |
| EC-P0-25 | 🟠 | Seed script run twice creates duplicate users and jobs | Make it idempotent — upsert on natural keys, or truncate-then-seed behind an explicit flag | P0.3.5 |
| EC-P0-26 | 🟡 | Seed data uses a real-looking email that could receive mail if `DRY_RUN` were ever off | Seed only `@example.com` addresses (RFC 2606 reserved). Never a real domain | P0.3.5 |

---

## P0.4 — Local environment

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P0-27 | 🔴 | **`DRY_RUN` forced at the config layer, but the config module reads `os.environ` at import time.** A test that patches the env after import gets the old value | Read config through a function, or force the value in the module that both paths import first. Then write the test that proves it: set `DRY_RUN=false` in the environment and assert the resolved config is still `true` in CI | P0.4.4 |
| EC-P0-28 | 🟠 | Playwright's Chromium image is amd64; Apple Silicon runs it under emulation or fails outright | Use a multi-arch Playwright base image, or pin `platform: linux/amd64` in compose and accept the slowdown locally. Discover this at P0, not when P2's first scrape hangs | P0.4.2 |

---

## Traps

### The 🟢 marker is a claim, not a fact

`P0.1.2`–`P0.1.4` mark all three imports as 🟢 EXISTING. That is only true if they still *run*. Three things routinely break a "pure move":

- A relative path (`open('contacts.json')`) that resolved from the old repo root.
- An import that worked because the module was the entrypoint.
- A dependency version that resolved differently under the new lockfile.

Verify by running, not by reading.

### `.env.example` is a merge conflict pretending to be a file

Three projects, three env files, overlapping names with different meanings (EC-P0-04). Build the consolidated file by hand from [`problemStatement.md`](../problemStatement.md) §14 rather than concatenating — a concatenation will produce a file where the last duplicate silently wins.

### The drift check is only real if you have seen it fail

Before you trust P0.2.6, deliberately edit a Zod type without regenerating and confirm CI goes red. An unverified guard is worse than none, because you will stop reading its output.

---

## Exit checklist

Beyond the plan's acceptance criteria:

- [ ] EC-P0-04: no bare `LLM_MODEL` exists anywhere in the repo (`grep -r 'LLM_MODEL'` returns only the two renamed vars)
- [ ] EC-P0-06: harvester's tests pass on Python 3.10
- [ ] EC-P0-14: contract test proves Zod and Pydantic reject the same invalid payload
- [ ] EC-P0-17: casing decision recorded in `architecture.md` §8, with a boundary test
- [ ] EC-P0-20: fresh database from empty migrations succeeds on the *managed* provider, not just locally
- [ ] EC-P0-22/23: an invalid `status` insert is rejected by Postgres, not by the app
- [ ] EC-P0-27: `DRY_RUN=false` in the CI environment still resolves to `true`
- [ ] EC-P0-02: `git status` after a full local run shows no `.env`, `token.json`, or log files as untracked-but-not-ignored
