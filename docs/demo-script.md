# Demo script

**P7.5.3 ·** the runnable form of [`problemStatement.md`](./problemStatement.md) §18.

One real role search, one real job, end to end. Roughly 12 minutes at a
conversational pace.

**The point the whole demo exists to land is step 8:** the email's opening line
is only writable because step 5 ran. Everything before it is setup for that
sentence, and everything after it is proof it was recorded. If time runs short,
cut steps 6 and 11 — never step 5 or step 8.

---

## Before you start

```bash
npm run db:verify          # migrations apply, constraints fire
npm run worker &           # ③ orchestrator
npm run py:worker &        # ④ Python service
npm run dev                # ① web
```

Confirm the environment out loud — it is the first thing a technical audience
will ask, and answering it before it is asked buys credibility for the rest:

```bash
curl -s localhost:3000/api/health | jq
# { "ok": true, "redis": true, "worker": true, "notice": null }
```

**Check `JOBPILOT_ENV` before demoing anything that sends.** Outside
`production`, delivery is forced to dry-run at the platform level regardless of
any user setting (P7.4.3). That is the correct state for a demo; know which one
you are in so step 9 is not a surprise.

**Pre-seeded:** one account, master resume uploaded and set as default. Do not
demo the upload — it is the least interesting minute available and it is not
what anyone is here to evaluate.

---

## The run

### 1 · Sign in (20s)

Land on `/jobs`. Say what the header nav shows: this is a pipeline, not four
tools sharing a login.

### 2 · Search (90s)

`/search` → role **AI Engineer**, location **Bengaluru**, all three boards.

While it runs, narrate the per-board progress list. **This is the first real
point:** one board failing does not fail the run. `board_results` is durable, so
the progress you are watching is reconstructed from the database, not from a
stream that drops on a flaky connection.

> If a board genuinely fails during the demo, do not skip past it — retry the
> failed board only, and let them watch it recover. A failure recovered live is
> a better demo than a clean run.

### 3 · The ranked board (60s)

20 deduplicated jobs. Two things to point at:

- **Every score carries its tier.** "Quick estimate" and "fully tailored" are
  different claims and are labelled differently — a heuristic guess and a
  prompt-chain result must never render as the same number.
- **Low-fit jobs are a view, not a filter.** Switch to "low fit" and back. A
  heuristic is never the reason a job becomes unreachable.

### 4 · Open the top job (60s)

Full JD, extracted requirements, gap analysis — **hydrated with no copy-paste.**
This is Breakage 1 closed, and it is worth saying so explicitly: the original
tool could not do this at all.

### 5 · Tailor (2 min) — **do not cut this**

Side-by-side bullet rewrites. For each: the reason it changed, the keywords it
addressed, a confidence level.

Then open one bullet and read its reason aloud. **The claim is truthfulness
enforced by code, not by prompting** — the guardrails run server-side after
generation, and a fabricated employer is rejected rather than discouraged.

Tailored score: 89, up from 78.

### 6 · Export the proof PDF (30s) — *cuttable*

### 7 · Add a recipient (45s)

`careers@` — and point out that the **source is recorded**. Where a contact came
from is part of the audit trail, not metadata.

### 8 · Generate the email (2 min) — **THE POINT**

Read the opening line aloud. Then open the evidence panel and show that the
skill it cites is the one the scoring engine actually matched in step 5.

> Say this plainly: *"This sentence is not writable by a mail-merge tool. It
> exists because the tailoring run persisted what it matched, and the email
> generator reads that instead of guessing. That is the argument for merging
> three projects into one."*

Show the honest-gaps list too — the things deliberately **not** claimed. A tool
that knows what to leave out is making a stronger claim than one that does not.

### 9 · Review and approve (90s)

The safety gate. Worth doing slowly:

- Warnings render **above** the approve control and are announced to a screen
  reader (EC-P7-07) — if the warnings are not perceivable, the gate is
  decorative for that user.
- Approval binds to a **hash of the exact body**. Edit one character after
  approving and the approval dies — the server re-checks at delivery, so the
  human gate binds to specific content rather than to "the user clicked yes".

Pick subject 2. Approve. Create the Gmail draft.

### 10 · The tracker (60s)

job → 78 → 89 → resume v3 → drafted → timestamped audit row.

**Breakage 3 closed.** Every stage is joined, and the audit trail records the
refusals as well as the sends.

### 11 · Export the proof bundle (30s) — *cuttable*

---

## The Phase 7 coda (2 min, optional but strong)

If the audience is technical, this is the most convincing two minutes available,
because it demonstrates the thing most demos quietly avoid.

**Stop Redis, then keep working.**

```bash
docker compose stop redis
```

- The banner appears within 30 seconds and names *what* is degraded: job
  searching is paused, tailoring and sending still work (EC-P7-10).
- Start a search anyway → a clean 503 in about a second, not a hang. Say why
  that distinction matters: an enqueue against a down Redis used to wait
  forever, and "unavailable" and "hangs" are different products.
- **Now tailor a job and create a draft.** It works. That is the four-container
  split paying for itself, and it is the row of §18 that was a hypothesis until
  it was tested.

```bash
docker compose start redis
```

The banner clears on its own.

---

## Recording notes (P7.5.4)

Not yet recorded — this needs a live run against real boards.

- Screen only, no webcam. 1080p minimum; the score column and bullet reasons
  must be readable, and they are the two things a viewer will pause on.
- **Do not cut the harvest wait.** A 40-second honest wait is more credible than
  a jump cut, and the per-board progress is doing real narrative work.
- Do a dry run first and check what is in the frame. The tracker and the
  outreach log carry real contact addresses.
- If a board fails during the take, keep it and retry it live.
