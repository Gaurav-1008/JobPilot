import OpenAI from "openai";

import { LlmError } from "@/lib/llm/errors";

/**
 * Groq is the default provider via its OpenAI-compatible HTTP API, so we use the
 * official `openai` client pointed at Groq's base URL. Server-only —
 * GROQ_API_KEY must never reach the browser.
 */
export function createLlmClient(): OpenAI {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new LlmError(
      "LLM_CONFIG_ERROR",
      "GROQ_API_KEY is not set. Add it to .env to enable LLM features.",
    );
  }

  return new OpenAI({
    apiKey,
    baseURL: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
    timeout: Number(process.env.LLM_TIMEOUT_MS ?? 45_000),
    maxRetries: 0, // we handle retries/backoff ourselves in run-prompt
  });
}

export function getLlmModel(): string {
  // EC-P0-04: renamed from LLM_MODEL. The Closer uses that same name for its
  // Claude model; in a merged deployment whichever service read it last won,
  // and the failure was a wrong-model call rather than a crash.
  return process.env.TAILORING_MODEL ?? "llama-3.3-70b-versatile";
}

/** True when an LLM provider is configured (used to gate live vs. clear error). */
export function isLlmConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}
