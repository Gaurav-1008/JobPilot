/**
 * Extracted-text sanitising and sanity checks (P1.2.1).
 *
 * Runs between document extraction and anything that persists or prompts. Every
 * rule here is an edge case that otherwise reaches the database or the LLM.
 */

/** Above this the parse prompt costs real money for no extra signal. */
export const MAX_RESUME_CHARS = 50_000;

/** Below this there is no resume, whatever the file claimed to be. */
export const MIN_RESUME_CHARS = 200;

export interface SanitisedText {
  text: string;
  warnings: string[];
}

export class UnreadableDocumentError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "UnreadableDocumentError";
  }
}

/**
 * EC-P1-09 — PDF extraction can emit NUL and other C0 control characters.
 * Postgres `text` rejects U+0000 outright ("invalid byte sequence"), so this
 * must run BEFORE anything touches the database. The original extractor never
 * hit this because it never persisted.
 *
 * Tabs (U+0009) and newlines (U+000A/U+000D) are kept — they carry resume
 * structure. Everything else in the C0 range goes.
 *
 * Written with \u escapes on purpose: putting literal control characters in a
 * source file is exactly the bug this function exists to clean up, and git
 * would classify the file as binary.
 */
export function stripControlChars(input: string): string {
  return input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

export function sanitiseResumeText(raw: string): SanitisedText {
  const warnings: string[] = [];

  const cleaned = stripControlChars(raw);
  if (cleaned.length !== raw.length) {
    warnings.push("Removed control characters that the document contained.");
  }

  const text = cleaned.trim();

  // EC-P1-13 — 0-byte file, or a valid file containing only whitespace.
  if (text.length === 0) {
    throw new UnreadableDocumentError(
      "That file contains no text. Paste your resume instead.",
    );
  }

  // EC-P1-08 — a scanned-image PDF is a perfectly valid PDF with no extractable
  // text. Failing here beats sending an empty resume to the parse prompt and
  // getting back a confident, meaningless profile.
  if (text.length < MIN_RESUME_CHARS) {
    throw new UnreadableDocumentError(
      "We could not read enough text from that file — it may be a scanned image. " +
        "Paste your resume instead.",
    );
  }

  // EC-P1-14 — a 400-page PDF extracts to megabytes and blows the context
  // window. Truncate, but SAY SO: silent truncation produces a wrong parse the
  // user cannot explain.
  if (text.length > MAX_RESUME_CHARS) {
    warnings.push(
      `Resume was truncated to ${MAX_RESUME_CHARS.toLocaleString()} characters for analysis.`,
    );
    return { text: text.slice(0, MAX_RESUME_CHARS), warnings };
  }

  return { text, warnings };
}

/**
 * EC-P1-11 — trust the BYTES, never the filename or the client-supplied MIME
 * type. Both are attacker-controlled.
 */
export function sniffContentType(
  buffer: Buffer,
): "pdf" | "docx" | "text" | "unknown" {
  if (buffer.length >= 4) {
    // "%PDF"
    if (
      buffer[0] === 0x25 && buffer[1] === 0x50 &&
      buffer[2] === 0x44 && buffer[3] === 0x46
    ) {
      return "pdf";
    }
    // "PK" — a zip container, which .docx is. Could also be .xlsx or a zip
    // bomb, which is why the extractor caps decompressed size (EC-P1-12).
    if (buffer[0] === 0x50 && buffer[1] === 0x4b) return "docx";
  }
  // Anything decoding as UTF-8 without replacement characters is text.
  const sample = buffer.subarray(0, 1024).toString("utf8");
  return sample.includes("�") ? "unknown" : "text";
}
