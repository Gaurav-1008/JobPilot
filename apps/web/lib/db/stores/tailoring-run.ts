/**
 * Database-backed tailoring run store (P1.3.1).
 *
 * Replaces BOTH of the previous stores:
 *   lib/run-store.ts         in-memory, server-side, lost on every restart
 *   lib/run-client-store.ts  sessionStorage, lost on every new browser session
 *
 * This is the anti-corruption layer: it keeps run-store's `saveRun/getRun/
 * deleteRun` shape so lib/orchestrator.ts changes as little as possible.
 *
 * EC-P1-33 — the interface CANNOT stay identical: the old store was synchronous
 * and this one is not. That was predicted, and it is the one unavoidable change
 * at every call site. Everything else about the shape is preserved.
 *
 * EC-P1-26 — every read is tenant-scoped and returns null rather than throwing,
 * so handlers naturally produce 404. For tenant-scoped rows, "not yours" and
 * "does not exist" must be indistinguishable; a 403 would confirm the id exists.
 */

import type { Prisma } from "@prisma/client";

import type { TailoringRun } from "@jobpilot/shared-schemas";
import type { GuardrailResult } from "@/lib/guardrails";
import { prisma } from "../client";

/**
 * The tailoring domain (TailoringRun) predates the platform schema and has its
 * own shape — §8.7 says do not redesign it. So the whole run is stored as JSONB
 * on `tailoring_runs`, and only the columns the platform QUERIES are lifted out
 * (userId, applicationId, tier, model, promptVersion). The rule from
 * architecture.md §7.3: if a WHERE clause needs it, it is a column.
 */
export interface PersistRunInput {
  userId: string;
  run: TailoringRun;
  /** Null until P4 wires runs to applications; Phase 1 runs stand alone. */
  applicationId?: string | null;
  resumeId?: string | null;
  tier?: "heuristic" | "cheap" | "full";
  model: string;
  promptVersion: string;
  /** EC-P1-40: blocked changes are persisted as rejected-with-reason. */
  guardrail?: GuardrailResult | null;
  tokenUsage?: Prisma.InputJsonValue | null;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * EC-P1-37 — callers MUST have run guardrails before calling this. The
 * orchestrator does: checkTailoredResume() returns the adjusted resume, and
 * only that adjusted version reaches here. There is deliberately no code path
 * that persists a raw, unchecked LLM response.
 */
export async function saveRun(input: PersistRunInput): Promise<void> {
  const {
    userId, run, applicationId = null, resumeId = null,
    tier = "full", model, promptVersion, guardrail = null, tokenUsage = null,
  } = input;

  const data = {
    id: run.id,
    userId,
    applicationId,
    resumeId,
    tier,
    // Whole-run snapshot. matchScore is the column the platform reads for
    // ranking; the rest of the run travels with it.
    matchScore: toJson(run.originalMatch ?? {}),
    tailoredResume: run.tailoredResume ? toJson(run) : toJson(run),
    gaps: toJson(run.gapAnalysis?.gaps ?? []),
    bulletChanges: toJson(collectBulletChanges(run)),
    guardrailReport: toJson(guardrail ?? {}),
    model,
    promptVersion,
    tokenUsage: tokenUsage ?? undefined,
  };

  await prisma.tailoringRun.upsert({
    where: { id: run.id },
    create: data,
    update: data,
  });
}

/** Tenant-scoped. Returns null when the run is missing OR owned by someone else. */
export async function getRun(id: string, userId: string): Promise<TailoringRun | null> {
  const row = await prisma.tailoringRun.findFirst({
    where: { id, userId },
    select: { tailoredResume: true },
  });
  if (!row?.tailoredResume) return null;
  return row.tailoredResume as unknown as TailoringRun;
}

export async function deleteRun(id: string, userId: string): Promise<void> {
  await prisma.tailoringRun.deleteMany({ where: { id, userId } });
}

export async function listRuns(userId: string, limit = 50) {
  return prisma.tailoringRun.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true, tier: true, model: true, promptVersion: true, createdAt: true,
    },
  });
}

/** Flatten per-experience bullets into the platform's BulletChange list. */
function collectBulletChanges(run: TailoringRun): unknown[] {
  const tailored = run.tailoredResume;
  if (!tailored?.tailoredExperience) return [];
  return tailored.tailoredExperience.flatMap((exp) =>
    (exp.bullets ?? []).map((b) => ({ company: exp.company, title: exp.title, ...b })),
  );
}
