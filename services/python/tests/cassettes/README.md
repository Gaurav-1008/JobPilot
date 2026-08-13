# Board cassettes

Frozen responses for the board adapters, so `test_board_cassettes.py` can prove
the parsers work without touching a live site (architecture.md §19 — recorded
HTML/JSON, **never live sites in CI**).

## What these are, precisely

**Hand-authored to the DOM and payload contracts the adapters target, not
captured from the live sites.** That distinction matters and is worth stating
plainly rather than letting a reader assume otherwise:

| These cassettes catch | These cassettes do NOT catch |
|---|---|
| A parser regression — a changed selector, a dropped field, broken URL joining, scoring or sort changes | A *board* changing its markup. Nothing here was ever a real capture, so it cannot notice reality drifting away from it. |

Catching the second needs a periodic real capture, which is a deliberate manual
step: it pulls third-party content into the repo and has to be reviewed for
incidental personal data before it lands. That is a decision for a human, not
something a test run should do silently.

So: these prove the adapters do what we believe they do. Live-board drift is
still detected the way it always was — a harvest returning zero rows for a board
that used to work.

## Refreshing one from a real capture

1. Fetch the page or endpoint by hand, with the adapter's own User-Agent.
2. Strip anything identifying: recruiter names, applicant counts, tracking
   query strings, cookies, analytics blobs.
3. Trim to a handful of cards — these exist to exercise the parser, not to
   mirror a whole result page.
4. Replace the file and run the suite. A failure now means the board changed
   and the adapter needs updating, which is exactly the signal worth having.

## Files

| File | Board | Shape |
|---|---|---|
| `naukri_search.html` | Naukri | Current `srp-jobtuple-wrapper` markup |
| `naukri_legacy_markup.html` | Naukri | The older `cust-job-tuple` markup the adapter still falls back to |
| `remoteok_api.json` | RemoteOK | `/remote-{tag}-jobs.json`, legal header first |
| `wellfound_extract.json` | Wellfound | Firecrawl JSON-extract result |
