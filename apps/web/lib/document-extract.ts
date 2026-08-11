import { BadRequestError } from "@/lib/api-errors";

/**
 * Extract plain text from an uploaded resume (PDF / DOCX / TXT).
 *
 * The extracted text feeds the existing text-based analyze pipeline, so upload
 * and paste share one downstream path. Heavy parsers are imported dynamically so
 * they never reach the client/edge bundle.
 */

export interface ExtractedDocument {
  text: string;
  warnings: string[];
}

export interface UploadFile {
  buffer: Buffer;
  name: string;
  type: string;
}

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 5);
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

function extOf(name: string): string {
  return name.toLowerCase().split(".").pop() ?? "";
}

/** Validate size/type, then extract text and any parse warnings. */
export async function extractResumeText(
  file: UploadFile,
): Promise<ExtractedDocument> {
  if (file.buffer.length === 0) {
    throw new BadRequestError("The uploaded file is empty.");
  }
  if (file.buffer.length > MAX_UPLOAD_BYTES) {
    throw new BadRequestError(
      `File is larger than the ${MAX_UPLOAD_MB} MB limit.`,
    );
  }

  const ext = extOf(file.name);
  const type = file.type;

  if (type === "application/pdf" || ext === "pdf") {
    return extractPdf(file.buffer);
  }
  if (
    type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  ) {
    return extractDocx(file.buffer);
  }
  if (type.startsWith("text/") || ext === "txt" || ext === "md") {
    return { text: file.buffer.toString("utf8"), warnings: [] };
  }
  if (ext === "doc") {
    throw new BadRequestError(
      "Legacy .doc files aren't supported. Export as PDF or .docx, or paste the text.",
    );
  }

  throw new BadRequestError(
    "Unsupported file type. Upload a PDF, DOCX, or TXT — or paste the text.",
  );
}

async function extractPdf(buffer: Buffer): Promise<ExtractedDocument> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    const text = normalize(result.text);
    const warnings: string[] = [];
    if (text.length < 50) {
      warnings.push(
        "Very little text was extracted — this PDF may be scanned or image-based. Consider pasting the text.",
      );
    }
    if (result.pages.length > 2) {
      warnings.push(
        "Multi-page or multi-column resumes can extract out of order; review the parsed sections.",
      );
    }
    return { text, warnings };
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer: Buffer): Promise<ExtractedDocument> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  const warnings = result.messages
    .filter((m) => m.type === "warning")
    .slice(0, 3)
    .map((m) => m.message);
  return { text: normalize(result.value), warnings };
}

/** Collapse excessive blank lines and trailing whitespace. */
function normalize(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
