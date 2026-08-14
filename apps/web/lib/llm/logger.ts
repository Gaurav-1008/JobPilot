import type OpenAI from "openai";

import { log } from "@/lib/obs/logger";
import { llmTokens, llmValidationRetry } from "@/lib/obs/metrics";

/**
 * Structured LLM call logging. Logs stage, model, duration, and token usage —
 * never resume/JD bodies or API keys (architecture §12.2).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EC-P7-19 — this now goes through `lib/obs/logger`, and therefore through the
 * allow-list serializer.
 *
 * When this file was written it logged a fixed set of scalar fields, so a
 * hand-built `JSON.stringify` was safe by inspection. Phase 5 changed the
 * premise: outreach prompts carry the personalization payload (§14.2) — resume
 * bullets, matched skills, the recipient's name — and prompt tracing is exactly
 * where someone reaches for "just log the whole thing while I debug this".
 *
 * Routing through the shared serializer means the safety no longer depends on
 * this file staying small. A field added here is redacted unless it is on the
 * allow-list, which is the property that survives future edits.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function logLlmCall(entry: {
  stage: string;
  model: string;
  ms: number;
  usage?: OpenAI.CompletionUsage;
  retried?: boolean;
  runId?: string;
  /** Scoring tier, when the call is part of the §12.3 ladder. */
  tier?: "heuristic" | "cheap" | "full";
}): void {
  const { stage, model, ms, usage, retried, runId, tier } = entry;

  log.info("llm.call", {
    stage,
    model,
    ms,
    durationMs: ms,
    outcome: "ok",
    retried: Boolean(retried),
    runId,
    tier,
    promptTokens: usage?.prompt_tokens,
    completionTokens: usage?.completion_tokens,
    totalTokens: usage?.total_tokens,
  });

  // §16.2 `llm_tokens_total{tier,model}` — cost control for Tier-1 batch
  // scoring, which is the only path that can run up a bill without anyone
  // watching. Emitted here rather than at each call site so a new prompt is
  // counted the moment it logs.
  if (usage?.total_tokens) {
    llmTokens(tier ?? "full", model, usage.total_tokens);
  }

  // §16.2 `llm_validation_retry_total{prompt}` — the leading indicator of
  // prompt drift after a model change. It climbs before output quality visibly
  // degrades, which is the only useful time to notice.
  if (retried) llmValidationRetry(stage);
}
