# Phase 7 — Edge Cases

**Polish and hardening** · [plan](../implementation-plan.md#phase-7--polish-and-hardening) · [index](./README.md)

Phase 7 is where the failure matrix in [`architecture.md`](../architecture.md) §18 stops being a table and becomes something you verify. Most cases here are about the states nobody designs for: empty, deleted, rotated, degraded, and mid-flight.

**30 cases.** 🔴 must-handle · 🟠 should-handle · 🟡 polish

---

## P7.1 — UX states

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P7-01 | 🟠 | Empty state and loading state render identically → a slow query looks like "no data" | Every list has three distinct renderings: loading, empty, error. Never share a component between the first two | P7.1.1 |
| EC-P7-02 | 🟠 | "No jobs harvested" and "no jobs match your filters" show the same message | Distinct copy and distinct actions (run a search vs clear filters). See EC-P4-26 | P7.1.1 |
| EC-P7-03 | 🟠 | Onboarding seeds a sample search that hits real job boards on every new signup | Seed from fixtures, not a live harvest. Onboarding must not multiply scraping load by signup rate | P7.1.4 |
| EC-P7-04 | 🟠 | Onboarding's sample resume gets marked as the user's default and then scored against real jobs | Sample data is clearly labeled and easy to delete. Never let it become the default that P4 scores against | P7.1.4 |
| EC-P7-05 | 🟠 | Error boundary catches the error and offers "retry", but retry re-runs a mutation that partially succeeded | Retry only idempotent operations. For mutations, reload state first | P7.1.3 |
| EC-P7-06 | 🟡 | Side-by-side diff on a 375px screen becomes unreadable | Stack vertically with clear original/tailored labels (inherited requirement from the source project) | P7.1.6 |
| EC-P7-07 | 🔴 | **The approve button is reachable by keyboard but the warning panel is not announced** to a screen reader | The review screen is a safety gate. If a user can approve without perceiving the warnings, the gate is decorative for them. Warnings need `role="alert"`; the approve control must follow them in DOM order | P7.1.7 |
| EC-P7-08 | 🟠 | Guardrail flags render below the fold on the review screen | Risk information must be visible without scrolling, above the approve action | P7.1.5 |

---

## P7.2 — Reliability and degradation

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P7-09 | 🔴 | **Redis is down.** Harvest and hydration are unavailable — but tailoring, review, and delivery are synchronous and should still work | Verify the degradation actually holds. A shared client that throws at import time takes the whole app down and turns a partial outage into a total one (§18) | P7.2.4 |
| EC-P7-10 | 🟠 | ④ is unreachable | Harvest, hydrate, and send fail; tailoring and PDF export are unaffected. The banner must name what is degraded, not just say "something is wrong" | P7.2.4 |
| EC-P7-11 | 🟠 | Health check polls ④ every second from every ① instance | Cache health state with a short TTL. A health check that costs more than the feature is a self-inflicted load test | P7.2.4 |
| EC-P7-12 | 🟠 | Retry UI lets a user retry a job that is still running | Disable retry for non-terminal jobs; show the current state instead | P7.2.1 |
| EC-P7-13 | 🟠 | Retrying a harvest re-scrapes boards that already succeeded | Retry only the failed boards. `board_results` already records which | P7.2.2 |
| EC-P7-14 | 🟠 | Per-user LLM quota exhausted mid-tailoring-run | Fail with a clear quota message and preserve the partial run. Do not silently truncate the chain | P7.2.3 |
| EC-P7-15 | 🟠 | Fault injection reveals a §18 row that does not behave as documented | Fix the code **or** the documentation, in the same commit. A failure matrix that has never been tested is a wish list | P7.2.5 |
| EC-P7-16 | 🟠 | Postgres unavailable — the accepted single point of failure | Confirm the app returns a clean 503 with a maintenance message rather than a stack trace or a hang | P7.2.4 |

---

## P7.3 — Observability

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P7-17 | 🔴 | A structured logger serializes a nested object containing the email body or credentials | Redaction must be **allow-list based on the serializer**, not a list of banned key names at call sites. Someone will log a whole request object eventually | P7.3.2 |
| EC-P7-18 | 🔴 | Recipient addresses logged for correlation | Hash them (§16.1). An address in a log is third-party personal data outside the deletion path | P7.3.2 |
| EC-P7-19 | 🟠 | Resume text logged in an LLM prompt trace | The existing `lib/llm/logger.ts` handles prompt logging — extend its redaction to cover outreach prompts too, which now carry payload data | P7.3.2 |
| EC-P7-20 | 🔴 | A metric label includes `userId` → unbounded cardinality → the metrics backend degrades or bills accordingly | Labels are bounded enumerations only: board, status, check, tier, model. Never IDs | P7.3.3 |
| EC-P7-21 | 🟠 | `interlock_block_total{check}` fires constantly and gets treated as noise | Blocks at checks 5 and 6 (opt-out, dedup) are **the system working**. Dashboard them separately from checks 2–3 (token failures), which indicate a bug or an attack | P7.3.3 |
| EC-P7-22 | 🟡 | Traces break at the ①→④ boundary because the trace header is not forwarded | Propagate the trace context in `worker-client.ts`. The boundary crossings are the only spans worth having in a two-language system | P7.3.4 |

---

## P7.4 — Deployment, deletion, rotation

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P7-23 | 🔴 | **Staging's forced dry-run reads the user row** and a test user has `dry_run=false` | The staging override is platform-level and ignores user rows entirely (P7.4.3). Test it by setting `dry_run=false` on a staging user and confirming nothing sends | P7.4.3 |
| EC-P7-24 | 🔴 | **Account deleted while a background job for that user is running** → the job writes rows for a deleted user, or crashes on a missing FK | Jobs check user existence before writing; cascades handle the rest. Deletion during a harvest is not exotic — it is what an angry user does | P7.4.5 |
| EC-P7-25 | 🔴 | Account deletion cascades the database but object storage deletion fails halfway | Collect keys **before** the cascade, delete objects, then delete rows — or record pending deletions in a table a reaper drains. Orphaned resume PDFs after a deletion request is a compliance problem, not a cleanup task | P7.4.5 |
| EC-P7-26 | 🟠 | Deletion removes `outreach_attempts`, destroying the audit trail | Correct — it is the user's data and they asked. Note the trade in the deletion confirmation so it is an informed choice | P7.4.5 |
| EC-P7-27 | 🔴 | `ENCRYPTION_KEY` rotated while requests are in flight | Both key versions must decrypt during the overlap (EC-P5-67). Rotation is: add v2 → re-encrypt in the background → retire v1. Never swap in place | P7.4.4 |
| EC-P7-28 | 🟠 | Production `.env` missing a variable → a service starts and fails at first use | Validate all required config at startup and refuse to boot. A missing `ENCRYPTION_KEY` discovered at first send is a `failed` row for a real user | P7.4.4 |
| EC-P7-29 | 🟠 | ③ and ④ deployed at different versions during a rolling release → wire-type mismatch | Wire types are additive-only across a deploy window: add fields before requiring them, never rename in one release | P7.4.1 |
| EC-P7-30 | 🟠 | ④'s container has no Chromium in the production image (works locally) | Smoke-test hydration and PDF export against the deployed image, not just locally. This is the classic Playwright deployment failure | P7.4.1 |

---

## Traps

### Degradation only counts if you have unplugged something

[`architecture.md`](../architecture.md) §18 lists eleven failure rows with documented behavior. Every one is a hypothesis until P7.2.5 tests it. The most valuable is EC-P7-09: the claim that a Redis outage leaves tailoring and delivery working is the main payoff of the four-container split — and it is trivially broken by one module-level client that throws on import.

### Redaction fails at the serializer, not the call site

EC-P7-17 is why "don't log secrets" is not a policy that works. Someone will log `{ req }` or `{ error }` with a body attached. The defense has to live in the serializer, where it sees everything, rather than in the discipline of every call site.

### Deletion is a distributed transaction you did not plan for

EC-P7-24 and EC-P7-25 are the two halves of the same problem: user data lives in Postgres, object storage, Redis job payloads, and possibly a metrics label. "ON DELETE CASCADE" covers one of those. Enumerate the rest before P7.4.5 rather than discovering them in a deletion request.

### Accessibility on the review screen is a safety property

EC-P7-07 sits oddly in a "polish" phase. It is here because the review screen is the human gate: if the warnings are not perceivable but the approve button is, then for that user the gate does not exist. That is the same class of failure as EC-P5-56, arrived at from a different direction.

---

## Exit checklist

Beyond the plan's acceptance criteria:

- [ ] EC-P7-09: stop Redis → tailoring, review, and delivery still work end to end
- [ ] EC-P7-15: all eleven §18 rows fault-injected and confirmed, or the doc corrected
- [ ] EC-P7-17: log a whole request object on purpose; grep the output for the body and credentials
- [ ] EC-P7-20: no metric label carries an ID
- [ ] EC-P7-23: a staging user with `dry_run=false` still cannot send
- [ ] EC-P7-24: delete an account mid-harvest → no crash, no orphan rows
- [ ] EC-P7-25: delete an account → zero remaining objects in storage for that user
- [ ] EC-P7-27: rotate the key with live credentials → both versions decrypt through the overlap
- [ ] EC-P7-30: hydration and PDF export smoke-tested against the deployed image
