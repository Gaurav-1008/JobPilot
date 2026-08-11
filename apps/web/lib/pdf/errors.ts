export type PdfErrorCode =
  | "PDF_NOT_TAILORED"
  | "PDF_RENDER_FAILED"
  | "PDF_UNKNOWN";

export class PdfError extends Error {
  readonly code: PdfErrorCode;
  readonly cause?: unknown;

  constructor(code: PdfErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "PdfError";
    this.code = code;
    this.cause = cause;
  }
}
