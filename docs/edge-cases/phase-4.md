# Phase 4 — Edge Cases

**Batch scoring** · [plan](../implementation-plan.md#phase-4--batch-scoring) · [index](./README.md)

Phase 4 is the first time an LLM is asked to do something *N* times instead of once. Batching is where the money and the bugs are: a mis-mapped batch response silently attaches the wrong score to the wrong job, and nothing downstream can tell.

**33 cases.** 🔴 must-handle · 🟠 should-handle · 🟡 polish

---

## P4.1 — Tier 0: the heuristic scorer

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P4-01 | 🔴 | **`heuristic-resume.ts` was built for display-only section splitting**, not scoring | **CONFIRMED, and the plan named the WRONG FILE.** `heuristic-resume.ts` is 51 lines of `detectSections()` / `looksLikeResume()` with no scoring capability — P4.1.1's 🟡 marker should have been 🔴. But `lib/scoring.ts` already had the right machinery: `computeSignals()` returns required/preferred/keyword coverage and is the same code the Tier-2 chain uses. `lib/scoring/tier0.ts` is a thin layer over it, so the reuse premise held — just not via the file the plan pointed at | P4.1.1 |
| EC-P4-02 | 🟠 | Tier-0 floor filters **every** job → an empty board | Auto-switch to the low-fit view rather than showing zero rows. An empty board after a successful harvest reads as a bug | P4.1.3 |
| EC-P4-03 | 🟠 | All 20 jobs receive an identical Tier-0 score | Ranking is meaningless but not wrong. Log it; a constant score usually means the resume failed to parse into skills | P4.1.1 |
| EC-P4-04 | 🟠 | Resume has an empty `skills` array (parse failure) | Tier 0 must not divide by zero. Score 0 with an explanation pointing at the resume, not the job | P4.1.1 |
| EC-P4-05 | 🟠 | JD `requiredSkills` empty (EC-P3-26 junk that got through) | Same: guard the denominator, and surface "this job has no extractable requirements" rather than a misleading 0 | P4.1.1 |
| EC-P4-06 | 🟡 | Skill string matching is case- and punctuation-sensitive: `Node.js` vs `NodeJS` vs `node js` | Normalize both sides before comparison. This is most of the accuracy in a heuristic scorer | P4.1.1 |
| EC-P4-07 | 🟡 | Title similarity trips on seniority (`Senior AI Engineer` vs `AI Engineer` scores low) | Compare title tokens with seniority weighted separately, not as a plain string distance | P4.1.1 |

---

## P4.2 — Tier 1: batched LLM scoring

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P4-08 | 🔴 | **Batch of 5 returns 4 scores.** If results are mapped by array index, every job after the gap gets another job's score | **Require an explicit `jobId` in each result object** and validate that the returned set equals the requested set exactly. Never map by position. This bug is invisible: every job has a plausible score, just the wrong one | P4.2.2 |
| EC-P4-09 | 🔴 | Batch returns 6 results, or duplicates a `jobId` | Reject the whole batch and retry; on second failure, fall back to per-job requests | P4.2.2 |
| EC-P4-10 | 🔴 | **One malformed JD in a batch of 5 breaks the whole response** → retry → fails again → 5 jobs unscored | Degrade to per-job scoring for that batch rather than losing all five. One bad job must cost one job | P4.2.2 |
| EC-P4-11 | 🟠 | Score outside 0–100 (negative, 150, a string, `null`) | Zod schema constrains the range; a violation triggers the existing single retry, then the job is marked unscored — never clamped silently | P4.2.5 |
| EC-P4-12 | 🟠 | Sub-scores do not sum to, or contradict, the overall score | Do not recompute. Report what the model returned; the overall is not defined as a sum. Note this in the UI copy so the numbers do not look broken | P4.2.1 |
| EC-P4-13 | 🟠 | Explanation is empty or one word | Requirement P4 inherits from P4 of the source project: a score without reasoning is not shippable. Enforce a minimum length in Zod | P4.2.1 |
| EC-P4-14 | 🔴 | **Groq rate-limits mid-batch** at job 12 of 20 | Persist the 11 completed scores; resume from job 12 on retry. Never rescore from zero — that doubles cost and can loop forever under sustained limiting | P4.2.3 |
| EC-P4-15 | 🟠 | Batch job retried after partial persistence | `applications` upsert on `(user_id, job_id)` makes it idempotent. Confirm it is `ON CONFLICT DO UPDATE`, not `DO NOTHING` — the latter silently keeps a stale score | P4.2.3 |
| EC-P4-16 | 🔴 | **Cost blowup**: a 50 KB resume × 20 jobs, resent in every batch | **IMPLEMENTED AND MEASURED.** The resume is summarised (skills + titles + first bullet, capped at 4k chars) and sent ONCE per batch. Measured on `llama-3.1-8b-instant`: 337 prompt tokens at batch 1, **119 at batch 5** — growth of ~65/job, not ~337, confirming the resume is not repeated. 65% saving vs one request per job; ~66× cheaper per job than a Tier-2 chain counting prompt+completion | P4.2.1 |
| EC-P4-17 | 🟠 | Batch size 5 exceeds the model's context on long JDs | Size batches by **estimated tokens**, not job count. Five 20 KB JDs is a different request from five 2 KB JDs | P4.2.2 |
| EC-P4-18 | 🟠 | `SCORING_MODEL` unset or invalid | Fall back to `TAILORING_MODEL` with a warning, or fail the batch with a clear message. Do not silently use the expensive model for 20 jobs | P4.2.1 |
| EC-P4-19 | 🟡 | Token metric double-counts retries | Count every request including retries — that is the real cost. Label retries so the ratio is visible | P4.2.6 |

---

## P4.3 — Scoring state and staleness

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P4-20 | 🔴 | **User uploads resume v3 after scoring against v2.** Every score on the board is now stale but looks current | `tailoring_runs.resume_id` already records which version scored. **Surface it**: "scored against v2 · current is v3 · rescore". Silently stale scores make the ranking a lie | P4.2.4 |
| EC-P4-21 | 🟠 | No master resume set → `score-batch` has nothing to score | 400 with an actionable message and a link to upload. Never enqueue a job that must fail | P4.3.1 |
| EC-P4-22 | 🟠 | Harvest run contains zero hydrated jobs | No-op with a message ("hydrate some jobs first"), not an error and not an empty successful run | P4.3.1 |
| EC-P4-23 | 🟠 | Score-batch triggered twice concurrently for the same run | `UNIQUE (user_id, job_id)` on `applications` prevents duplicate rows; the second run overwrites with an equivalent score. Wasteful, not incorrect — dedupe by run in the queue | P4.2.3 |
| EC-P4-24 | 🟠 | A job is deleted mid-batch | Handler skips missing jobs; the batch completes | P4.2.3 |
| EC-P4-25 | 🟡 | Mixed tiers on one board (some jobs Tier 0 only, some Tier 1, one Tier 2) | The tier badge (P4.3.4) exists precisely for this. Sorting across mixed tiers is approximate — say so in a tooltip | P4.3.4 |
| EC-P4-26 | 🟡 | Filters combine to produce zero rows | Distinct empty state: "no jobs match these filters" with a clear-filters action, not the same empty state as "no jobs harvested" | P4.3.3 |
| EC-P4-27 | 🟡 | Sorting by score with nulls (unscored jobs) | Nulls sort last, always. Never treat unscored as 0 — that buries a job that simply has not been evaluated | P4.3.2 |

---

## P4.4 — Tier 2 wiring

| ID | | Case | Required behavior | Task |
|----|---|------|-------------------|------|
| EC-P4-28 | 🔴 | User navigates to `/tailor/[jobId]` for a job with `hydration_status != 'hydrated'` | Block with a message and a hydrate action. Never call the tailoring chain with a null JD — it will produce a confident, meaningless run | P4.4.1 |
| EC-P4-29 | 🟠 | Tailoring the same job a second time | Allowed; creates a second `tailoring_runs` row. `active_tailoring_run_id` = latest. Let the user view and re-select an earlier run — they may prefer it | P4.4.3 |
| EC-P4-30 | 🟠 | `tailored_score` comes back **lower** than `original_score` | Report it honestly. Do not hide, clamp, or auto-retry. An honest regression is information; a hidden one is a broken promise about explainability | P4.4.3 |
| EC-P4-31 | 🟠 | Tier-2 run fails midway (LLM error) after `applications.status` was optimistically set to `tailored` | Set status **after** a successful, guardrail-checked, persisted run. Not before | P4.4.3 |
| EC-P4-32 | 🟠 | Removing the JD paste box (P4.4.4) also removes the only path for a `blocked` job | The paste box moves to `/jobs/[id]` (P3.3.4) — verify it is reachable from the tailor screen's error state before deleting the old one | P4.4.4 |
| EC-P4-33 | 🟡 | The low-fit view lets a user tailor a job Tier 0 scored 8 | Allowed and intentional (P4.1.3: advisory only). The tailoring run will show a poor match honestly | P4.3.6 |

---

## Traps

### Index-mapped batch results are a silent data corruption

EC-P4-08 deserves the paranoia. Every other bug in this phase either throws or shows an obviously wrong number. This one produces twenty plausible scores attached to the wrong twenty jobs, and there is no downstream check that would catch it — the user tailors the "best match", gets a poor result, and blames the tailoring engine. **Echo the ID and assert set equality.** Cheap insurance.

### The 40× saving is a claim you have to defend

[`architecture.md`](../architecture.md) §12.3 claims Tier 1 is roughly 40× cheaper per harvest than Tier 2 across the board. EC-P4-16 is how that claim evaporates: resending a full resume with every job turns a batch of 5 into 5 full-resume requests. Measure the real token count at P4.2.6 and compare it against the claim before the exit gate — the plan says to record the number.

### Stale scores are worse than no scores

EC-P4-20 is a trust bug. A user who uploads an improved resume expects the board to reflect it. If the numbers do not change and nothing says why, the product looks broken or dishonest. The data to fix it is already there (`resume_id` on the run); it just has to reach the UI.

### Tier 0 is advisory — enforce that literally

P4.1.3 says the floor never hides a job. That is easy to state and easy to violate by making the default filter exclude low-fit rows with no obvious way back. EC-P4-02 and EC-P4-33 are the two places it leaks.

---

## Exit checklist

Beyond the plan's acceptance criteria:

- [ ] EC-P4-01: `heuristic-resume.ts` read and the task re-marked if it is really 🔴
- [ ] EC-P4-08: batch responses carry explicit job IDs; a fixture returning a short/duplicated set is rejected
- [ ] EC-P4-10: a poisoned JD in a batch costs one job, not five
- [ ] EC-P4-14: rate-limit mid-batch → completed scores persist, retry resumes
- [ ] EC-P4-16: measured tokens-per-harvest recorded, and the 40× claim confirmed or corrected in `architecture.md`
- [ ] EC-P4-20: the board shows which resume version each score used
- [ ] EC-P4-28: tailoring an unhydrated job is blocked with a hydrate action
- [ ] EC-P4-30: a run where the tailored score drops still displays both numbers
