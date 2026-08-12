"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useMutation } from "@tanstack/react-query";

import {
  AnalyzeResponseSchema,
  TailorResponseSchema,
  type TailoringRun,
} from "@/lib/schemas";
import { assembleRun, applyTailorToRun } from "@/lib/run-assemble";
import {
  subscribe,
  getSnapshot,
  getServerSnapshot,
  setRun,
} from "@/lib/run-view-store";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error ?? "Request failed");
  }
  return data as T;
}

/**
 * Owns the current TailoringRun: calls the analyze/tailor API routes and keeps
 * the assembled aggregate in an in-memory view cache.
 *
 * P1.3.8 — the run is persisted SERVER-SIDE now and is refetchable from
 * GET /api/runs/:id, so refresh-resilience no longer depends on sessionStorage.
 */
export function useTailoringRun() {
  const run = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const analyzeMutation = useMutation({
    mutationFn: async (input: { resumeText: string; jdText: string }) => {
      const raw = await postJson("/api/analyze", input);
      return assembleRun(AnalyzeResponseSchema.parse(raw));
    },
    onSuccess: setRun,
  });

  const tailorMutation = useMutation({
    mutationFn: async (current: TailoringRun) => {
      const raw = await postJson("/api/tailor", { runId: current.id });
      return applyTailorToRun(current, TailorResponseSchema.parse(raw));
    },
    onSuccess: setRun,
  });

  const analyze = useCallback(
    (resumeText: string, jdText: string) =>
      analyzeMutation.mutate({ resumeText, jdText }),
    [analyzeMutation],
  );

  const tailor = useCallback(() => {
    if (run) tailorMutation.mutate(run);
  }, [run, tailorMutation]);

  const reset = useCallback(() => setRun(null), []);

  return {
    run,
    analyze,
    tailor,
    reset,
    isAnalyzing: analyzeMutation.isPending,
    isTailoring: tailorMutation.isPending,
    analyzeError: analyzeMutation.error as Error | null,
    tailorError: tailorMutation.error as Error | null,
  };
}
