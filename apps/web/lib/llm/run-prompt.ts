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

/**
 * The provider's own error sentence, if there is one.
 *
 * The OpenAI SDK puts the parsed body on `.error` and the raw text on
 * `.message`. Either can be absent depending on how the failure happened, so
 * both are tried and the result is bounded — an error body is not a log budget.
 */
function extractProviderMessage(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const body = (err as { error?: { message?: string } }).error;
  const raw = body?.message ?? (err as { message?: string }).message ?? "";
  return typeof raw === "string" ? raw.slice(0, 300) : "";
}

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

      /**
       * A DECOMMISSIONED MODEL IS A CONFIG ERROR, NOT AN UNKNOWN ONE.
       *
       * Providers retire model ids on their own schedule, so a deployment that
       * worked yesterday returns 404 `model_not_found` today with nothing
       * having changed on our side. That is the single most likely cause of a
       * sudden total LLM outage, and it is entirely actionable — one env var.
       *
       * It used to land in the catch-all below, which threw the message "LLM
       * request failed" and attached the real cause to `.cause`, where nothing
       * logged it. The operator saw:
       *
       *   {"code":"LLM_UNKNOWN","stage":"resume-parser",
       *    "message":"LLM request failed"}
       *
       * — for an error whose body said, in plain English, that the model does
       * not exist. Diagnosing it meant curling the provider by hand.
       *
       * So it gets its own branch, and the provider's own sentence is carried
       * into the message. Provider error text names a model id, never user
       * content, so this is safe to surface and to log.
       */
      const providerMessage = extractProviderMessage(err);
      if (status === 404 || /does not exist|model_not_found|decommissioned/i.test(providerMessage)) {
        throw new LlmError(
          "LLM_CONFIG_ERROR",
          `The configured model is unavailable: ${providerMessage || "model not found"}. ` +
            "Check TAILORING_MODEL / SCORING_MODEL / EMAIL_LLM_MODEL against the provider's current model list.",
          { stage, cause: err },
        );
      }

      // Still the catch-all, but no longer silent: whatever the provider said
      // travels in the message rather than only in an unlogged `cause`.
      throw new LlmError(
        "LLM_UNKNOWN",
        providerMessage ? `LLM request failed: ${providerMessage}` : "LLM request failed",
        { stage, cause: err },
      );
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
