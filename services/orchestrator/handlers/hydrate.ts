/**
 * Hydration handler (P3.2) — closes Breakage 1.
 *
 * Fetch a listing's JD text, extract structure, persist. The cache is checked
 * before any network call, and the flow degrades to `blocked` — which the UI
 * turns into a paste box — rather than ever dead-ending the user (FR2).
 */

import type { PrismaClient } from "@prisma/client";
import type Redis from "ioredis";

import { urlHash } from "../lib/url-normalize";

export interface HydrateDeps {
  prisma: PrismaClient;
  redis: Redis;
  /** ④ POST /hydrate. */
  fetchJd: (url: string) => Promise<{
    raw_text: string;
    method: "firecrawl" | "playwright";
    blocked: boolean;
    reason: string | null;
  }>;
  /** The existing JD extraction prompt, unchanged. */
  extractProfile: (rawText: string) => Promise<unknown>;
}

export interface HydrateJob {
  jobId: string;
  userId: string;
}

/** Arrays that are all empty means the extraction found no job in the text. */
function isEmptyProfile(profile: unknown): boolean {
  const p = profile as Record<string, unknown> | null;
  if (!p) return true;
  const lists = ["requiredSkills", "preferredSkills", "responsibilities", "qualifications"];
  return lists.every((k) => !Array.isArray(p[k]) || (p[k] as unknown[]).length === 0);
}

export async function handleHydrateJob(deps: HydrateDeps, data: HydrateJob): Promise<void> {
  const { jobId, userId } = data;

  const job = await deps.prisma.job.findFirst({
    where: { id: jobId, userId },
    select: { id: true, link: true, hydrationStatus: true },
  });
  // EC-P3-42: the job may have been deleted mid-flight. A no-op, not a failure.
  if (!job) return;

  // EC-P3-37 — THE RACE THAT MATTERS. If the user pasted a description while
  // this job was queued, that paste WINS. Losing text a human typed to a
  // background fetch is the worst outcome the fallback path can produce, so
  // this is checked before anything else touches the network.
  if (job.hydrationStatus === "hydrated") return;

  const hash = urlHash(job.link);

  // EC-P3-02 — cache first, ALWAYS. `fetched_at` gates refresh eligibility;
  // entries are never evicted, because an evicted entry means a JD we can no
  // longer show for an old application.
  const cached = await deps.prisma.jdCache.findUnique({ where: { urlHash: hash } });

  let rawText: string;
  let method: string;

  if (cached) {
    rawText = cached.rawText;
    method = cached.method;
  } else {
    const fetched = await deps.fetchJd(job.link);

    if (fetched.blocked || !fetched.raw_text) {
      // Terminal, and honest. The UI turns this into a paste box; there is no
      // retry-with-evasion path anywhere (§12.4).
      await deps.prisma.job.update({
        where: { id: jobId },
        data: { hydrationStatus: fetched.reason?.startsWith("ssrf") ? "failed" : "blocked" },
      });
      await publish(deps, jobId, "blocked", fetched.reason);
      return;
    }

    rawText = fetched.raw_text;
    method = fetched.method;

    // EC-P3-05 — jd_cache is CROSS-USER, and that is only defensible because a
    // job posting is public content. A manual paste is whatever the user typed
    // and carries no such guarantee, so the paste route (P3.3.4) does NOT write
    // here. "Cache more things" is the natural and wrong instinct at this line.
    await deps.prisma.jdCache.upsert({
      where: { urlHash: hash },
      update: { rawText, method, fetchedAt: new Date() },
      create: { urlHash: hash, url: job.link, rawText, method },
    });
  }

  // EC-P3-40/41 — persist raw_text BEFORE extraction. If the LLM is down, the
  // fetched text must survive so extraction can be retried without re-fetching.
  await deps.prisma.jobDescription.upsert({
    where: { jobId },
    update: { rawText, extractionMethod: method },
    create: { jobId, rawText, extractionMethod: method, profile: {} },
  });

  let profile: unknown;
  try {
    profile = await deps.extractProfile(rawText);
  } catch {
    // Text is safe on disk; leave the job pending so extraction can retry.
    await deps.prisma.job.update({
      where: { id: jobId }, data: { hydrationStatus: "pending" },
    });
    await publish(deps, jobId, "pending", "extraction_failed");
    return;
  }

  // EC-P3-26 — valid JSON with every array empty means the page was not a job
  // description. `hydrated` here would produce a confident, meaningless score.
  if (isEmptyProfile(profile)) {
    await deps.prisma.job.update({
      where: { id: jobId }, data: { hydrationStatus: "failed" },
    });
    await publish(deps, jobId, "failed", "no_requirements_extracted");
    return;
  }

  await deps.prisma.jobDescription.update({
    where: { jobId },
    data: { profile: profile as never, extractedAt: new Date() },
  });
  await deps.prisma.job.update({
    where: { id: jobId }, data: { hydrationStatus: "hydrated" },
  });
  await publish(deps, jobId, "hydrated", null);
}

async function publish(
  deps: HydrateDeps, jobId: string, status: string, reason: string | null,
) {
  await deps.redis
    .publish(`hydrate:${jobId}`, JSON.stringify({ jobId, status, reason }))
    .catch(() => {});
}
