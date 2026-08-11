import type OpenAI from "openai";

/**
 * Structured LLM call logging. Logs stage, model, duration, and token usage —
 * never resume/JD bodies or API keys (architecture §12.2).
 */
export function logLlmCall(entry: {
  stage: string;
  model: string;
  ms: number;
  usage?: OpenAI.CompletionUsage;
  retried?: boolean;
  runId?: string;
}): void {
  const { stage, model, ms, usage, retried, runId } = entry;
  console.info(
    JSON.stringify({
      event: "llm.call",
      stage,
      model,
      ms,
      retried: Boolean(retried),
      runId,
      promptTokens: usage?.prompt_tokens,
      completionTokens: usage?.completion_tokens,
      totalTokens: usage?.total_tokens,
    }),
  );
}
