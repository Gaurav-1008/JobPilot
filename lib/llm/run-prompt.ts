import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ZodType } from "zod";

import { createLlmClient, getLlmModel } from "@/lib/llm/client";
import { LlmError } from "@/lib/llm/errors";
import { logLlmCall } from "@/lib/llm/logger";

export interface RunPromptOptions<T> {
  /** Stage label for logs (e.g. "jd-extraction"). */
  stage: string;
  /** Zod schema the parsed JSON response must satisfy. */
  schema: ZodType<T>;
  /** Chat messages; at least one must mention "json" for Groq json_object mode. */
  messages: ChatCompletionMessageParam[];
  temperature?: number;
  maxTokens?: number;
  /** Injected client (tests). Defaults to a Groq-backed OpenAI client. */
  client?: OpenAI;
}

/** Strip ```json fences and surrounding prose the model may add. */
function stripFences(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  // Fall back to the outermost JSON object/array if extra prose remains.
  const firstBrace = text.search(/[[{]/);
  const lastBrace = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }
  return text;
}

const MAX_BACKOFF_ATTEMPTS = 3;

/** Map SDK/network errors to a stable LlmError, retrying 429s with backoff. */
async function createWithBackoff(
  client: OpenAI,
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  stage: string,
): Promise<OpenAI.Chat.ChatCompletion> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_BACKOFF_ATTEMPTS; attempt++) {
    try {
      return await client.chat.completions.create(params);
    } catch (err: unknown) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) {
        throw new LlmError("LLM_AUTH_FAILED", "LLM auth failed", {
          stage,
          cause: err,
        });
      }
      if (status === 429) {
        // exponential backoff: 0.5s, 1s, 2s
        await sleep(500 * 2 ** attempt);
        continue;
      }
      const isTimeout =
        (err as { name?: string })?.name === "APIConnectionTimeoutError" ||
        (err as { code?: string })?.code === "ETIMEDOUT";
      if (isTimeout) {
        throw new LlmError("LLM_TIMEOUT", "LLM request timed out", {
          stage,
          cause: err,
        });
      }
      throw new LlmError("LLM_UNKNOWN", "LLM request failed", {
        stage,
        cause: err,
      });
    }
  }
  throw new LlmError("LLM_RATE_LIMIT", "LLM rate limit exceeded", {
    stage,
    cause: lastErr,
  });
}

/**
 * Run a prompt and return a Zod-validated object.
 *
 * Uses Groq json_object response format, strips fences, validates with Zod, and
 * retries exactly once with the validation errors fed back to the model.
 */
export async function runPrompt<T>(options: RunPromptOptions<T>): Promise<T> {
  const {
    stage,
    schema,
    messages,
    temperature = 0.2,
    maxTokens,
    client = createLlmClient(),
  } = options;

  const model = getLlmModel();
  const started = Date.now();

  const attempt = async (
    msgs: ChatCompletionMessageParam[],
  ): Promise<{ text: string; usage?: OpenAI.CompletionUsage }> => {
    const completion = await createWithBackoff(
      client,
      {
        model,
        messages: msgs,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
      },
      stage,
    );
    return {
      text: completion.choices[0]?.message?.content ?? "",
      usage: completion.usage,
    };
  };

  const parseOrThrow = (text: string): T => {
    const json = JSON.parse(stripFences(text));
    return schema.parse(json);
  };

  // First attempt.
  const first = await attempt(messages);
  try {
    const value = parseOrThrow(first.text);
    logLlmCall({ stage, model, ms: Date.now() - started, usage: first.usage });
    return value;
  } catch (firstErr) {
    // Second attempt: feed the failure back and ask for corrected JSON.
    const retryMessages: ChatCompletionMessageParam[] = [
      ...messages,
      { role: "assistant", content: first.text },
      {
        role: "user",
        content: `Your previous response was not valid according to the required schema (${String(
          (firstErr as Error).message,
        ).slice(0, 500)}). Respond again with ONLY valid JSON matching the schema.`,
      },
    ];
    const second = await attempt(retryMessages);
    try {
      const value = parseOrThrow(second.text);
      logLlmCall({
        stage,
        model,
        ms: Date.now() - started,
        usage: second.usage,
        retried: true,
      });
      return value;
    } catch (secondErr) {
      throw new LlmError(
        "LLM_INVALID_JSON",
        "LLM returned invalid JSON after one retry",
        { stage, cause: secondErr },
      );
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
