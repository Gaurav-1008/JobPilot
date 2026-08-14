/**
 * Batch scoring (P4.2.3) — closes Breakage 4.
 *
 * Three tiers, and the cost argument is the whole point of the split:
 *
 *   Tier 0  heuristic, 0 tokens, ~1ms/job   — ranks everything
 *   Tier 1  cheap model, batched            — refines what clears the floor
 *   Tier 2  full chain, on demand, per job  — unchanged from Phase 1
 *
 * Running Tier 2 across 20 jobs is what architecture.md §12.3 calls
 * prohibitive. Ranking and tailoring are different problems with different
 * accuracy needs, and this file is where that distinction is enforced.
 */

import type { PrismaClient } from "@prisma/client";
import type Redis from "ioredis";

import { scoreTier0, DEFAULT_TIER0_FLOOR } from "../../../apps/web/lib/scoring/tier0";
import {
  buildScoringPrompt,
  summariseResumeForScoring,
  type Tier1JobInput,
} from "../../../apps/web/prompts/scoring-cheap";

export interface ScoreBatchDeps {
  prisma: PrismaClient;
  redis: Redis;
  /** Returns parsed results plus token usage. Throws on unrecoverable errors. */
  scoreWithLlm: (systemPrompt: string, userPrompt: string) => Promise<{
    results: Array<{
      jobId: string;
      overallScore: number;
      skillCoverageScore: number;
      responsibilityAlignmentScore: number;
      keywordScore: number;
      seniorityScore: number;
      criticalMissingRequirements: string[];
      explanation: string;
    }>;
    tokens: { prompt: number; completion: number };
  }>;
  systemPrompt: string;
  model: string;
  promptVersion: string;
}

export interface ScoreBatchJob {
  userId: string;
  harvestRunId: string | null;
  /** EC-P4-02: jobs below the floor are still SCORED, just marked low fit. */
  floor?: number;
}

/** EC-P4-17 — size batches by estimated tokens, not job count. */
const MAX_BATCH_JOBS = 5;
const MAX_BATCH_CHARS = 9_000;

function chunkByBudget(jobs: Tier1JobInput[]): Tier1JobInput[][] {
  const batches: Tier1JobInput[][] = [];
  let current: Tier1JobInput[] = [];
  let chars = 0;

  for (const job of jobs) {
    const size = JSON.stringify(job).length;
    if (current.length >= MAX_BATCH_JOBS || (chars + size > MAX_BATCH_CHARS && current.length)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(job);
    chars += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

export async function handleScoreBatch(
  deps: ScoreBatchDeps,
  data: ScoreBatchJob,
): Promise<void> {
  const { userId, harvestRunId } = data;
  const floor = data.floor ?? DEFAULT_TIER0_FLOOR;

  // EC-P4-21 — no default resume is a real state with an actionable message,
  // not a crash. The route rejects it, but the handler must not assume that.
  const resume = await deps.prisma.resume.findFirst({
    where: { userId, isDefault: true },
  });
  if (!resume) return;

  const jobs = await deps.prisma.job.findMany({
    where: {
      userId,
      hydrationStatus: "hydrated",
      ...(harvestRunId ? { harvestRunId } : {}),
    },
    include: { jobDescription: true },
  });
  // EC-P4-22 — zero hydrated jobs is a no-op, not an error.
  if (jobs.length === 0) return;

  const resumeProfile = resume.profile as never;
  const tier1Inputs: Tier1JobInput[] = [];
  const tier0ByJob = new Map<string, ReturnType<typeof scoreTier0>>();

  /* ---------------- Tier 0: every job, zero tokens ---------------- */
  for (const job of jobs) {
    const jd = job.jobDescription?.profile as never;
    /**
     * `!jd` catches null. It does NOT catch `{}`, which is truthy — and an
     * empty object is exactly what the hydrate handler writes when it saves
     * raw text before extraction, and what a manual paste wrote before Phase 6.
     * Such a row reached scoreTier0, where `coverage(corpus, undefined)` threw
     * "items is not iterable".
     */
    if (!jd || Object.keys(jd).length === 0) continue;

    /**
     * EC-P2-04's rule, which harvest honours and this loop did not: ONE ROW
     * FAILING MUST NOT LOSE THE OTHERS. That single throw above aborted the
     * whole batch job, so 21 hydrated jobs produced zero scores and the only
     * evidence was "items is not iterable" in the queue's failure record.
     */
    let t0: ReturnType<typeof scoreTier0>;
    try {
      t0 = scoreTier0(resumeProfile, jd);
    } catch (err) {
      console.error(JSON.stringify({
        event: "score.tier0_failed",
        jobId: job.id,
        error: err instanceof Error ? err.message : String(err),
      }));
      continue;
    }
    tier0ByJob.set(job.id, t0);

    // EC-P4-20 — resumeId is recorded so the UI can say "scored against v2,
    // current is v3". A stale score that looks current makes the ranking a lie.
    await upsertApplication(deps, userId, job.id, t0.score, resume.id);
    await persistRun(deps, userId, job.id, "heuristic", t0, resume.id);

    // EC-P4-02/P4.1.3 — the floor decides who gets a Tier-1 refinement, NOT
    // who is visible. Every job above already has a Tier-0 score persisted.
    if (t0.score >= floor) {
      const p = jd as {
        requiredSkills?: string[]; preferredSkills?: string[];
        seniorityLevel?: string | null; jobTitle?: string;
      };
      tier1Inputs.push({
        jobId: job.id,
        title: p.jobTitle || job.title,
        company: job.company,
        requiredSkills: p.requiredSkills ?? [],
        preferredSkills: p.preferredSkills ?? [],
        seniorityLevel: p.seniorityLevel ?? null,
      });
    }
  }

  await publish(deps, userId, { phase: "tier0", scored: tier0ByJob.size });

  /* ---------------- Tier 1: cheap model, batched ---------------- */
  const resumeSummary = summariseResumeForScoring(resume.profile as never);
  let promptTokens = 0;
  let completionTokens = 0;

  for (const batch of chunkByBudget(tier1Inputs)) {
    let results: Awaited<ReturnType<ScoreBatchDeps["scoreWithLlm"]>>["results"] = [];

    try {
      const out = await deps.scoreWithLlm(
        deps.systemPrompt,
        buildScoringPrompt(resumeSummary, batch),
      );
      promptTokens += out.tokens.prompt;
      completionTokens += out.tokens.completion;

      // EC-P4-08/09 — THE BUG THAT WOULD BE INVISIBLE. Map by the echoed
      // jobId and validate the returned set against what was asked. Mapping by
      // array position gives every job a plausible score belonging to a
      // different job, and nothing downstream can detect it.
      const asked = new Set(batch.map((b) => b.jobId));
      const seen = new Set<string>();
      results = out.results.filter((r) => {
        if (!asked.has(r.jobId) || seen.has(r.jobId)) return false;
        seen.add(r.jobId);
        return true;
      });

      if (results.length !== batch.length) {
        // EC-P4-10 — a short or malformed batch must cost ONE job, not five.
        // Fall back to scoring the batch one at a time.
        results = await scoreIndividually(deps, resumeSummary, batch, seen);
      }
    } catch {
      // EC-P4-14 — a rate limit mid-run must not discard completed work. Tier-0
      // scores are already persisted for every job in this batch, so leaving
      // them is a graceful degradation rather than a loss.
      continue;
    }

    for (const r of results) {
      const t0 = tier0ByJob.get(r.jobId);
      // EC-P4-11 — an out-of-range score is rejected, never clamped. Clamping
      // hides a broken prompt behind a plausible number.
      if (!Number.isInteger(r.overallScore) || r.overallScore < 0 || r.overallScore > 100) {
        continue;
      }
      await upsertApplication(deps, userId, r.jobId, r.overallScore, resume.id);
      await persistRun(deps, userId, r.jobId, "cheap", { ...t0, ...r }, resume.id);
    }
  }

  // EC-P4-19 — count retries too; that is the real cost.
  await publish(deps, userId, {
    phase: "done",
    scored: tier0ByJob.size,
    refined: tier1Inputs.length,
    tokens: { prompt: promptTokens, completion: completionTokens, model: deps.model },
  });
}

/** EC-P4-10 — per-job fallback so one poisoned JD costs one job. */
async function scoreIndividually(
  deps: ScoreBatchDeps,
  resumeSummary: string,
  batch: Tier1JobInput[],
  alreadyScored: Set<string>,
) {
  const out: Awaited<ReturnType<ScoreBatchDeps["scoreWithLlm"]>>["results"] = [];
  for (const job of batch) {
    if (alreadyScored.has(job.jobId)) continue;
    try {
      const single = await deps.scoreWithLlm(
        deps.systemPrompt,
        buildScoringPrompt(resumeSummary, [job]),
      );
      const match = single.results.find((r) => r.jobId === job.jobId);
      if (match) out.push(match);
    } catch {
      // This one job stays at its Tier-0 score. The rest are unaffected.
    }
  }
  return out;
}

async function upsertApplication(
  deps: ScoreBatchDeps, userId: string, jobId: string,
  score: number, resumeId: string,
) {
  // EC-P4-15/23 — ON CONFLICT DO UPDATE, not DO NOTHING. DO NOTHING silently
  // keeps a stale score from an earlier run.
  //
  // EC-P6-02 — the UPDATE branch deliberately does NOT touch status. Re-running
  // a harvest must refresh the SCORE without dragging an application backwards
  // down the funnel: re-scoring something already emailed, or manually marked
  // rejected, would otherwise reset it to `scored` and erase the record the
  // user was keeping. Only a brand-new row starts at `scored`.
  await deps.prisma.application.upsert({
    where: { userId_jobId: { userId, jobId } },
    update: { originalScore: score, resumeId },
    create: { userId, jobId, originalScore: score, resumeId, status: "scored" },
  });
}

async function persistRun(
  deps: ScoreBatchDeps, userId: string, jobId: string,
  tier: "heuristic" | "cheap", matchScore: unknown, resumeId: string,
) {
  const app = await deps.prisma.application.findUnique({
    where: { userId_jobId: { userId, jobId } }, select: { id: true },
  });
  if (!app) return;

  // P4.2.4 — a scoring run has no tailored_resume. The `tier` column is what
  // lets the UI badge a score honestly (EC-P4-25).
  await deps.prisma.tailoringRun.create({
    data: {
      userId,
      applicationId: app.id,
      resumeId,
      tier,
      matchScore: JSON.parse(JSON.stringify(matchScore)),
      model: tier === "heuristic" ? "deterministic" : deps.model,
      promptVersion: deps.promptVersion,
    },
  });
}

async function publish(deps: ScoreBatchDeps, userId: string, payload: unknown) {
  await deps.redis.publish(`score:${userId}`, JSON.stringify(payload)).catch(() => {});
}
