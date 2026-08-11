/** Stable error codes surfaced to API clients and the UI. */
export type LlmErrorCode =
  | "LLM_AUTH_FAILED"
  | "LLM_RATE_LIMIT"
  | "LLM_TIMEOUT"
  | "LLM_INVALID_JSON"
  | "LLM_CONFIG_ERROR"
  | "LLM_UNKNOWN";

export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly stage?: string;
  readonly cause?: unknown;

  constructor(
    code: LlmErrorCode,
    message: string,
    opts: { stage?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "LlmError";
    this.code = code;
    this.stage = opts.stage;
    this.cause = opts.cause;
  }
}

/** User-facing message per error code (safe to show; never leaks payloads). */
export function llmErrorMessage(code: LlmErrorCode): string {
  switch (code) {
    case "LLM_AUTH_FAILED":
      return "The LLM rejected the API key. Check GROQ_API_KEY in your environment.";
    case "LLM_RATE_LIMIT":
      return "The LLM is rate-limited right now. Please wait a moment and retry.";
    case "LLM_TIMEOUT":
      return "The LLM took too long to respond. Please retry.";
    case "LLM_INVALID_JSON":
      return "The LLM returned malformed output twice. Please retry.";
    case "LLM_CONFIG_ERROR":
      return "The LLM is not configured. Set GROQ_API_KEY to enable analysis.";
    default:
      return "Something went wrong talking to the LLM. Please retry.";
  }
}
