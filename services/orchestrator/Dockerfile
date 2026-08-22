# ============================================================================
# Service ③ — the orchestrator (P7.4.1, architecture.md §17).
#
# The single writer. Consumes the BullMQ queue, calls ④ for scraping and
# hydration, and owns every database write (ADR-003). Per §10.4 it is NOT
# serverless: it holds a long-lived Redis connection and processes jobs that
# run for minutes.
#
# NO HTTP INGRESS. This container listens on nothing. It is a queue consumer,
# so there is no port to expose and no health endpoint to poll — which is why
# the healthcheck below probes the process's own view of Redis rather than
# curling itself. Anything that opens a port here is a design change, not a
# deployment detail (§4: ③ has no public surface).
# ============================================================================

# Pinned to the same major the repo develops and CI runs against (.nvmrc =
# 24.19.0, engines >=22). `-slim` rather than `-alpine`: Prisma's query engine
# needs glibc, and the musl build is a separate binary that has to be requested
# explicitly. Debian is the boring choice and boring is correct for the process
# that owns every write.
FROM node:24.19.0-slim AS base

# openssl: Prisma's engine links against it and the slim image omits it. The
# failure without it is "Unable to require libquery_engine" at first query —
# runtime, not build time, and nowhere near this line.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ---------------------------------------------------------------------------
# Dependencies. Separate layer so a source edit does not reinstall the world.
# ---------------------------------------------------------------------------
FROM base AS deps

# The workspace manifests only. npm needs the full workspace graph to resolve,
# and copying just these keeps the layer cache alive across source changes.
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared-schemas/package.json ./packages/shared-schemas/

# `npm ci` — the lockfile is the contract. `npm install` would silently resolve
# a newer transitive dependency at image build time, which is how a container
# that passed CI ships something CI never saw.
RUN npm ci --ignore-scripts

# ---------------------------------------------------------------------------
# Runtime image.
# ---------------------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production \
    # EC-P0-27 / P0.4.4 — the container defaults to an environment that CANNOT
    # send, matching ④'s Dockerfile. Production must set JOBPILOT_ENV
    # explicitly: the unsafe direction requires an affirmative act.
    JOBPILOT_ENV=local \
    DRY_RUN=true

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules

# ③ imports from apps/web (queue types, the Tier-0 scorer, the LLM client and
# quota, the run filter) — see ADR-003 on why the shared code lives there
# rather than being duplicated. It does NOT need the Next.js app itself, so
# only the directories it actually reaches are copied.
COPY package.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/web/lib/ ./apps/web/lib/
COPY apps/web/prompts/ ./apps/web/prompts/
COPY apps/web/prisma/ ./apps/web/prisma/
COPY packages/shared-schemas/ ./packages/shared-schemas/
COPY services/orchestrator/ ./services/orchestrator/

# The Prisma client is GENERATED, not installed. Skipping this produces
# "@prisma/client did not initialize yet" on the first query — a runtime error
# in a queue handler, where it looks like a job bug rather than a build gap.
RUN npx prisma generate --schema=apps/web/prisma/schema.prisma

# Drop privileges. The node image ships an unprivileged `node` user; nothing
# here writes to the filesystem, so it needs no ownership changes.
USER node

# No EXPOSE — see the header. This container takes no ingress.

# Liveness without a port: ask Redis directly, using the same URL the worker
# consumes from. A worker that cannot reach Redis is doing nothing, and §18's
# "Redis down" row says harvest and hydration are unavailable — so a failing
# probe here is the honest signal, not a false alarm.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "const R=require('ioredis');const r=new R(process.env.REDIS_URL,{maxRetriesPerRequest:1,enableOfflineQueue:false,connectTimeout:5000,lazyConnect:true});r.connect().then(()=>r.ping()).then(()=>{r.disconnect();process.exit(0)}).catch(()=>process.exit(1))"

# tsx rather than a build step: the orchestrator is TypeScript executed
# directly, exactly as `npm run worker` does locally. Keeping the dev and
# production entrypoints identical means the thing that runs in production is
# the thing that was tested, and ③ is not latency-sensitive enough for the
# startup cost to matter.
CMD ["npx", "tsx", "services/orchestrator/index.ts"]
