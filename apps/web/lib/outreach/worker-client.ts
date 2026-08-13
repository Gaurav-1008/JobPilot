/**
 * The ①→④ client for outreach (P5.2.7, P5.5.2, P5.5.6).
 *
 * Unlike harvest and hydration — which go through the queue because nobody is
 * waiting — generation and delivery are called inline from a request handler. A
 * person is sitting on the review screen, and a queue round trip would buy
 * nothing but latency.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EC-P5-61 — NOTHING IN THIS FILE MAY LOG A REQUEST BODY.
 *
 * The deliver body carries decrypted credentials. The default instinct when
 * debugging a 422 is to log the payload that caused it, and that instinct here
 * writes an app password into the log file. ④ redacts on its side (P5.5.5);
 * this is the other half, and BOTH are required — a credential leaks from
 * whichever side forgets.
 *
 * Errors from here therefore carry a status and a truncated response body ONLY.
 * Never the request.
 * ─────────────────────────────────────────────────────────────────────────
 */

import type {
  EmailDeliverRequest,
  EmailDeliverResponse,
  EmailGenerateRequest,
  EmailGenerateResponse,
  PreflightRequest,
  PreflightResponse,
} from "@jobpilot/shared-schemas";

export class WorkerError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "WorkerError";
    this.status = status;
  }
}

function base(): string {
  return process.env.WORKER_SERVICE_URL ?? "http://localhost:8000";
}

/**
 * One POST to ④.
 *
 * `label` is what appears in logs — a route name, never a payload. It is a
 * separate parameter precisely so no caller is tempted to interpolate the body
 * into a message string.
 */
async function post<T>(
  path: string,
  body: unknown,
  label: string,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${base()}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-service-token": process.env.WORKER_SERVICE_TOKEN ?? "",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    // EC-P2-33: ④ may answer with a non-JSON error body; a parse failure must
    // not be reported as though it were the real status.
    const text = await res.text();
    if (!res.ok) {
      // Response only. A 422 from ④ echoes field names, not our request.
      throw new WorkerError(res.status, `${label}: ${text.slice(0, 200)}`);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new WorkerError(502, `${label}: worker returned non-JSON`);
    }
  } catch (err) {
    if (err instanceof WorkerError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new WorkerError(504, `${label}: timed out`);
    }
    throw new WorkerError(502, `${label}: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** P5.2.7. 60s: one Groq call with a template fallback behind it. */
export function generateEmail(
  body: EmailGenerateRequest,
): Promise<EmailGenerateResponse> {
  return post<EmailGenerateResponse>(
    "/email/generate",
    body,
    "email.generate",
    60_000,
  );
}

/** P5.5.2. Credentials in the body — see the file header. */
export function preflight(body: PreflightRequest): Promise<PreflightResponse> {
  return post<PreflightResponse>("/email/preflight", body, "email.preflight", 30_000);
}

/** P5.5.6. Credentials in the body — see the file header. */
export function deliver(
  body: EmailDeliverRequest,
): Promise<EmailDeliverResponse> {
  return post<EmailDeliverResponse>("/email/deliver", body, "email.deliver", 60_000);
}
