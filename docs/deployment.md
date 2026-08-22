# Deployment

**P7.4.1 / P7.4.2 ·** [architecture.md §17](./architecture.md)

Three services, three places, one shared Postgres and Redis.

| | Service | Where | Ingress |
|---|---|---|---|
| ① | Next.js web | Vercel (`bom1`, near Supabase) | public |
| ③ | Orchestrator | Railway, `services/orchestrator/Dockerfile` | **none** |
| ④ | Python worker | Railway, `services/python/Dockerfile` | private only |

Managed: Postgres (Supabase, `ap-south-1`), Redis (Railway add-on), object
storage (S3-compatible).

---

## The one that gets forgotten

> **`JOBPILOT_ENV=production` must be set explicitly on ① and ③.**

Both images default to `local`, which forces dry-run at the platform level
(EC-P7-23). That default is correct — the unsafe direction should require an
affirmative act — and it is also the variable people forget, at which point
everything works except that no email ever leaves.

A near-miss no longer passes silently: an unrecognised value like `prod` or
`producton` **refuses to boot** rather than quietly resolving to `local`
(P7.4.4). Unset still means `local`, because that is what a developer wants.

---

## Order of operations

Reversed, this bites: ③ and ④ need to exist before ① can talk to them, and
migrations need a direct connection before anything queries.

1. **Migrate.** `npm run db:migrate` against `DIRECT_URL` (:5432 — pgbouncer in
   transaction mode cannot run DDL).
2. **Deploy ④.** Confirm `/health` and that its startup log says `chromium ok`.
   The image's HEALTHCHECK launches Chromium, so a broken image fails at
   container start rather than at the first hydration (EC-P7-30).
3. **Deploy ③**, pointing `WORKER_SERVICE_URL` at ④'s private address. It takes
   no ingress; liveness is a Redis ping.
4. **Deploy ①** to Vercel with the pooled `DATABASE_URL` (:6543).
5. **Smoke-test** with `docs/demo-script.md`.

---

## Which connection string goes where

The single most common misconfiguration, because both URLs work — until they
don't.

| Service | Variable | Port | Why |
|---|---|---|---|
| ① Vercel | `DATABASE_URL` | 6543 | serverless opens many short-lived connections; transaction pooling multiplexes them |
| ③ Railway | `DIRECT_URL` | 5432 | persistent worker; a pool slot is a real backend, and transaction pooling is built for the opposite shape |
| migrations | `DIRECT_URL` | 5432 | DDL and advisory locks need a session |

③ additionally sizes its Prisma pool from `ORCHESTRATOR_CONCURRENCY + 2`.
Leaving Prisma's default of `num_cpus * 2 + 1` lets one worker claim a large
share of a 60-connection instance for work bounded at 4.

---

## Post-deploy verification

```bash
curl -s https://<app>/api/health | jq       # { ok, redis, worker, notice }
curl -s -H "Authorization: Bearer $METRICS_TOKEN" https://<app>/api/metrics | head
```

Then confirm the safety properties hold in the real environment:

- [ ] A staging user with `dry_run=false` still cannot send (EC-P7-23)
- [ ] Stop Redis → the banner names what is degraded, and tailoring still works
- [ ] `npm run verify:key-rotation` reports every credential decrypting
- [ ] Hydrate one job → confirms Chromium in the deployed image (EC-P7-30)

## Scheduled jobs

`npm run reap:deletions` — drains the object-storage worklist left by an
account deletion that hit a storage outage. Daily is enough. Orphaned resume
PDFs after a deletion request are a compliance problem, not a cleanup task.
