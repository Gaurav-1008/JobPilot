/**
 * Rate-limit retries must honour what the provider actually said.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BUG: THREE RETRIES INSIDE THE WINDOW WE WERE TOLD TO WAIT OUT.
 *
 * The backoff was 0.5s, 1s, 2s — about 3.5s of total patience. Groq answers a
 * token-per-minute 429 with `retry-after: 9`, and repeats it in prose in the
 * body ("Please try again in 7.7775s").
 *
 * So every retry fired while the bucket was still empty, and the chain reported
 * LLM_RATE_LIMIT having waited roughly a quarter of the time it was explicitly
 * told to wait. Observed on a real tailoring run: resume-parser succeeded at
 * 1,937 tokens, jd-extraction hit the 8,000 TPM ceiling, and the request failed
 * after 6 seconds — a run that would have completed by waiting.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { runPrompt } from "@/lib/llm/run-prompt";
import { LlmError } from "@/lib/llm/errors";
import { z } from "zod";

const Schema = z.object({ ok: z.boolean() });

/** An OpenAI-SDK-shaped error. */
function apiError(
  status: number,
  message: string,
  headers?: Record<string, string>,
): Error {
  return Object.assign(new Error(message), {
    status,
    headers,
    error: { message },
  });
}

/** A client that fails `failures` times, then succeeds. */
function clientThatFails(failures: number, err: Error) {
  let calls = 0;
  return {
    calls: () => calls,
    client: {
      chat: {
        completions: {
          create: vi.fn(async () => {
            calls += 1;
            if (calls <= failures) throw err;
            return {
              choices: [{ message: { content: '{"ok":true}' } }],
              usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
              model: "test-model",
            };
          }),
        },
      },
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("a 429 waits as long as the provider asked", () => {
  it("reads retry-after from the header", async () => {
    vi.useFakeTimers();
    const { client } = clientThatFails(
      1,
      apiError(429, "Rate limit reached", { "retry-after": "9" }),
    );

    let settled = false;
    const pending = runPrompt({
      stage: "jd-extraction",
      schema: Schema,
      messages: [{ role: "user", content: "json" }],
      client: client as never,
    }).then((v) => { settled = true; return v; });

    // THE ASSERTION THAT CATCHES THE OLD BEHAVIOUR. 3.5s is the entire budget
    // the fixed backoff ever had (0.5 + 1 + 2). Retrying inside it is exactly
    // the bug: the provider said 9s. Still pending here means we waited.
    await vi.advanceTimersByTimeAsync(3_500);
    expect(settled, "retried before the advised retry-after elapsed").toBe(false);

    await vi.advanceTimersByTimeAsync(6_000);
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it("falls back to the prose when there is no header", async () => {
    // Groq states the wait in the body, and the header is absent on some error
    // shapes. The sentence is not decoration — it is the only signal left.
    vi.useFakeTimers();
    const { client } = clientThatFails(
      1,
      apiError(429, "Rate limit reached ... Please try again in 7.7775s. Need more tokens?"),
    );

    let settled = false;
    const pending = runPrompt({
      stage: "jd-extraction",
      schema: Schema,
      messages: [{ role: "user", content: "json" }],
      client: client as never,
    }).then((v) => { settled = true; return v; });

    await vi.advanceTimersByTimeAsync(3_500);
    expect(settled, "retried before the stated 7.7775s elapsed").toBe(false);

    await vi.advanceTimersByTimeAsync(6_000);
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it("refuses rather than holding the request open for an absurd wait", async () => {
    // A provider may legitimately say "wait 10 minutes". A request handler is
    // not allowed to honour that, so past the cap it becomes a typed error the
    // UI can retry deliberately.
    const { client } = clientThatFails(
      1,
      apiError(429, "Rate limit reached", { "retry-after": "600" }),
    );

    await expect(
      runPrompt({
        stage: "jd-extraction",
        schema: Schema,
        messages: [{ role: "user", content: "json" }],
        client: client as never,
      }),
    ).rejects.toMatchObject({ code: "LLM_RATE_LIMIT" });
  });
});

describe("413 is a sizing problem, not a waiting problem", () => {
  it("does not retry a request larger than the whole budget", async () => {
    // The budget refills, but the request is still bigger than one minute's
    // entire allowance — retrying burns the user's time to reach the same
    // refusal.
    const { client, calls } = clientThatFails(
      99,
      apiError(413, "Request too large for model `openai/gpt-oss-120b` ... on tokens per minute (TPM)"),
    );

    await expect(
      runPrompt({
        stage: "jd-extraction",
        schema: Schema,
        messages: [{ role: "user", content: "json" }],
        client: client as never,
      }),
    ).rejects.toBeInstanceOf(LlmError);

    // Exactly one attempt. A retry loop here is pure latency.
    expect(calls()).toBe(1);
  });

  it("says what to change, not just that it failed", async () => {
    const { client } = clientThatFails(
      99,
      apiError(413, "Request too large for model `openai/gpt-oss-120b`"),
    );

    await expect(
      runPrompt({
        stage: "jd-extraction",
        schema: Schema,
        messages: [{ role: "user", content: "json" }],
        client: client as never,
      }),
    ).rejects.toMatchObject({
      code: "LLM_CONFIG_ERROR",
      message: expect.stringContaining("larger than the per-minute token budget"),
    });
  });
});
