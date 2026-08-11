import {
  type AnalyzeResponse,
  type TailorResponse,
  type TailoringRun,
} from "@/lib/schemas";

/**
 * Pure client-side helpers to fold API responses into the TailoringRun
 * aggregate that the UI renders and persists to sessionStorage.
 */

/** Build an analyzed run from an /api/analyze response. */
export function assembleRun(analysis: AnalyzeResponse): TailoringRun {
  return {
    id: analysis.runId,
    createdAt: new Date().toISOString(),
    status: "analyzed",
    resume: analysis.resume,
    jobDescription: analysis.jobDescription,
    originalMatch: analysis.originalMatch,
    tailoredResume: null,
    tailoredMatch: null,
    gapAnalysis: analysis.gapAnalysis,
    warnings: [],
  };
}

/** Merge an /api/tailor response into an existing run (idempotent replace). */
export function applyTailorToRun(
  run: TailoringRun,
  tailor: TailorResponse,
): TailoringRun {
  return {
    ...run,
    status: "tailored",
    tailoredResume: tailor.tailoredResume,
    tailoredMatch: tailor.tailoredMatch,
    warnings: tailor.warnings,
  };
}
